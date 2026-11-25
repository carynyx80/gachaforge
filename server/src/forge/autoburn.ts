/**
 * $FORGE auto-burn (owner decision): once $FORGE is discovered, the deployer wallet's WHOLE $FORGE balance is sent to
 * 0x…dEaD with a single ERC-20 `transfer`, exactly once.
 *
 * Key isolation: FORGE_DEPLOYER_PRIVATE_KEY lives only inside a dedicated viem account/wallet client (not the ops wallet).
 * The only thing this module can sign is `token.transfer(DEAD, amount)` with value 0 — `assertBurnCall` guards the single
 * signing path, so no other method and no BNB transfer can ever be produced with this key. Only the address is logged.
 *
 * Idempotency: state lives in repo meta (`forge:autoburn`, Postgres in prod). The signed raw tx + hash are persisted
 * BEFORE broadcasting, so a restart re-checks / re-broadcasts the same tx (same nonce) instead of signing a second one.
 * `done` / `nothing` are final.
 */
import { createPublicClient, createWalletClient, decodeFunctionData, encodeFunctionData, erc20Abi, fallback, http, keccak256, type Hex, type PublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';
import type { Bus } from '../bus.js';
import type { Ledger } from '../ledger.js';
import { fmtTokens } from '../ledger.js';
import type { Logger } from '../log.js';
import type { Repository } from '../store/repository.js';
import { DEAD } from './chain.js';

export type AutoBurnStatusName = 'idle' | 'waiting' | 'done' | 'nothing' | 'error';

/** Public shape for GET /api/forge `autoBurn`. */
export interface AutoBurnStatus {
  enabled: boolean;
  status: AutoBurnStatusName;
  txHash?: string;
  /** $FORGE burned (whole tokens) */
  amount?: number;
  /** Short human-readable reason for waiting / error states (never contains secrets). */
  detail?: string;
}

/** Persisted state (repo meta `forge:autoburn`). */
export interface AutoBurnState {
  status: AutoBurnStatusName;
  token?: string;
  /** wei, decimal string */
  amountWei?: string;
  txHash?: string;
  /** Signed tx persisted before broadcast (restart re-broadcasts it; same nonce → can never double-send). */
  raw?: Hex;
  detail?: string;
  detectedAt?: number;
  doneAt?: number;
  updatedAt: number;
}

export interface BurnReceipt {
  status: 'success' | 'reverted';
  blockNumber: bigint;
}

/** Chain access of the burner. `viemBurnBackend` in prod, fakes in tests. */
export interface BurnBackend {
  readonly address: Hex;
  tokenBalance(token: Hex): Promise<bigint>;
  nativeBalance(): Promise<bigint>;
  /** gas × gas price (wei) for `token.transfer(DEAD, amount)` from the deployer. */
  estimateFee(token: Hex, amount: bigint): Promise<bigint>;
  /** Signs `token.transfer(DEAD, amount)` (value 0). Returns the raw tx and its hash; does NOT broadcast. */
  signBurn(token: Hex, amount: bigint): Promise<{ raw: Hex; hash: Hex }>;
  broadcast(raw: Hex): Promise<Hex>;
  /** null when the tx is unknown / not mined yet. */
  getReceipt(hash: Hex): Promise<BurnReceipt | null>;
  /** Waits up to timeoutMs; throws on timeout. */
  waitReceipt(hash: Hex, timeoutMs: number): Promise<BurnReceipt>;
}

export const AUTO_BURN_KEY = 'forge:autoburn';
const TRANSFER_SELECTOR = '0xa9059cbb';
const TRANSIENT = /timeout|timed out|ECONN|socket|fetch failed|network|rate limit|internal error|40[38]|429|50[0234]|underpriced|already known|header not found|missing trie node|could not be found|took too long/i;
const NO_GAS = /insufficient funds|insufficient balance for transfer|gas required exceeds allowance/i;
const NONCE_GONE = /nonce too low|nonce has already been used/i;
const lc = (a: string) => a.toLowerCase();
const eq = (a?: string | null, b?: string | null) => !!a && !!b && lc(a) === lc(b);
const msgOf = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 300);

