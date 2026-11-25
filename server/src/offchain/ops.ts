/**
 * Ops (hot) wallet executor with safety rails:
 *  - no OPS_PRIVATE_KEY → read-only: every action is recorded once as QUEUED and nothing is sent
 *  - OPS_PAUSED=true → same (kill switch)
 *  - rolling-24h cap OPS_DAILY_CAP_BNB on BNB leaving the wallet (value + gas; sweeps exempt) → BLOCKED
 *  - one global wallet lock (re-entrant within one action), local nonce tracking, retries on transient send errors
 *  - every tx (or attempt) is recorded in `ops_txs`
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import {
  encodeFunctionData,
  type Abi,
  type Account,
  type Chain,
  type Hex,
  type Log,
  type PublicClient,
  type WalletClient,
} from 'viem';
import type { EvmWallet } from '../evm.js';
import type { Logger } from '../log.js';
import type { OffchainStore } from './store.js';
import type { OpsTx, OpsTxKind, OpsTxStatus } from './types.js';

export interface TxRequest {
  to: Hex;
  data?: Hex;
  value?: bigint;
}

export interface TxReceiptLite {
  status: 'success' | 'reverted';
  transactionHash: Hex;
  blockNumber: bigint;
  gasUsed: bigint;
  effectiveGasPrice: bigint;
  logs: Log[];
}

export interface ReadParams {
  address: Hex;
  abi: Abi | readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
  blockNumber?: bigint;
}

/** Chain access for the ops wallet; `viemBackend` in prod, fakes in tests. */
export interface TxBackend {
  readonly address: Hex | null;
  getBalance(address: Hex): Promise<bigint>;
  read<T = unknown>(p: ReadParams): Promise<T>;
  /** gas × gas price for this request (wei). */
  estimateFee(req: TxRequest): Promise<bigint>;
  /** Pending nonce of the ops wallet. */
  getNonce(): Promise<number>;
  send(req: TxRequest, nonce: number): Promise<Hex>;
  wait(hash: Hex, timeoutMs: number): Promise<TxReceiptLite>;
  signTypedData(p: { domain: Record<string, unknown>; types: Record<string, readonly { name: string; type: string }[]>; primaryType: string; message: Record<string, unknown> }): Promise<Hex>;
}

export function viemBackend(o: { publicClient: PublicClient; walletClient: WalletClient | null; account: Account | null; chain: Chain }): TxBackend {
  const { publicClient: pc, walletClient: wc, account, chain } = o;
  const need = () => {
    if (!wc || !account) throw new OpsQueuedError('ops wallet not configured (OPS_PRIVATE_KEY unset)');
    return { wc, account };
  };
  return {
    address: account?.address ?? null,
    getBalance: (address) => pc.getBalance({ address }),
    read: (p) => pc.readContract(p as never) as Promise<never>,
    async estimateFee(req) {
      const from = account?.address;
      const [gas, price] = await Promise.all([pc.estimateGas({ account: from, to: req.to, data: req.data, value: req.value }), pc.getGasPrice()]);
      // +20% headroom: the estimate only gates caps/balance, the real fee is read from the receipt.
      return ((gas * 12n) / 10n) * price;
    },
    getNonce: () => pc.getTransactionCount({ address: need().account.address, blockTag: 'pending' }),
    async send(req, nonce) {
      const { wc, account } = need();
      return wc.sendTransaction({ account, chain, to: req.to, data: req.data, value: req.value ?? 0n, nonce });
    },
    async wait(hash, timeoutMs) {
      const r = await pc.waitForTransactionReceipt({ hash, timeout: timeoutMs });
      return { status: r.status, transactionHash: r.transactionHash, blockNumber: r.blockNumber, gasUsed: r.gasUsed, effectiveGasPrice: r.effectiveGasPrice ?? 0n, logs: r.logs };
    },
    signTypedData: (p) => need().wc.signTypedData({ ...(p as object), account: need().account } as never),
  };
}

export class OpsQueuedError extends Error {
  readonly code = 'OPS_QUEUED';
  constructor(message: string) {
    super(message);
    this.name = 'OpsQueuedError';
  }
}
export class OpsCapError extends Error {
  readonly code = 'OPS_CAP';
  constructor(message: string) {
    super(message);
    this.name = 'OpsCapError';
  }
}
export class OpsTxError extends Error {
  readonly code = 'OPS_TX_FAILED';
  constructor(
    message: string,
    readonly hash?: string,
  ) {
    super(message);
    this.name = 'OpsTxError';
  }
}
/** True for "can't act now" errors that should leave the work queued rather than count as a failure. */
export const isHold = (e: unknown) => e instanceof OpsQueuedError || e instanceof OpsCapError;

