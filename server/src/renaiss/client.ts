/**
 * Typed HTTP client for the Renaiss Builder API v2 (https://api.renaiss.xyz/v2/openapi.json).
 *
 * Why not @renaiss-protocol/client: the only published line is 0.1.0-beta.x, it declares
 * `engines.node >= 24` (we run Node 22) and wraps everything in fp-ts TaskEither. We mirror its
 * request shapes and EIP-712 types instead (see schemas.ts) and validate every response with zod.
 */
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Logger } from '../log.js';
import {
  buybackOffersSchema,
  buybackStatusSchema,
  errorBodySchema,
  packDetailSchema,
  packListSchema,
  prepareSchema,
  pullStatusSchema,
  type BuybackBody,
  type PullRequestBody,
} from './schemas.js';

export class RenaissApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | undefined,
    readonly requestId: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'RenaissApiError';
  }
}

export interface RenaissClientOptions {
  baseUrl: string;
  apiKey?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Retries after 429 / 5xx / network errors (only for idempotent calls, except 429 which is always safe). */
  maxRetries?: number;
  /** Base for exponential backoff when no Retry-After header is present. */
  backoffMs?: number;
  /** Cap for any single wait (Retry-After included). */
  maxBackoffMs?: number;
  log?: Logger;
  sleep?: (ms: number) => Promise<void>;
}

interface CallOpts<S extends z.ZodType> {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  schema: S;
  /** Send x-builder-api-key (required for every non-catalog route). */
  auth?: boolean;
  /** Safe to resend on 5xx / network failure. GETs are; POST /pull/request is (same signed body is idempotent). */
  idempotent?: boolean;
}

const sleepReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const noopLog: Logger = { info() {}, warn() {}, error() {}, debug() {} };

/** Retry-After is either delta-seconds or an HTTP date. */
export function parseRetryAfter(v: string | null, now = Date.now()): number | null {
  if (!v) return null;
  const s = Number(v);
  if (Number.isFinite(s) && s >= 0) return Math.round(s * 1000);
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : Math.max(0, t - now);
}

export class RenaissClient {
  readonly baseUrl: string;
  private apiKey?: string;
  private fetchImpl: typeof fetch;
  private timeoutMs: number;
  private maxRetries: number;
  private backoffMs: number;
  private maxBackoffMs: number;
  private log: Logger;
  private sleep: (ms: number) => Promise<void>;

  constructor(o: RenaissClientOptions) {
    this.baseUrl = o.baseUrl.replace(/\/+$/, '');
    this.apiKey = o.apiKey;
    this.fetchImpl = o.fetch ?? fetch;
    this.timeoutMs = o.timeoutMs ?? 15_000;
    this.maxRetries = o.maxRetries ?? 4;
    this.backoffMs = o.backoffMs ?? 500;
    this.maxBackoffMs = o.maxBackoffMs ?? 30_000;
    this.log = o.log ?? noopLog;
    this.sleep = o.sleep ?? sleepReal;
  }

  get hasApiKey() {
    return !!this.apiKey;
  }

