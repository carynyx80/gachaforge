import type { PackId } from '../types.js';
import { authHeaders, bodies, endpoints, parse, RENAISS_PACK_IDS } from './endpoints.js';
import type { CardProvider } from './provider.js';

export class RenaissError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

/** HTTP client for Renaiss. Shapes live in endpoints.ts (TODO until docs). */
export class RenaissProvider implements CardProvider {
  readonly name = 'renaiss';
  constructor(
    private baseUrl: string,
    private apiKey: string,
    private fetchImpl: typeof fetch = fetch,
    private timeoutMs = 15_000,
  ) {}

  private async call(ep: { method: string; path: string }, params: Record<string, string>, body?: unknown) {
    const path = ep.path.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(params[k] ?? ''));
    const res = await this.fetchImpl(new URL(path, this.baseUrl), {
      method: ep.method,
      headers: { 'content-type': 'application/json', accept: 'application/json', ...authHeaders(this.apiKey) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await res.text();
    const json = text ? safeJson(text) : {};
    if (!res.ok) throw new RenaissError(`Renaiss ${ep.method} ${path} → ${res.status}`, res.status, json);
    return json as Record<string, any>;
  }

  async buyPack(packId: PackId, paymentTx: string) {
    return parse.buyPack(await this.call(endpoints.buyPack, { packId: RENAISS_PACK_IDS[packId] }, bodies.buyPack(paymentTx)));
  }
  async getPull(id: string) {
    return parse.getPull(await this.call(endpoints.getPull, { id }));
  }
  async sellBack(cardId: string) {
    return parse.sellBack(cardId, await this.call(endpoints.sellBack, { cardId }, {}));
  }
  async quoteSellBack(cardId: string) {
    return parse.quote(cardId, await this.call(endpoints.quoteSellBack, { cardId }));
  }
  async transferCard(cardId: string, to: string) {
    await this.call(endpoints.transferCard, { cardId }, bodies.transferCard(to));
  }
}

function safeJson(t: string) {
  try {
    return JSON.parse(t);
  } catch {
    return { raw: t };
  }
}