export interface OpsOptions {
  paused: boolean;
  dailyCapWei: bigint;
  retries?: number;
  timeoutMs?: number;
  retryDelayMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: Logger;
}

export interface SendMeta {
  kind?: OpsTxKind;
  label?: string;
  machine?: string | null;
  /** QUEUED / BLOCKED / FAILED-before-send attempts with the same key are recorded once. */
  dedupeKey?: string;
  /** Sweeps don't count against (nor are blocked by) the daily cap. */
  capExempt?: boolean;
}

interface Ctx {
  kind: OpsTxKind;
  machine?: string | null;
  locked: boolean;
}

const TRANSIENT = /timeout|timed out|ECONN|socket|fetch failed|network|nonce too low|already known|replacement|underpriced|rate limit|429|503|502/i;
const NONCE = /nonce too low|already known|replacement|underpriced/i;

export class OpsWallet {
  private chainLock: Promise<unknown> = Promise.resolve();
  private als = new AsyncLocalStorage<Ctx>();
  private nextNonce: number | null = null;
  private o: Required<Omit<OpsOptions, 'log'>> & { log?: Logger };

  constructor(
    private store: OffchainStore,
    readonly backend: TxBackend,
    opts: OpsOptions,
  ) {
    this.o = {
      retries: 3,
      timeoutMs: 180_000,
      retryDelayMs: 1500,
      now: () => Math.floor(Date.now() / 1000),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      ...opts,
    };
  }

  get address(): Hex | null {
    return this.backend.address;
  }
  /** Key present (can sign). */
  get ready() {
    return !!this.backend.address;
  }
  get paused() {
    return this.o.paused;
  }
  setPaused(p: boolean) {
    this.o.paused = p;
  }
  get dailyCapWei() {
    return this.o.dailyCapWei;
  }
  /** Can actually send right now (key present and not paused). */
  get active() {
    return this.ready && !this.o.paused;
  }

  spent24h() {
    return this.store.spentSince(this.o.now() - 86_400);
  }
  balance() {
    return this.address ? this.backend.getBalance(this.address) : Promise.resolve(0n);
  }
  read<T>(p: ReadParams) {
    return this.backend.read<T>(p);
  }

  /** Runs one action (pull, payout batch, burn, …) under the single global wallet lock. Re-entrant. */
  run<T>(ctx: { kind: OpsTxKind; machine?: string | null }, fn: () => Promise<T>): Promise<T> {
    const cur = this.als.getStore();
    if (cur?.locked) return this.als.run({ ...cur, ...ctx, locked: true }, fn);
    const go = () => this.als.run({ ...ctx, locked: true }, fn);
    const p = this.chainLock.then(go, go);
    this.chainLock = p.catch(() => undefined);
    return p;
  }

  private ctx(): Ctx | undefined {
    return this.als.getStore();
  }

  private async record(t: Omit<OpsTx, 'id' | 'createdAt' | 'updatedAt' | 'feeWei'> & { feeWei?: bigint }): Promise<OpsTx> {
    if (t.dedupeKey && (t.status === 'QUEUED' || t.status === 'BLOCKED' || t.status === 'FAILED')) {
      const dup = await this.store.findOpsTxByDedupe(t.dedupeKey, [t.status]);
      if (dup) {
        await this.store.updateOpsTx(dup.id, { updatedAt: this.o.now(), error: t.error ?? dup.error });
        return dup;
      }
    }
    const now = this.o.now();
    const row: OpsTx = { id: randomUUID(), createdAt: now, updatedAt: now, feeWei: 0n, ...t };
    await this.store.insertOpsTx(row);
    return row;
  }