  async call<S extends z.ZodType>(method: 'GET' | 'POST', path: string, o: CallOpts<S>): Promise<z.infer<S>> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(o.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    if (o.auth && !this.apiKey) throw new RenaissApiError(`Renaiss ${method} ${path}: builder API key not configured`, 0, 'API_AUTH_MISSING_CREDENTIAL', '');
    const idempotent = o.idempotent ?? method === 'GET';

    for (let attempt = 0; ; attempt++) {
      const reqId = randomUUID();
      const headers: Record<string, string> = { accept: 'application/json', 'x-request-id': reqId };
      if (o.body !== undefined) headers['content-type'] = 'application/json';
      // Catalog reads go out without the key (public packs; keeps them off the key's rate limit).
      if (o.auth && this.apiKey) headers['x-builder-api-key'] = this.apiKey;
      const started = Date.now();
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method,
          headers,
          body: o.body === undefined ? undefined : JSON.stringify(o.body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        this.log.warn({ reqId, method, path, attempt, err: String(err) }, 'renaiss: network error');
        if (idempotent && attempt < this.maxRetries) {
          await this.sleep(this.backoff(attempt));
          continue;
        }
        throw new RenaissApiError(`Renaiss ${method} ${path}: ${String(err)}`, 0, 'NETWORK_ERROR', reqId);
      }
      const serverReqId = res.headers.get('x-request-id') ?? res.headers.get('cf-ray') ?? undefined;
      const text = await res.text();
      const json = text ? safeJson(text) : {};
      this.log.debug({ reqId, serverReqId, method, path, status: res.status, ms: Date.now() - started }, 'renaiss: response');

      if (res.status === 429 || (res.status >= 500 && idempotent)) {
        if (attempt < this.maxRetries) {
          const ra = parseRetryAfter(res.headers.get('retry-after'));
          const wait = Math.min(this.maxBackoffMs, ra ?? this.backoff(attempt));
          this.log.warn({ reqId, serverReqId, method, path, status: res.status, attempt, waitMs: wait }, 'renaiss: retrying');
          await this.sleep(wait);
          continue;
        }
      }
      if (!res.ok) {
        const e = errorBodySchema.safeParse(json);
        const code = e.success ? e.data.code : undefined;
        const msg = e.success ? (e.data.message ?? e.data.error) : undefined;
        this.log.warn({ reqId, serverReqId, method, path, status: res.status, code }, 'renaiss: request failed');
        throw new RenaissApiError(`Renaiss ${method} ${path} → ${res.status}${code ? ` ${code}` : ''}${msg ? `: ${msg}` : ''}`, res.status, code, reqId, json);
      }
      const parsed = o.schema.safeParse(json);
      if (!parsed.success) {
        this.log.error({ reqId, serverReqId, method, path, issues: parsed.error.issues.slice(0, 5) }, 'renaiss: unexpected response shape');
        throw new RenaissApiError(`Renaiss ${method} ${path}: response failed validation: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`, res.status, 'INVALID_RESPONSE', reqId, json);
      }
      return parsed.data;
    }
  }

  private backoff(attempt: number) {
    const base = Math.min(this.maxBackoffMs, this.backoffMs * 2 ** attempt);
    return Math.round(base / 2 + Math.random() * (base / 2));
  }

  // ---- public catalog ----
  listPacks(q: { stage?: string; limit?: number; offset?: number } = {}) {
    return this.call('GET', '/v2/gacha/packs', { query: { stage: q.stage, limit: q.limit, offset: q.offset }, schema: packListSchema });
  }
  getPack(slug: string) {
    return this.call('GET', `/v2/gacha/packs/${encodeURIComponent(slug)}`, { schema: packDetailSchema });
  }

  // ---- pulls (builder key) ----
  preparePull(body: { buyerWalletAddress: string; packId: string; quantity: number }) {
    return this.call('POST', '/v2/gacha/pull/prepare', { body, schema: prepareSchema, auth: true, idempotent: false });
  }
  /** 202. Resending the same signed body returns the original requestId (documented as idempotent). */
  submitPull(body: PullRequestBody) {
    return this.call('POST', '/v2/gacha/pull/request', { body, schema: pullStatusSchema, auth: true, idempotent: true });
  }
  pullStatus(requestId: string) {
    return this.call('GET', '/v2/gacha/pull/status', { query: { requestId }, schema: pullStatusSchema, auth: true });
  }

  // ---- buybacks (builder key) ----
  buybackOffers(q: { buyerWalletAddress: string; limit?: number; offset?: number }) {
    return this.call('GET', '/v2/gacha/buyback/offers', { query: q, schema: buybackOffersSchema, auth: true });
  }
  /** Each submission creates a new request: never auto-resent on 5xx. */
  submitBuyback(body: BuybackBody) {
    return this.call('POST', '/v2/gacha/buyback/request', { body, schema: buybackStatusSchema, auth: true, idempotent: false });
  }
  buybackStatus(requestId: string) {
    return this.call('GET', '/v2/gacha/buyback/status', { query: { requestId }, schema: buybackStatusSchema, auth: true });
  }
}

function safeJson(t: string): unknown {
  try {
    return JSON.parse(t);
  } catch {
    return { raw: t };
  }
}