/** The single allowed call for the deployer key: `token.transfer(DEAD, amount)`, value 0. Throws on anything else. */
export function assertBurnCall(req: { to?: string | null; data?: Hex; value?: bigint }, token: string) {
  if (!req.to || !eq(req.to, token)) throw new Error('auto-burn guard: tx target is not the $FORGE token');
  if ((req.value ?? 0n) !== 0n) throw new Error('auto-burn guard: non-zero value');
  if (!req.data || !req.data.toLowerCase().startsWith(TRANSFER_SELECTOR)) throw new Error('auto-burn guard: not an ERC-20 transfer');
  const d = decodeFunctionData({ abi: erc20Abi, data: req.data });
  if (d.functionName !== 'transfer' || !eq(d.args[0] as string, DEAD)) throw new Error('auto-burn guard: recipient is not 0x…dEaD');
}

export interface AutoBurnEnv {
  enabled: boolean;
  /** Parsed key (0x + 64 hex) or null; `keyProblem` explains why it is unusable. Never logged. */
  key: Hex | null;
  keyProblem?: string;
}

/** FORGE_AUTO_BURN ('true' enables; default false) + FORGE_DEPLOYER_PRIVATE_KEY. */
export function loadAutoBurnEnv(env: Record<string, string | undefined> = process.env): AutoBurnEnv {
  const enabled = ['1', 'true', 'yes', 'on'].includes((env.FORGE_AUTO_BURN ?? '').trim().toLowerCase());
  const raw = (env.FORGE_DEPLOYER_PRIVATE_KEY ?? '').trim();
  if (!raw) return { enabled, key: null, keyProblem: 'FORGE_DEPLOYER_PRIVATE_KEY is not set' };
  const k = raw.startsWith('0x') || raw.startsWith('0X') ? `0x${raw.slice(2)}` : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(k)) return { enabled, key: null, keyProblem: 'FORGE_DEPLOYER_PRIVATE_KEY is malformed (expected 32-byte hex)' };
  return { enabled, key: k as Hex };
}

/** Production backend: its own public + wallet client (BSC mainnet), separate from the ops wallet. */
export function viemBurnBackend(key: Hex, rpcUrls: string[], opts: { publicClient?: PublicClient } = {}): BurnBackend {
  const account = privateKeyToAccount(key);
  const transport = () => (rpcUrls.length > 1 ? fallback(rpcUrls.map((u) => http(u, { retryCount: 1, timeout: 20_000 }))) : http(rpcUrls[0], { retryCount: 1, timeout: 20_000 }));
  const pc = opts.publicClient ?? (createPublicClient({ chain: bsc, transport: transport() }) as PublicClient);
  const wc = createWalletClient({ chain: bsc, transport: transport(), account });
  const data = (amount: bigint) => encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [DEAD, amount] });
  const gasFor = async (token: Hex, amount: bigint) => {
    const g = await pc.estimateGas({ account: account.address, to: token, data: data(amount), value: 0n });
    return (g * 13n) / 10n; // +30% headroom; unused gas is not charged
  };
  const getReceipt = async (hash: Hex): Promise<BurnReceipt | null> => {
    try {
      const r = await pc.getTransactionReceipt({ hash });
      return { status: r.status, blockNumber: r.blockNumber };
    } catch (e) {
      if (/could not be found|not found/i.test(msgOf(e))) return null;
      throw e;
    }
  };
  return {
    address: account.address,
    tokenBalance: (token) => pc.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] }),
    nativeBalance: () => pc.getBalance({ address: account.address }),
    async estimateFee(token, amount) {
      const [gas, price] = await Promise.all([gasFor(token, amount), pc.getGasPrice()]);
      return gas * price;
    },
    async signBurn(token, amount) {
      const req = { to: token, data: data(amount), value: 0n };
      assertBurnCall(req, token);
      const [gas, gasPrice, nonce] = await Promise.all([gasFor(token, amount), pc.getGasPrice(), pc.getTransactionCount({ address: account.address, blockTag: 'pending' })]);
      const raw = await wc.signTransaction({ ...req, gas, gasPrice, nonce, type: 'legacy', chain: bsc, account });
      return { raw, hash: keccak256(raw) };
    },
    broadcast: (raw) => pc.sendRawTransaction({ serializedTransaction: raw }),
    getReceipt,
    /** Polls every 750 ms; RPC hiccups while polling are ignored until the timeout. */
    async waitReceipt(hash, timeoutMs) {
      const end = Date.now() + timeoutMs;
      let last: unknown = null;
      while (Date.now() < end) {
        try {
          const r = await getReceipt(hash);
          if (r) return r;
        } catch (e) {
          last = e;
        }
        await new Promise((r) => setTimeout(r, 750));
      }
      throw new Error(`timed out waiting for receipt of ${hash}${last ? ` (last error: ${msgOf(last).slice(0, 120)})` : ''}`);
    },
  };
}