  /** Sends one tx (waits for the receipt). Throws OpsQueuedError / OpsCapError / OpsTxError. */
  async send(req: TxRequest, meta: SendMeta = {}): Promise<{ hash: Hex; receipt: TxReceiptLite; tx: OpsTx }> {
    if (!this.ctx()?.locked) return this.run({ kind: meta.kind ?? 'OTHER', machine: meta.machine }, () => this.send(req, meta));
    const c = this.ctx()!;
    const kind = meta.kind ?? c.kind;
    const machine = meta.machine !== undefined ? meta.machine : (c.machine ?? null);
    const value = req.value ?? 0n;
    const base = { kind, label: meta.label, machine: machine ? machine.toLowerCase() : null, to: req.to.toLowerCase(), amountWei: value, dedupeKey: meta.dedupeKey ?? null };
    if (!this.ready) {
      await this.record({ ...base, status: 'QUEUED', error: 'read-only: OPS_PRIVATE_KEY not set' });
      throw new OpsQueuedError('ops wallet not configured (OPS_PRIVATE_KEY unset); action queued');
    }
    if (this.o.paused) {
      await this.record({ ...base, status: 'QUEUED', error: 'OPS_PAUSED=true' });
      throw new OpsQueuedError('ops wallet paused (OPS_PAUSED=true); action queued');
    }
    const fee = await this.backend.estimateFee(req);
    if (!meta.capExempt) {
      const spent = await this.spent24h();
      if (spent + value + fee > this.o.dailyCapWei) {
        const msg = `daily cap: spent ${spent} + ${value} + fee ${fee} > cap ${this.o.dailyCapWei} wei`;
        await this.record({ ...base, status: 'BLOCKED', error: msg });
        throw new OpsCapError(msg);
      }
    }
    const bal = await this.backend.getBalance(this.address!);
    if (bal < value + fee) {
      const msg = `insufficient ops wallet balance: have ${bal}, need ${value + fee} wei`;
      await this.record({ ...base, status: 'FAILED', error: msg });
      throw new OpsTxError(msg);
    }

    let hash: Hex | null = null;
    let nonce = -1;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.o.retries; attempt++) {
      try {
        nonce = Math.max(await this.backend.getNonce(), this.nextNonce ?? 0);
        hash = await this.backend.send(req, nonce);
        this.nextNonce = nonce + 1;
        break;
      } catch (err) {
        lastErr = err;
        const msg = String((err as Error)?.message ?? err);
        if (NONCE.test(msg)) this.nextNonce = null;
        if (!TRANSIENT.test(msg) || attempt === this.o.retries) break;
        this.o.log?.warn({ err: msg.slice(0, 200), attempt, kind }, 'ops send failed; retrying');
        await this.o.sleep(this.o.retryDelayMs * 2 ** attempt);
      }
    }
    if (!hash) {
      const msg = String((lastErr as Error)?.message ?? lastErr).slice(0, 500);
      await this.record({ ...base, status: 'FAILED', error: msg });
      throw new OpsTxError(`send failed: ${msg}`);
    }
    const tx = await this.record({ ...base, dedupeKey: null, status: 'SENT', hash, nonce, feeWei: fee });
    let receipt: TxReceiptLite;
    try {
      receipt = await this.backend.wait(hash, this.o.timeoutMs);
    } catch (err) {
      await this.store.updateOpsTx(tx.id, { updatedAt: this.o.now(), error: `receipt wait: ${String((err as Error)?.message ?? err).slice(0, 300)}` });
      throw new OpsTxError(`no receipt for ${hash} (tx left SENT; check BscScan)`, hash);
    }
    const feeWei = receipt.gasUsed * receipt.effectiveGasPrice;
    const status: OpsTxStatus = receipt.status === 'success' ? 'CONFIRMED' : 'FAILED';
    await this.store.updateOpsTx(tx.id, { status, feeWei, updatedAt: this.o.now(), ...(status === 'FAILED' ? { error: 'reverted' } : {}) });
    this.o.log?.info({ kind, label: meta.label, machine, hash, value: value.toString(), status }, 'ops tx');
    if (status !== 'CONFIRMED') throw new OpsTxError(`${meta.label ?? kind} reverted: ${hash}`, hash);
    return { hash, receipt, tx: { ...tx, status, feeWei } };
  }

  /** Contract call through `send`. */
  contract(p: { address: Hex; abi: Abi | readonly unknown[]; functionName: string; args?: readonly unknown[]; value?: bigint }, meta: SendMeta = {}) {
    const data = encodeFunctionData({ abi: p.abi as Abi, functionName: p.functionName, args: (p.args ?? []) as unknown[] });
    return this.send({ to: p.address, data, value: p.value }, { label: p.functionName, ...meta });
  }

  transfer(to: Hex, value: bigint, meta: SendMeta = {}) {
    return this.send({ to, value }, { label: 'transfer', ...meta });
  }

  estimateFee(req: TxRequest) {
    return this.backend.estimateFee(req);
  }

  /**
   * EvmWallet view for the Renaiss provider / PancakeSwap swapper / release job: writes go through `send` and are
   * recorded with the kind of the action they run in (or `kind`).
   */
  evmWallet(kind: OpsTxKind = 'OTHER'): EvmWallet {
    const self = this;
    return {
      get address() {
        if (!self.address) throw new OpsQueuedError('ops wallet not configured');
        return self.address;
      },
      read: (p) => self.backend.read(p as ReadParams),
      async write(p) {
        const meta: SendMeta = self.ctx()?.locked ? {} : { kind };
        const { receipt } = await self.contract(p as never, meta);
        return { transactionHash: receipt.transactionHash, status: receipt.status, blockNumber: receipt.blockNumber, logs: receipt.logs };
      },
      signTypedData: (p) => self.backend.signTypedData(p),
    };
  }
}