export interface ForgeAutoBurnerDeps {
  enabled: boolean;
  /** FORGE_DEPLOYER (public address). */
  deployer?: string;
  /** null when no usable key (status error when enabled). */
  backend: BurnBackend | null;
  keyProblem?: string;
  repo: Repository;
  log: Logger;
  bus?: Bus;
  ledger?: Ledger;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Max retries on transient errors (default 5). */
  retries?: number;
  retryBaseMs?: number;
  /** Insufficient-BNB-for-gas retry interval / give-up time (defaults 30 s / 1 h). */
  gasRetryMs?: number;
  gasWaitMaxMs?: number;
  receiptTimeoutMs?: number;
  /** Called after a successful burn (forge refresh + WS). */
  onBurned?: (r: { token: string; amountWei: bigint; txHash: string }) => Promise<void>;
}

export interface BurnContext {
  token: string;
  symbol?: string;
  priceUsd?: number;
}

export class ForgeAutoBurner {
  private state: AutoBurnState | null = null;
  private inflight: Promise<void> | null = null;
  /** Misconfiguration (enabled, but key missing/mismatched): refuses to sign, ever. */
  private refusal: string | null = null;
  private now: () => number;
  private sleep: (ms: number) => Promise<void>;
  private stopped = false;
  /** Set by ForgeService: refresh + WS `forge` after a successful burn. */
  onBurned?: (r: { token: string; amountWei: bigint; txHash: string }) => Promise<void>;

  constructor(private d: ForgeAutoBurnerDeps) {
    this.now = d.now ?? (() => Math.floor(Date.now() / 1000));
    this.sleep = d.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    if (d.enabled) {
      if (!d.deployer) this.refusal = 'FORGE_DEPLOYER is not set';
      else if (!d.backend) this.refusal = d.keyProblem ?? 'FORGE_DEPLOYER_PRIVATE_KEY is not set';
      else if (!eq(d.backend.address, d.deployer)) this.refusal = 'FORGE_DEPLOYER_PRIVATE_KEY does not match FORGE_DEPLOYER';
      if (this.refusal) {
        this.keyAddress = d.backend?.address ?? null;
        // Drop the backend so the key can never be used.
        this.d = { ...d, backend: null };
      }
    }
  }
  private keyAddress: string | null = null;
  private announced = false;

  /** Logged from init(), not the constructor (the app logger may not exist yet at construction). */
  private announce() {
    if (this.announced || !this.d.enabled) return;
    this.announced = true;
    if (this.refusal) this.d.log.error({ deployer: this.d.deployer ?? null, keyAddress: this.keyAddress }, `$FORGE auto-burn REFUSED: ${this.refusal}. Nothing will be signed.`);
    else this.d.log.info({ deployer: lc(this.d.backend!.address) }, '$FORGE auto-burn armed: deployer balance will be sent to 0x…dEaD once $FORGE is discovered');
  }

  get enabled() {
    return this.d.enabled;
  }
  /** Enabled and correctly configured (fast discovery polling makes sense). */
  get armed() {
    return this.d.enabled && !this.refusal;
  }

  stop() {
    this.stopped = true;
  }

  async init() {
    this.announce();
    const raw = await this.d.repo.getMeta(AUTO_BURN_KEY);
    this.state = raw ? (JSON.parse(raw) as AutoBurnState) : null;
  }

  status(): AutoBurnStatus {
    if (!this.d.enabled) {
      // Show a past burn even if the flag was turned off later.
      const s = this.state;
      if (s && (s.status === 'done' || s.status === 'nothing')) return this.publicOf(s, false);
      return { enabled: false, status: 'idle' };
    }
    if (this.refusal) return { enabled: true, status: 'error', detail: this.refusal };
    if (!this.state) return { enabled: true, status: 'waiting', detail: 'waiting for $FORGE discovery' };
    return this.publicOf(this.state, true);
  }

  private publicOf(s: AutoBurnState, enabled: boolean): AutoBurnStatus {
    const out: AutoBurnStatus = { enabled, status: s.status };
    if (s.txHash && s.status !== 'nothing') out.txHash = s.txHash;
    if (s.amountWei && (s.status === 'done' || s.status === 'waiting')) out.amount = Number(BigInt(s.amountWei) / 10n ** 14n) / 1e4;
    if (s.detail) out.detail = s.detail;
    return out;
  }

  private async save(patch: Partial<AutoBurnState>) {
    this.state = { ...(this.state ?? { status: 'waiting' }), ...patch, updatedAt: this.now() };
    await this.d.repo.setMeta(AUTO_BURN_KEY, JSON.stringify(this.state));
  }

  /** Fire-and-forget entry: safe to call repeatedly; one run at a time; never throws. */
  trigger(ctx: BurnContext): Promise<void> {
    if (!this.armed) return Promise.resolve();
    if (this.inflight) return this.inflight;
    this.inflight = this.run(ctx)
      .catch((err) => this.d.log.error({ err: msgOf(err) }, '$FORGE auto-burn crashed'))
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  private async run(ctx: BurnContext) {
    if (!this.state) await this.init();
    const s = this.state;
    if (s && (s.status === 'done' || s.status === 'nothing')) return; // exactly once
    const be = this.d.backend!;
    const token = lc(ctx.token) as Hex;
    const started = Date.now();
    await this.save({ status: 'waiting', token, detectedAt: s?.detectedAt ?? this.now(), detail: 'burning' });

    let gasWaitStart: number | null = null;
    const retries = this.d.retries ?? 5;
    for (let attempt = 0; !this.stopped; ) {
      try {
        // A tx signed earlier (previous run / previous iteration): settle it before anything else — never sign a
        // second burn while the first can still land.
        if (this.state!.raw && this.state!.txHash) {
          if (await this.settlePending(ctx)) return;
          if (++attempt > retries) throw new Error('burn tx reverted/dropped too many times');
        }
        const amount = await be.tokenBalance(token);
        if (amount === 0n) {
          await this.save({ status: 'nothing', amountWei: '0', detail: 'nothing to burn (deployer $FORGE balance is 0)', raw: undefined, txHash: undefined });
          this.d.log.warn({ deployer: lc(be.address), token }, '$FORGE auto-burn: deployer balance is 0 — nothing to burn (recorded, will not retry)');
          return;
        }
        const [fee, bnb] = await Promise.all([be.estimateFee(token, amount), be.nativeBalance()]);
        if (bnb < fee) throw Object.assign(new Error(`insufficient funds: deployer has ${bnb} wei BNB, needs ~${fee} wei for gas`), { noGas: true });
        const { raw, hash } = await be.signBurn(token, amount);
        await this.save({ raw, txHash: hash, amountWei: amount.toString(), detail: 'tx sent, waiting for receipt' });
        try {
          await this.broadcast(raw, hash);
        } catch (err) {
          // Never reached the mempool for sure → forget it (same nonce gets re-signed next time).
          if (NO_GAS.test(msgOf(err)) || !TRANSIENT.test(msgOf(err))) await this.save({ raw: undefined, txHash: undefined });
          throw err;
        }
        this.d.log.info({ deployer: lc(be.address), token, amount: amount.toString(), hash, latencyMs: Date.now() - started }, '$FORGE auto-burn tx broadcast');
        if (await this.settlePending(ctx, true)) return;
        if (++attempt > retries) throw new Error('burn tx reverted/dropped too many times');
      } catch (err) {
        const m = msgOf(err);
        if ((err as { noGas?: boolean }).noGas || NO_GAS.test(m)) {
          gasWaitStart ??= Date.now();
          const waited = Date.now() - gasWaitStart;
          if (waited >= (this.d.gasWaitMaxMs ?? 3_600_000)) {
            await this.save({ status: 'error', detail: 'deployer had insufficient BNB for gas for 1 h; fund it and restart' });
            this.d.log.error({ deployer: lc(be.address), token }, '$FORGE auto-burn GAVE UP: deployer has insufficient BNB for gas (waited 1 h). Fund the deployer and restart the service.');
            return;
          }
          await this.save({ status: 'waiting', detail: 'deployer needs BNB for gas' });
          this.d.log.error({ deployer: lc(be.address), token, waitedSec: Math.round(waited / 1000), err: m }, '$FORGE auto-burn: deployer has INSUFFICIENT BNB FOR GAS — send a little BNB to the deployer; retrying every 30 s for up to 1 h');
          await this.sleep(this.d.gasRetryMs ?? 30_000);
          continue;
        }
        gasWaitStart = null;
        if (!TRANSIENT.test(m) || attempt >= retries) {
          await this.save({ status: 'error', detail: `burn failed: ${m.slice(0, 160)}` });
          this.d.log.error({ deployer: lc(be.address), token, err: m, attempt }, '$FORGE auto-burn FAILED (will retry on next restart)');
          return;
        }
        const delay = (this.d.retryBaseMs ?? 1000) * 2 ** attempt;
        attempt++;
        this.d.log.warn({ err: m, attempt, delayMs: delay }, '$FORGE auto-burn: transient error; retrying');
        await this.sleep(delay);
      }
    }
  }

  /** 'sent' (accepted or already known) | 'nonceGone' (nonce already used: mined, or replaced by another tx). */
  private async broadcast(raw: Hex, hash: Hex): Promise<'sent' | 'nonceGone'> {
    try {
      const h = await this.d.backend!.broadcast(raw);
      if (!eq(h, hash)) this.d.log.warn({ expected: hash, got: h }, '$FORGE auto-burn: RPC returned a different hash');
      return 'sent';
    } catch (err) {
      const m = msgOf(err);
      if (/already known|already imported|known transaction/i.test(m)) return 'sent';
      if (NONCE_GONE.test(m)) return 'nonceGone';
      throw err;
    }
  }

  /**
   * Settles the persisted tx. true = done; false = the tx is dead (reverted, or its nonce was consumed by another tx)
   * and a fresh burn may be attempted. Throws (transient) when it simply can't tell yet.
   */
  private async settlePending(ctx: BurnContext, justSent = false): Promise<boolean> {
    const be = this.d.backend!;
    const st = this.state!;
    const hash = st.txHash as Hex;
    let r = justSent ? null : await be.getReceipt(hash).catch(() => null);
    if (justSent) r = await be.waitReceipt(hash, this.d.receiptTimeoutMs ?? 120_000);
    else if (!r) {
      // (Re)broadcast the exact same signed tx; harmless if it is already pending.
      if ((await this.broadcast(st.raw!, hash)) === 'nonceGone') {
        r = await be.getReceipt(hash);
        if (!r) {
          this.d.log.warn({ hash }, '$FORGE auto-burn: signed tx was replaced (nonce used by another tx); rebuilding');
          await this.save({ raw: undefined, txHash: undefined, detail: 'previous tx dropped; retrying' });
          return false;
        }
      } else r = await be.waitReceipt(hash, this.d.receiptTimeoutMs ?? 120_000);
    }
    if (r.status === 'success') {
      await this.finish(ctx, BigInt(st.amountWei ?? '0'), hash);
      return true;
    }
    this.d.log.error({ hash }, '$FORGE auto-burn tx reverted; rebuilding from the current balance');
    await this.save({ raw: undefined, txHash: undefined, detail: 'previous tx reverted; retrying' });
    return false;
  }

  private async finish(ctx: BurnContext, amountWei: bigint, txHash: string) {
    const ts = this.now();
    await this.save({ status: 'done', amountWei: amountWei.toString(), txHash, raw: undefined, detail: undefined, doneAt: ts });
    const tokens = Number(amountWei / 10n ** 14n) / 1e4;
    this.d.log.info({ deployer: lc(this.d.backend!.address), token: ctx.token, amount: amountWei.toString(), txHash, detectToDoneSec: this.state!.detectedAt ? ts - this.state!.detectedAt : null }, '$FORGE auto-burn DONE: deployer balance sent to 0x…dEaD');
    try {
      if (this.d.ledger) {
        const usd = tokens * (ctx.priceUsd ?? 0);
        await this.d.ledger.burn({ id: `autoburn-${txHash}`, kind: 'BURN', amount: tokens, txHash, timestamp: ts }, usd);
        await this.d.ledger.activity({ address: ctx.token, ticker: ctx.symbol ?? 'FORGE' }, 'BURN', `deployer auto-burned ${fmtTokens(tokens)} $${ctx.symbol ?? 'FORGE'} → 0x…dEaD`, usd || undefined, ts);
      }
      await (this.onBurned ?? this.d.onBurned)?.({ token: ctx.token, amountWei, txHash });
    } catch (err) {
      this.d.log.warn({ err: msgOf(err) }, '$FORGE auto-burn: burn recorded on-chain but the burn/activity record failed');
    }
  }
}
