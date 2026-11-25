/**
 * OFF-CHAIN MODE jobs (SPEC "OFF-CHAIN MODE" + "TAX MODEL v3"): registration ($FORGE included), pulls, strategy payouts,
 * creator payouts, burns, $FORGE buyback, TaxProcessor dispatch + reconciliation, auto-registration and the optional
 * platform sweep.
 * All value moves go through OpsWallet (caps, pause, lock, ops_txs records); all accounting through OffchainLedger.
 */
import { encodeFunctionData, erc20Abi, parseEventLogs, verifyMessage, type Hex } from 'viem';
import { registerMessage } from './message.js';
import { portalAbi, portalOpsAbi } from '../abi/flap.js';
import { taxProcessorAbi } from '../abi/token.js';
import { CREATOR_POT_MAX_BPS, CREATOR_POT_MIN_BPS, isValidPotShareBps, isValidTaxBps, PACK_PRICE_USD, TOTAL_SUPPLY_DEFAULT, proRata, selectAutoPush, splitProceeds, type HolderBalance } from '../core/index.js';
import type { ForgeToken } from '../forge/types.js';
import { fetchFlapMetadata } from '../forge/metadata.js';
import { excludedFor } from '../indexer/excluded.js';
import { fmtTokens, round2 } from '../ledger.js';
import type { Logger } from '../log.js';
import { planPull } from '../operator/settle.js';
import { enqueueCardReleases } from '../operator/release.js';
import { summaryCard, type CardProvider } from '../renaiss/types.js';
import { usdtToBuy, type Swapper } from '../swap/pancake.js';
import type { Machine, PackId, Strategy } from '../types.js';
import type { OffchainIndexer } from './indexer.js';
import { usdToWei, weiToBnb, weiToUsd, type OffchainLedger } from './ledger.js';
import { isHold, OpsTxError, type OpsWallet } from './ops.js';
import { RegistrationError, verifyLaunchTx, type ChainReader, type VerifiedLaunch } from './register.js';
import type { OffchainStore } from './store.js';
import type { LedgerEntry, PendingPayout, Registration } from './types.js';

export const DEAD = '0x000000000000000000000000000000000000dEaD' as const;
const ZERO = '0x0000000000000000000000000000000000000000';
const BPS = 10_000n;
const lc = (a: string) => a.toLowerCase();
const eq = (a?: string | null, b?: string | null) => !!a && !!b && lc(a) === lc(b);
const plusBps = (x: bigint, bps: number) => (x * (BPS + BigInt(bps))) / BPS;
const minusBps = (x: bigint, bps: number) => (x * (BPS - BigInt(bps))) / BPS;
const divQueueKey = (token: string) => `offchain:divq:${lc(token)}`;
const deadPendingKey = (token: string) => `offchain:deadpending:${lc(token)}`;
const errMsg = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 300);

export interface EngineConfig {
  chainId: number;
  portal: string;
  vaultPortal: string;
  treasury: string;
  pancakeRouter?: string;
  excluded: string[];
  pullBufferBps: number;
  swapBufferBps: number;
  cooldownSec: number;
  dividendMinWei: bigint;
  dividendBatch: number;
  buybackMinWei: bigint;
  burnMinWei: bigint;
  burnSlippageBps: number;
  dispatchMaxGasPct: number;
  autoRegisterDelaySec: number;
  sweepTo?: string;
  sweepMinWei: bigint;
  reserveWei: bigint;
  forgeDeployer?: string;
  ipfsGateway: string;
  renaissReady: boolean;
  /** Creator payouts run once a creator's owed balance ≥ this (CREATOR_PAYOUT_MIN_BNB). */
  creatorPayoutMinWei: bigint;
  /** $FORGE auto-registration (FORGE_PACK / FORGE_STRATEGY). */
  forgePack: PackId;
  forgeStrategy: Strategy;
}

/** Chain reads the engine needs (viem PublicClient fits). */
export interface EngineClient extends ChainReader {
  getBlock(p: { blockNumber: bigint }): Promise<{ hash: Hex | null; timestamp: bigint }>;
  getBalance(p: { address: Hex }): Promise<bigint>;
  multicall?(p: any): Promise<any[]>;
}

export interface EngineDeps {
  cfg: EngineConfig;
  store: OffchainStore;
  accounts: OffchainLedger;
  ops: OpsWallet;
  provider: CardProvider | null;
  swapper: Swapper | null;
  client: EngineClient;
  indexer: OffchainIndexer;
  bnbUsd: () => Promise<number>;
  /** Discovered $FORGE address (null while waiting). */
  forgeToken: () => Promise<string | null>;
  /** Discovered $FORGE token (for auto-registration as a machine when its tax goes to the treasury). */
  forgeInfo?: () => Promise<ForgeToken | null>;
  log: Logger;
  now?: () => number;
  fetch?: typeof fetch;
}

export interface RegisterParams {
  txHash: string;
  pack: PackId;
  strategy: Strategy;
  split?: { dividendBps: number; burnBps: number; lpBps: number };
  /** TAX MODEL v3: must equal the token's on-chain tax (100–1000 bps, whole %). */
  buyTaxBps?: number;
  sellTaxBps?: number;
  /** Pot share of the creator share, 2000–10000 bps. */
  potShareBps?: number;
  /** Creator payout address; default = launch tx sender. */
  payout?: string;
  /** EIP-191 personal_sign by the launch tx sender over registerMessage(...). */
  signature: string;
}

/** What adopt() stores (immutable once registered). */
export interface AdoptParams {
  pack: PackId;
  strategy: Strategy;
  split?: { dividendBps: number; burnBps: number; lpBps: number };
  /** Default 'creator'. */
  taxModel?: 'creator' | 'forge';
  /** 'creator' only; default 10000 (all of the creator share to the pot). */
  potShareBps?: number;
  /** 'creator' only; default = launch tx sender. */
  payout?: string;
}

const ADDR = /^0x[0-9a-fA-F]{40}$/;

/** What the sweep may move: platform share, minus everything owed and the gas reserve, never more than the balance. */
export function sweepableWei(p: { balanceWei: bigint; platformWei: bigint; owedWei: bigint; reserveWei: bigint }): bigint {
  const free = p.balanceWei - p.owedWei - p.reserveWei;
  const v = free < p.platformWei ? free : p.platformWei;
  return v > 0n ? v : 0n;
}

/** Dividend round: pro-rata over the snapshot; shares below `minWei` stay in the bucket (dust carry-over). */
export function planPayouts(totalWei: bigint, eligible: HolderBalance[], minWei: bigint) {
  const allocs = proRata(eligible, totalWei);
  const payouts = selectAutoPush(allocs, minWei > 0n ? minWei : 1n);
  const paid = payouts.reduce((s, a) => s + a.amount, 0n);
  return { payouts, carryWei: totalWei - paid };
}

export class OffchainEngine {
  private busy = new Set<string>();
  private warned = new Set<string>();

  constructor(private d: EngineDeps) {}

  private get cfg() {
    return this.d.cfg;
  }
  private get accounts() {
    return this.d.accounts;
  }
  private get repo() {
    return this.d.accounts.repo;
  }
  private get ledger() {
    return this.d.accounts.ledger;
  }
  private get ops() {
    return this.d.ops;
  }
  private now() {
    return this.d.now?.() ?? Math.floor(Date.now() / 1000);
  }
  private warnOnce(key: string, obj: object, msg: string) {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.d.log.warn(obj, msg);
  }

  // ───────────────────────────── registration ─────────────────────────────

  async register(p: RegisterParams, by: 'api' | 'auto' = 'api'): Promise<{ machine: Machine; created: boolean }> {
    if (p.strategy === 'SPLIT') {
      const s = p.split;
      if (!s || [s.dividendBps, s.burnBps, s.lpBps].some((x) => !Number.isInteger(x) || x < 0) || s.dividendBps + s.burnBps + s.lpBps !== 10_000)
        throw new RegistrationError('invalid_params', 'SPLIT needs split { dividendBps, burnBps, lpBps } summing to 10000', 400);
    }
    // v3 request: the creator signs tax rates + pot share + payout. Pre-v3 clients (none of them) sign the old message
    // and get the auto-registration defaults (on-chain tax, everything to the pot, payout = launch wallet).
    const v3 = p.buyTaxBps !== undefined || p.sellTaxBps !== undefined || p.potShareBps !== undefined || p.payout !== undefined;
    if (v3) {
      if (p.buyTaxBps === undefined || p.sellTaxBps === undefined || p.potShareBps === undefined)
        throw new RegistrationError('invalid_params', 'buyTaxBps, sellTaxBps and potShareBps are all required', 400);
      if (!isValidTaxBps(p.buyTaxBps) || !isValidTaxBps(p.sellTaxBps))
        throw new RegistrationError('invalid_params', 'buyTaxBps / sellTaxBps must each be 100–1000 in whole % (1%–10%)', 400, { buyTaxBps: p.buyTaxBps, sellTaxBps: p.sellTaxBps });
      if (!isValidPotShareBps(p.potShareBps))
        throw new RegistrationError('invalid_params', `potShareBps must be ${CREATOR_POT_MIN_BPS}–${CREATOR_POT_MAX_BPS} (at least 20% of the creator share goes to the gacha pot)`, 400, { potShareBps: p.potShareBps });
      if (p.payout !== undefined && (!ADDR.test(p.payout) || eq(p.payout, ZERO))) throw new RegistrationError('invalid_params', 'payout must be a non-zero 0x address', 400);
    }
    if (!/^0x[0-9a-fA-F]+$/.test(p.signature ?? '')) throw new RegistrationError('bad_signature', 'signature (personal_sign by the launch tx sender) is required', 400);
    const v = await verifyLaunchTx(this.d.client, { txHash: p.txHash, portal: this.cfg.portal, treasury: this.cfg.treasury, ...(v3 ? { tax: { buyTaxBps: p.buyTaxBps, sellTaxBps: p.sellTaxBps } } : {}) });
    const payout = lc(p.payout ?? v.txFrom);
    const message = registerMessage({
      token: v.token,
      pack: p.pack,
      strategy: p.strategy,
      split: p.split,
      ...(v3 ? { buyTaxBps: p.buyTaxBps, sellTaxBps: p.sellTaxBps, potShareBps: p.potShareBps, payout } : {}),
      chainId: this.cfg.chainId,
    });
    const ok = await verifyMessage({ address: v.txFrom as Hex, message, signature: p.signature as Hex }).catch(() => false);
    if (!ok) throw new RegistrationError('bad_signature', `signature is not from the launch tx sender ${v.txFrom} over the registration message`, 401, { expectedSigner: v.txFrom, message });
    return this.adopt(v, { pack: p.pack, strategy: p.strategy, split: p.split, taxModel: 'creator', potShareBps: v3 ? p.potShareBps : CREATOR_POT_MAX_BPS, payout }, by);
  }

  /**
   * Persists a verified launch. Pack, strategy, split, tax rates, pot share and payout are immutable: a second
   * registration must match exactly.
   */
  async adopt(v: VerifiedLaunch, p: AdoptParams, by: 'api' | 'auto' | 'forge'): Promise<{ machine: Machine; created: boolean }> {
    const model = p.taxModel ?? 'creator';
    if (by !== 'forge') {
      const forge = await this.d.forgeToken().catch(() => null);
      if (eq(forge, v.token) || (this.cfg.forgeDeployer && eq(v.creator, this.cfg.forgeDeployer) && by === 'auto'))
        throw new RegistrationError('forge_token', '$FORGE is the platform token, not a gacha machine', 409);
    }
    const split = p.strategy === 'SPLIT' ? p.split : undefined;
    const potShareBps = model === 'creator' ? (p.potShareBps ?? CREATOR_POT_MAX_BPS) : undefined;
    const payout = model === 'creator' ? lc(p.payout ?? v.txFrom) : undefined;
    const existing = await this.d.store.getRegistration(v.token);
    if (existing) {
      const v3 = !!existing.taxModel && existing.taxModel !== 'legacy';
      const same =
        existing.pack === p.pack &&
        existing.strategy === p.strategy &&
        JSON.stringify(existing.split ?? null) === JSON.stringify(split ?? null) &&
        (!v3 || (existing.taxModel === model && existing.potShareBps === potShareBps && (existing.payout ?? undefined) === payout));
      if (!same)
        throw new RegistrationError('already_registered', `machine already registered with ${existing.pack}/${existing.strategy}; registration is immutable`, 409, {
          pack: existing.pack,
          strategy: existing.strategy,
          split: existing.split ?? null,
          ...(v3 ? { potShareBps: existing.potShareBps ?? null, payout: existing.payout ?? null } : {}),
        });
      return { machine: (await this.repo.getMachine(v.token))!, created: false };
    }
    const now = this.now();
    const reg: Registration = {
      token: v.token,
      txHash: v.txHash,
      createdBlock: v.createdBlock,
      createdAt: v.createdAt,
      creator: v.creator,
      taxProcessor: v.taxProcessor,
      pack: p.pack,
      strategy: p.strategy,
      ...(split ? { split } : {}),
      registeredBy: by,
      registeredAt: now,
      taxModel: model,
      buyTaxBps: v.buyTaxBps,
      sellTaxBps: v.sellTaxBps,
      ...(potShareBps !== undefined ? { potShareBps } : {}),
      ...(payout ? { payout } : {}),
      ...(v.pool ? { pool: v.pool } : {}),
      syncedTo: v.createdBlock - 1,
      sentToTreasuryWei: '0',
      reconciledToEntryId: 0,
      lastPullAt: 0,
      round: 0,
      pullQueued: false,
    };
    const meta = v.meta ? await fetchFlapMetadata(v.meta, this.cfg.ipfsGateway, this.d.fetch ?? fetch, 5000).catch(() => null) : null;
    const graduated = v.status === 4;
    const m: Machine = {
      address: v.token,
      vault: v.taxProcessor,
      name: v.name || v.symbol,
      ticker: v.symbol,
      description: meta?.description ?? '',
      image: meta?.image ?? '',
      creator: v.creator,
      createdAt: v.createdAt,
      pack: p.pack,
      packPriceUsd: PACK_PRICE_USD[p.pack],
      strategy: p.strategy,
      taxBps: v.buyTaxBps,
      ...(split ? { split } : {}),
      stage: graduated ? 'GRADUATED' : 'CURVE',
      bondingCurvePct: graduated ? 100 : Math.min(100, round2(Number(v.progress) / 1e16)),
      marketCapUsd: 0,
      change24hPct: 0,
      volume24hUsd: 0,
      holders: 0,
      eligibleHolders: 0,
      potUsd: 0,
      packsOpened: 0,
      round: 0,
      paidToHoldersBnb: 0,
      burnedTokens: 0,
      ...(meta?.links ? { links: meta.links } : {}),
      pullQueued: false,
      buyTaxBps: v.buyTaxBps,
      sellTaxBps: v.sellTaxBps,
      taxModel: model,
      ...(potShareBps !== undefined ? { potShareBps } : {}),
      ...(payout ? { creatorPayout: payout, creatorPaidBnb: 0, creatorOwedBnb: 0 } : {}),
    };
    await this.d.store.saveRegistration(reg);
    await this.ledger.launch(m);
    this.d.log.info({ token: v.token, pack: p.pack, strategy: p.strategy, by, model, buyTaxBps: v.buyTaxBps, sellTaxBps: v.sellTaxBps, potShareBps, payout, createdBlock: v.createdBlock }, 'machine registered (offchain)');
    return { machine: (await this.repo.getMachine(v.token))!, created: true };
  }

  /**
   * $FORGE (SPEC "TAX MODEL v3" B): once discovered, if its tax recipient is the treasury, register it as a machine with
   * the $FORGE split (90% company / 7% pot / 3% buyback), FORGE_PACK / FORGE_STRATEGY. Otherwise display/trade-only.
   */
  async tickForgeRegister() {
    const t = await this.d.forgeInfo?.().catch(() => null);
    if (!t?.address) return null;
    if (await this.d.store.getRegistration(t.address)) return null;
    if (!eq(t.taxRecipient, this.cfg.treasury)) {
      this.warnOnce(`forge-recipient:${t.address}:${t.taxRecipient}`, { forge: t.address, taxRecipient: t.taxRecipient ?? null, treasury: this.cfg.treasury }, '$FORGE tax recipient is not the treasury: display/trade-only (not registered as a machine)');
      return null;
    }
    if (!t.createdTx) {
      this.warnOnce(`forge-notx:${t.address}`, { forge: t.address }, '$FORGE creation tx unknown: cannot auto-register it as a machine');
      return null;
    }
    try {
      const v = await verifyLaunchTx(this.d.client, { txHash: t.createdTx, portal: this.cfg.portal, treasury: this.cfg.treasury, tax: { anyRate: true } });
      if (!eq(v.token, t.address)) return null;
      return await this.adopt(v, { pack: this.cfg.forgePack, strategy: this.cfg.forgeStrategy, taxModel: 'forge' }, 'forge');
    } catch (err) {
      this.warnOnce(`forge-reg:${t.address}:${err instanceof RegistrationError ? err.code : 'rpc'}`, { err: errMsg(err), forge: t.address }, '$FORGE auto-registration failed');
      return null;
    }
  }

  /**
   * Portal TokenCreated with tax → treasury, unregistered after AUTO_REGISTER_DELAY_SEC → register FORGE_28 / RAFFLE with
   * the on-chain tax rates, potShare 10000 (all of the creator share to the pot) and payout = launch tx sender.
   */
  async tickAutoRegister() {
    const cands = await this.d.indexer.candidates();
    if (!cands.length) return;
    const keep = [];
    const now = this.now();
    for (const c of cands) {
      if (await this.d.store.getRegistration(c.token)) continue;
      if (now < c.ts + this.cfg.autoRegisterDelaySec) {
        keep.push(c);
        continue;
      }
      try {
        const v = await verifyLaunchTx(this.d.client, { txHash: c.txHash, portal: this.cfg.portal, treasury: this.cfg.treasury });
        if (!eq(v.token, c.token)) continue;
        await this.adopt(v, { pack: 'FORGE_28', strategy: 'RAFFLE', taxModel: 'creator', potShareBps: CREATOR_POT_MAX_BPS, payout: v.txFrom }, 'auto');
      } catch (err) {
        // not ours (other recipient / tax) or the $FORGE token: drop. RPC trouble: retry next round.
        if (!(err instanceof RegistrationError)) keep.push(c);
      }
    }
    await this.d.indexer.setCandidates(keep);
  }

  // ───────────────────────────── pulls ─────────────────────────────

  async tickPulls() {
    for (const r of await this.d.store.listRegistrations()) {
      if (this.busy.has(r.token)) continue;
      this.busy.add(r.token);
      try {
        await this.maybePull(r.token);
      } catch (err) {
        this.d.log.error({ err: errMsg(err), machine: r.token }, 'offchain pull failed');
      } finally {
        this.busy.delete(r.token);
      }
    }
  }

  private async setQueued(reg: Registration, queued: boolean, reason?: string) {
    if (reg.pullQueued === queued && reg.pullQueuedReason === reason) return;
    reg.pullQueued = queued;
    if (reason) reg.pullQueuedReason = reason;
    else delete reg.pullQueuedReason;
    await this.d.store.saveRegistration(reg);
    await this.ledger.updateMachine(reg.token, () => ({ pullQueued: queued }));
  }

  /** Opens a pull when the virtual pot covers the pack (Chainlink BNB/USD), one at a time per machine, after cooldown. */
  async maybePull(token: string) {
    const reg = await this.d.store.getRegistration(token);
    const m = await this.repo.getMachine(token);
    if (!reg || !m) return;
    if (reg.openPull) {
      this.warnOnce(`open:${reg.openPull.key}`, { machine: token, openPull: reg.openPull }, 'pull left open (needs recovery; see docs/OFFCHAIN-OPS.md)');
      return;
    }
    if (this.now() - reg.lastPullAt < this.cfg.cooldownSec) return;
    const bnbUsd = await this.d.bnbUsd();
    const packWei = usdToWei(m.packPriceUsd, bnbUsd);
    const potWei = await this.accounts.potWei(token);
    if (packWei <= 0n || potWei < packWei) {
      if (reg.pullQueued) await this.setQueued(reg, false);
      return;
    }
    const reason = !this.cfg.renaissReady || !this.d.provider ? 'renaiss_key_missing' : !this.ops.ready || !this.d.swapper ? 'ops_wallet_missing' : this.ops.paused ? 'ops_paused' : null;
    if (reason) return this.setQueued(reg, true, reason);
    if (reg.pullQueued) await this.setQueued(reg, false);
    const maxBnb = (() => {
      const cap = plusBps(packWei, this.cfg.pullBufferBps);
      return potWei < cap ? potWei : cap;
    })();
    try {
      await this.ops.run({ kind: 'PULL', machine: token }, () => this.pull(reg, m, maxBnb));
    } catch (err) {
      if (isHold(err)) {
        await this.setQueued((await this.d.store.getRegistration(token))!, true, (err as Error).name === 'OpsCapError' ? 'daily_cap' : 'ops_queued');
        return;
      }
      throw err;
    }
  }

  private async snapshot(token: string, block: number): Promise<HolderBalance[]> {
    const known = await this.repo.getBalances(token);
    if (!known.length || !this.d.client.multicall) return known;
    try {
      const res = await this.d.client.multicall({
        contracts: known.map((h) => ({ address: token as Hex, abi: erc20Abi, functionName: 'balanceOf', args: [h.address as Hex] })),
        blockNumber: BigInt(block),
        allowFailure: false,
      });
      return known.map((h, i) => ({ address: h.address, balance: res[i] as bigint }));
    } catch {
      return known; // indexed balances are exact as of `block` (syncedTo)
    }
  }

  private async pull(reg0: Registration, m: Machine, maxBnb: bigint) {
    const provider = this.d.provider!;
    const swapper = this.d.swapper!;
    const token = reg0.token;
    const round = reg0.round + 1;
    const key = `${token}-${round}`;
    const snapshotBlock = reg0.syncedTo;
    const balances = await this.snapshot(token, snapshotBlock);
    const save = async (patch: Partial<Registration>) => {
      const r = { ...(await this.d.store.getRegistration(token))!, ...patch };
      await this.d.store.saveRegistration(r);
      return r;
    };
    await save({ openPull: { key, round, stage: 'STARTED', startedAt: this.now(), snapshotBlock } });

    // 1. BNB → USDT (just the shortfall + buffer, capped at pack price +10%)
    let swap: { bnb: bigint; usdt: bigint; txHash?: string };
    try {
      const cost = await provider.packCost(m.pack);
      const bal = await swapper.usdtBalance();
      const toBuy = usdtToBuy(cost.usdt, bal, this.cfg.swapBufferBps);
      swap = toBuy > 0n ? await swapper.buyExactUsdt(toBuy, maxBnb) : { bnb: 0n, usdt: 0n };
    } catch (err) {
      await save({ openPull: null });
      throw err;
    }
    await this.accounts.book([{ ref: `pull:${key}:spend`, ts: this.now(), machine: token, bucket: 'POT', kind: 'PULL_SPEND', amountWei: -swap.bnb, txHash: swap.txHash ?? null, data: { usdt: swap.usdt.toString() } }]);
    await this.accounts.syncPotUsd(token);
    await save({ openPull: { key, round, stage: 'SWAPPED', startedAt: this.now(), snapshotBlock, bnbSpentWei: swap.bnb.toString(), usdtBought: swap.usdt.toString() } });

    // 2. Renaiss pull (Permit2-signed USDT)
    let bought;
    try {
      bought = await provider.buyPack(m.pack, { onSubmitted: async (requestId) => void (await save({ openPull: { ...(await this.d.store.getRegistration(token))!.openPull!, requestId } })) });
    } catch (err) {
      this.d.log.error({ err: errMsg(err), key }, 'pack purchase failed; selling the USDT back to refill the pot');
      try {
        const back = swap.usdt > 0n ? await swapper.sellUsdt(swap.usdt) : { bnb: 0n, usdt: 0n };
        await this.accounts.book([{ ref: `pull:${key}:refund`, ts: this.now(), machine: token, bucket: 'POT', kind: 'PULL_REFUND', amountWei: back.bnb, txHash: back.txHash ?? null }]);
        await this.accounts.syncPotUsd(token);
        await save({ openPull: null, lastPullAt: this.now() });
      } catch (err2) {
        await save({ openPull: { ...(await this.d.store.getRegistration(token))!.openPull!, error: `buy: ${errMsg(err)}; refund: ${errMsg(err2)}` } });
      }
      throw err;
    }
    const cards = bought.cards;
    const card = summaryCard(cards);
    await save({ round, lastPullAt: this.now(), openPull: { ...(await this.d.store.getRegistration(token))!.openPull!, stage: 'BOUGHT', requestId: bought.pullId } });
    await this.ledger.updateMachine(token, (x) => ({ packsOpened: x.packsOpened + 1, round }));

    // 3. snapshot → decide (shared core: eligibility ≥0.01%, deterministic seed = keccak(blockhash, pullId))
    const block = await this.d.client.getBlock({ blockNumber: BigInt(snapshotBlock) });
    const reg = (await this.d.store.getRegistration(token))!;
    const excluded = [...(await excludedFor(this.repo, m, [this.cfg.portal, this.cfg.vaultPortal, this.cfg.pancakeRouter ?? ZERO, this.ops.address ?? ZERO, ...this.cfg.excluded])), lc(reg.taxProcessor)];
    const plan = planPull({ machine: m, card, balances, totalSupply: TOTAL_SUPPLY_DEFAULT, excluded, blockHash: block.hash!, pullId: BigInt(round), pullKey: key, snapshotBlock: BigInt(snapshotBlock) });
    await this.repo.setRaffleProof(plan.proof);
    const base = { id: key, machine: token, ticker: m.ticker, pack: m.pack, round, card, txHash: swap.txHash ?? bought.fundingTxHash ?? '', timestamp: this.now() };

    if (plan.outcome === 'RAFFLE' && plan.winner) {
      await enqueueCardReleases(this.ledger, { pullKey: key, machine: token, ticker: m.ticker, winner: plan.winner, cards });
      await this.ledger.pull({ ...base, result: 'WON', winner: plan.winner });
      await save({ openPull: null });
      this.d.log.info({ key, winner: plan.winner, cards: cards.length }, 'raffle drawn; card delivery queued');
      return;
    }

    // 4. sell back → USDT → BNB → strategy
    const { sold, proceeds } = await this.ops.run({ kind: 'SELLBACK', machine: token }, async () => {
      const sold = await provider.sellBack(cards);
      const sw = await swapper.sellUsdt(sold.proceedsUsdt);
      return { sold, proceeds: sw };
    });
    await save({ openPull: { ...(await this.d.store.getRegistration(token))!.openPull!, stage: 'SOLD' } });
    const routed = await this.routeProceeds(reg, key, proceeds.bnb, plan.eligible, proceeds.txHash ?? sold.txRef);
    await this.ledger.pull({ ...base, result: routed.burnOnly ? 'BURNED' : 'SOLD', proceedsBnb: Math.round(weiToBnb(proceeds.bnb) * 1e6) / 1e6, txHash: proceeds.txHash ?? base.txHash });
    await save({ openPull: null });
    this.d.log.info({ key, proceedsWei: proceeds.bnb.toString(), strategy: m.strategy, ...routed }, 'pull sold back');
  }

  /**
   * Sell-back proceeds by strategy: RAFFLE (no eligible) → pot; HIT_HUNTER miss / BURN → burn bucket; DIVIDEND → dividend
   * bucket (+ payout queue over the pull snapshot); SPLIT → dividend/burn by creator bps (LP share is burned).
   */
  async routeProceeds(reg: Registration, key: string, wei: bigint, eligible: HolderBalance[], txHash?: string) {
    const s = reg.strategy === 'RAFFLE' ? { pot: wei, dividend: 0n, burn: 0n, lp: 0n } : splitProceeds(wei, reg.strategy, reg.split, false);
    const ts = this.now();
    const e: LedgerEntry[] = [];
    if (s.pot > 0n) e.push({ ref: `pull:${key}:sellback:POT`, ts, machine: reg.token, bucket: 'POT', kind: 'SELLBACK', amountWei: s.pot, txHash });
    if (s.dividend > 0n) e.push({ ref: `pull:${key}:sellback:DIVIDEND`, ts, machine: reg.token, bucket: 'DIVIDEND', kind: 'SELLBACK', amountWei: s.dividend, txHash });
    if (s.burn + s.lp > 0n) e.push({ ref: `pull:${key}:sellback:BURN`, ts, machine: reg.token, bucket: 'BURN', kind: 'SELLBACK', amountWei: s.burn + s.lp, txHash });
    await this.accounts.book(e);
    if (s.pot > 0n) await this.accounts.syncPotUsd(reg.token);
    let queued = 0;
    if (s.dividend > 0n) queued = await this.queueDividends(reg.token, key, eligible);
    return { pot: s.pot.toString(), dividend: s.dividend.toString(), burn: (s.burn + s.lp).toString(), queuedPayouts: queued, burnOnly: s.pot === 0n && s.dividend === 0n && s.burn + s.lp > 0n };
  }

  // ───────────────────────────── dividends ─────────────────────────────

  async payoutQueue(token: string): Promise<PendingPayout[]> {
    return JSON.parse((await this.repo.getMeta(divQueueKey(token))) ?? '[]');
  }
  private async setPayoutQueue(token: string, q: PendingPayout[]) {
    await this.repo.setMeta(divQueueKey(token), JSON.stringify(q));
  }

  /** Allocates the machine's unallocated dividend balance (this round + carried dust) over `eligible`. */
  async queueDividends(token: string, pullKey: string, eligible: HolderBalance[]) {
    const q = await this.payoutQueue(token);
    const queued = q.reduce((s, p) => s + BigInt(p.amountWei), 0n);
    const available = (await this.accounts.balance('DIVIDEND', token)) - queued;
    if (available <= 0n || !eligible.length) return 0;
    const { payouts, carryWei } = planPayouts(available, eligible, this.cfg.dividendMinWei);
    q.push(...payouts.map((p) => ({ pullKey, wallet: p.address, amountWei: p.amount.toString() })));
    await this.setPayoutQueue(token, q);
    this.d.log.info({ token, pullKey, payouts: payouts.length, carryWei: carryWei.toString() }, 'dividends queued');
    return payouts.length;
  }

  /** Pushes up to DIVIDEND_BATCH_SIZE queued payouts per machine per tick, each one recorded + booked. */
  async tickDividends() {
    for (const r of await this.d.store.listRegistrations()) {
      let q = await this.payoutQueue(r.token);
      if (!q.length) continue;
      const batch = q.slice(0, this.cfg.dividendBatch);
      let paid = 0n;
      let n = 0;
      try {
        await this.ops.run({ kind: 'DIVIDEND', machine: r.token }, async () => {
          for (const p of batch) {
            const ref = `div:${p.pullKey}:${p.wallet}`;
            const amount = BigInt(p.amountWei);
            const { hash } = await this.ops.transfer(p.wallet as Hex, amount, { kind: 'DIVIDEND', machine: r.token, dedupeKey: ref });
            await this.accounts.book([{ ref, ts: this.now(), machine: r.token, bucket: 'DIVIDEND', kind: 'DIVIDEND_PAID', amountWei: -amount, txHash: hash, data: { wallet: p.wallet } }]);
            const bnb = weiToBnb(amount);
            await this.repo.creditRewards(r.token, p.wallet, bnb);
            await this.repo.debitClaimable(r.token, p.wallet, bnb); // pushed directly: nothing left to claim
            q = q.filter((x) => !(x.pullKey === p.pullKey && x.wallet === p.wallet));
            await this.setPayoutQueue(r.token, q);
            paid += amount;
            n++;
          }
        });
      } catch (err) {
        if (!isHold(err)) this.d.log.warn({ err: errMsg(err), machine: r.token }, 'dividend payout failed; will retry');
      }
      if (n > 0) {
        const m = await this.ledger.updateMachine(r.token, (x) => ({ paidToHoldersBnb: Math.round((x.paidToHoldersBnb + weiToBnb(paid)) * 1e6) / 1e6 }));
        if (m) await this.ledger.payout(m, weiToBnb(paid), await this.d.bnbUsd(), n);
      }
    }
  }

  // ───────────────────────────── burns / buyback ─────────────────────────────

  /**
   * Buys `token` with `wei` BNB via Portal.swapExactInput (works on the curve and after graduation) and sends what the
   * ops wallet received to 0x…dEaD. Returns tokens burned (wei) and the buy tx.
   */
  async buyAndBurn(token: string, wei: bigint, meta: { kind: 'BURN' | 'BUYBACK'; machine: string | null; ref: string }) {
    const ops = this.ops;
    const quote = (await this.d.client.readContract({ address: this.cfg.portal as Hex, abi: portalOpsAbi, functionName: 'quoteExactInput', args: [{ inputToken: ZERO, outputToken: token, inputAmount: wei }] })) as bigint;
    const minOut = minusBps(quote, this.cfg.burnSlippageBps);
    const before = (await ops.read<bigint>({ address: token as Hex, abi: erc20Abi, functionName: 'balanceOf', args: [ops.address!] })) ?? 0n;
    const { hash, receipt } = await ops.contract(
      { address: this.cfg.portal as Hex, abi: portalOpsAbi, functionName: 'swapExactInput', args: [{ inputToken: ZERO, outputToken: token, inputAmount: wei, minOutputAmount: minOut, permitData: '0x' }], value: wei },
      { kind: meta.kind, machine: meta.machine },
    );
    await this.repo.setMeta(deadPendingKey(token), '1');
    const got = parseEventLogs({ abi: erc20Abi, eventName: 'Transfer', logs: receipt.logs.filter((l) => eq(l.address, token)), strict: false })
      .filter((l) => eq((l.args as { to?: string }).to, ops.address))
      .reduce((s, l) => s + ((l.args as { value?: bigint }).value ?? 0n), 0n);
    const after = (await ops.read<bigint>({ address: token as Hex, abi: erc20Abi, functionName: 'balanceOf', args: [ops.address!] })) ?? 0n;
    const received = got > 0n ? got : after - before;
    const burned = await this.flushToDead(token, meta);
    return { tokens: burned > 0n ? burned : received, buyTx: hash };
  }

  /** Sends the ops wallet's whole balance of `token` to dead (it never holds machine tokens / $FORGE otherwise). */
  async flushToDead(token: string, meta: { kind: 'BURN' | 'BUYBACK'; machine: string | null }) {
    const ops = this.ops;
    const bal = (await ops.read<bigint>({ address: token as Hex, abi: erc20Abi, functionName: 'balanceOf', args: [ops.address!] })) ?? 0n;
    if (bal > 0n) await ops.contract({ address: token as Hex, abi: erc20Abi, functionName: 'transfer', args: [DEAD, bal] }, { kind: meta.kind, machine: meta.machine });
    await this.repo.setMeta(deadPendingKey(token), '');
    return bal;
  }

  /** Machine-token burns (BURN / HIT_HUNTER / SPLIT): spend each machine's burn bucket once ≥ BURN_MIN_BNB. */
  async tickBurns() {
    if (!this.ops.active) return;
    for (const r of await this.d.store.listRegistrations()) {
      try {
        await this.ops.run({ kind: 'BURN', machine: r.token }, async () => {
          if (await this.repo.getMeta(deadPendingKey(r.token))) await this.flushToDead(r.token, { kind: 'BURN', machine: r.token });
          const wei = await this.accounts.balance('BURN', r.token);
          if (wei < this.cfg.burnMinWei || wei <= 0n) return;
          const ref = `burn:${r.token}:${await this.accounts.store.maxEntryId()}`;
          const res = await this.buyAndBurn(r.token, wei, { kind: 'BURN', machine: r.token, ref });
          await this.accounts.book([{ ref, ts: this.now(), machine: r.token, bucket: 'BURN', kind: 'BURN_SPEND', amountWei: -wei, txHash: res.buyTx, data: { tokens: res.tokens.toString() } }]);
          const tokens = Number(res.tokens / 10n ** 14n) / 1e4;
          await this.ledger.machineBurn(r.token, tokens, weiToUsd(wei, await this.d.bnbUsd()));
          this.d.log.info({ token: r.token, bnb: weiToBnb(wei), tokens: fmtTokens(tokens) }, 'machine token bought & burned');
        });
      } catch (err) {
        if (!isHold(err)) this.d.log.warn({ err: errMsg(err), machine: r.token }, 'burn failed; will retry');
      }
    }
  }

  /** $FORGE buyback & burn once the 3% buyback ledger ≥ BUYBACK_MIN_BNB and $FORGE is discovered. */
  async tickBuyback() {
    if (!this.ops.active) return;
    const forge = await this.d.forgeToken().catch(() => null);
    if (!forge) return;
    try {
      await this.ops.run({ kind: 'BUYBACK', machine: null }, async () => {
        if (await this.repo.getMeta(deadPendingKey(forge))) await this.flushToDead(forge, { kind: 'BUYBACK', machine: null });
        const wei = await this.accounts.balance('BUYBACK');
        if (wei < this.cfg.buybackMinWei || wei <= 0n) return;
        const ref = `buyback:${await this.accounts.store.maxEntryId()}`;
        const res = await this.buyAndBurn(forge, wei, { kind: 'BUYBACK', machine: null, ref });
        await this.accounts.book([{ ref, ts: this.now(), machine: null, bucket: 'BUYBACK', kind: 'BUYBACK_SPEND', amountWei: -wei, txHash: res.buyTx, data: { forge, tokens: res.tokens.toString() } }]);
        const tokens = Number(res.tokens / 10n ** 14n) / 1e4;
        await this.ledger.burn({ id: `buyback-${res.buyTx}`, kind: 'BUYBACK', amount: tokens, txHash: res.buyTx, timestamp: this.now() }, weiToUsd(wei, await this.d.bnbUsd()));
        this.d.log.info({ forge, bnb: weiToBnb(wei), tokens }, '$FORGE bought back & burned');
      });
    } catch (err) {
      if (!isHold(err)) this.d.log.warn({ err: errMsg(err) }, '$FORGE buyback failed; will retry');
    }
  }

  // ───────────────────────────── keeper: dispatch + reconcile ─────────────────────────────

  /** Calls TaxProcessor.dispatch() where tax is pending, unless gas > DISPATCH_MAX_GAS_PCT % of it. */
  async tickDispatch() {
    for (const r of await this.d.store.listRegistrations()) {
      try {
        const tp = r.taxProcessor as Hex;
        const pending = (await this.d.client.readContract({ address: tp, abi: taxProcessorAbi, functionName: 'marketQuoteBalance' })) as bigint;
        if (pending <= 0n) continue;
        if (!this.ops.active) {
          // Recorded once as QUEUED so the transparency page shows it.
          await this.ops.contract({ address: tp, abi: taxProcessorAbi, functionName: 'dispatch' }, { kind: 'DISPATCH', machine: r.token, dedupeKey: `dispatch:${r.token}` }).catch(() => undefined);
          continue;
        }
        const fee = await this.ops.estimateFee({ to: tp, data: encodeFunctionData({ abi: taxProcessorAbi, functionName: 'dispatch' }) });
        if (fee * 100n > (pending * BigInt(Math.round(this.cfg.dispatchMaxGasPct * 100))) / 100n) {
          this.d.log.debug({ token: r.token, pending: pending.toString(), fee: fee.toString() }, 'dispatch skipped: gas too high vs pending tax');
          continue;
        }
        await this.ops.contract({ address: tp, abi: taxProcessorAbi, functionName: 'dispatch' }, { kind: 'DISPATCH', machine: r.token });
      } catch (err) {
        if (!isHold(err)) this.d.log.warn({ err: errMsg(err), token: r.token }, 'dispatch failed');
      }
    }
  }

  /** Reads cumulative treasury receipts per token at the token's synced block and books the corrections. */
  async tickReconcile() {
    for (const r0 of await this.d.store.listRegistrations()) {
      try {
        const r = (await this.d.store.getRegistration(r0.token))!;
        const read = (blockNumber?: bigint) => this.d.client.readContract({ address: r.taxProcessor as Hex, abi: taxProcessorAbi, functionName: 'totalQuoteSentToMarketing', ...(blockNumber !== undefined ? { blockNumber } : {}) }) as Promise<bigint>;
        const sent = await read(BigInt(r.syncedTo)).catch(() => null);
        if (sent === null) continue; // state at that block unavailable: next round
        if (sent <= BigInt(r.sentToTreasuryWei || '0')) continue;
        const res = await this.accounts.reconcile(r, sent);
        await this.d.store.saveRegistration({
          ...(await this.d.store.getRegistration(r.token))!,
          sentToTreasuryWei: r.sentToTreasuryWei,
          reconciledToEntryId: r.reconciledToEntryId,
          ...(r.measuredGrossWei ? { measuredReceivedWei: r.measuredReceivedWei, measuredGrossWei: r.measuredGrossWei } : {}),
        });
        if (res) this.d.log.info({ token: r.token, receivedWei: res.receivedWei.toString(), grossWei: res.grossWei.toString(), shareBps: await this.accounts.shareBps(r) }, 'tax reconciled with treasury receipts');
      } catch (err) {
        this.d.log.warn({ err: errMsg(err), token: r0.token }, 'reconcile failed');
      }
    }
  }

  /** Stage / progress / price / 24h stats from Portal.getTokenV8Safe + indexed trades. */
  async tickRefresh() {
    const bnbUsd = await this.d.bnbUsd();
    const now = this.now();
    for (const r of await this.d.store.listRegistrations()) {
      try {
        const st = (await this.d.client.readContract({ address: this.cfg.portal as Hex, abi: portalAbi, functionName: 'getTokenV8Safe', args: [r.token as Hex] })) as { status: number; price: bigint; progress: bigint; pool: string };
        const graduated = Number(st.status) === 4;
        if (graduated && !r.pool && st.pool && !eq(st.pool, ZERO)) await this.d.store.saveRegistration({ ...(await this.d.store.getRegistration(r.token))!, pool: lc(st.pool) });
        const trades = (await this.repo.listTrades(r.token, 0, 2000)).items.filter((t) => t.timestamp >= now - 86_400);
        const volume24hUsd = round2(trades.reduce((s, t) => s + t.amountBnb, 0) * bnbUsd);
        const priceBnb = Number(st.price) / 1e18;
        await this.ledger.updateMachine(r.token, (m) => ({
          stage: graduated ? 'GRADUATED' : m.stage,
          bondingCurvePct: graduated ? 100 : Math.min(100, round2(Number(st.progress) / 1e16)),
          ...(priceBnb > 0 ? { marketCapUsd: round2(priceBnb * 1e9 * bnbUsd) } : {}),
          volume24hUsd,
        }));
        await this.accounts.syncPotUsd(r.token, bnbUsd);
      } catch (err) {
        this.d.log.debug({ err: errMsg(err), token: r.token }, 'refresh failed');
      }
    }
  }

  // ───────────────────────────── creator payouts ─────────────────────────────

  /**
   * TAX MODEL v3: pays each creator's owed balance (CREATOR bucket) to its payout address once ≥ CREATOR_PAYOUT_MIN_BNB.
   * Exempt from the daily cap (and not counted in it). The debit is booked before sending (reverted if nothing was
   * sent), so a crash can never lead to paying the same balance twice and a payout never exceeds the ledger balance.
   */
  async tickCreatorPayouts() {
    for (const r of await this.d.store.listRegistrations()) {
      if (r.taxModel !== 'creator' || !r.payout) continue;
      const token = r.token;
      const payout = r.payout as Hex;
      try {
        await this.ops.run({ kind: 'CREATOR_PAYOUT', machine: token }, async () => {
          const owed = await this.accounts.balance('CREATOR', token);
          if (owed <= 0n || owed < this.cfg.creatorPayoutMinWei) return;
          const meta = { kind: 'CREATOR_PAYOUT' as const, machine: token, capExempt: true, dedupeKey: `creator:${token}` };
          if (!this.ops.active) {
            await this.ops.transfer(payout, owed, meta).catch(() => undefined); // recorded once as QUEUED
            return;
          }
          const bal = await this.ops.balance();
          if (bal < owed) {
            this.warnOnce(`creator-bal:${token}:${owed}`, { machine: token, owedWei: owed.toString(), balanceWei: bal.toString() }, 'creator payout waits: ops wallet balance below the owed amount (fund the ops wallet)');
            return;
          }
          const ref = `creatorpay:${token}:${await this.accounts.store.maxEntryId()}`;
          await this.accounts.book([{ ref, ts: this.now(), machine: token, bucket: 'CREATOR', kind: 'CREATOR_PAID', amountWei: -owed, txHash: null, data: { to: payout } }]);
          let hash: string;
          try {
            hash = (await this.ops.transfer(payout, owed, meta)).hash;
          } catch (err) {
            // Not sent (hold / send failure / revert): give the balance back. Unknown outcome (no receipt): keep the debit.
            const unknown = err instanceof OpsTxError && !!err.hash && !/reverted/.test(err.message);
            if (!unknown) await this.accounts.book([{ ref: `${ref}:revert`, ts: this.now(), machine: token, bucket: 'CREATOR', kind: 'CREATOR_PAID', amountWei: owed, txHash: null, data: { to: payout, reverted: errMsg(err) } }]);
            throw err;
          }
          const m = await this.accounts.syncCreator(token);
          if (m) await this.ledger.activity(m, 'PAYOUT', `creator payout ${weiToBnb(owed).toFixed(4)} BNB → ${payout.slice(0, 6)}…${payout.slice(-4)}`, weiToUsd(owed, await this.d.bnbUsd()));
          this.d.log.info({ machine: token, to: payout, bnb: weiToBnb(owed), hash }, 'creator payout sent');
        });
      } catch (err) {
        if (!isHold(err)) this.d.log.warn({ err: errMsg(err), machine: token }, 'creator payout failed; will retry');
      }
    }
  }

  // ───────────────────────────── sweep ─────────────────────────────

  /**
   * Optional: when the ops wallet IS the treasury, move the free platform (company) share to SWEEP_TO_ADDRESS. Everything
   * owed — pots, creators, $FORGE buyback, pending dividends/burns — plus the gas reserve stays in the wallet.
   */
  async tickSweep() {
    const to = this.cfg.sweepTo;
    if (!to || !this.ops.active || !eq(this.ops.address, this.cfg.treasury)) return null;
    return this.ops.run({ kind: 'SWEEP', machine: null }, async () => {
      const [balanceWei, platformWei, owed] = await Promise.all([this.ops.balance(), this.accounts.balance('PLATFORM'), this.accounts.owed()]);
      const amount = sweepableWei({ balanceWei, platformWei, owedWei: owed.total, reserveWei: this.cfg.reserveWei });
      if (amount < this.cfg.sweepMinWei || amount <= 0n) return null;
      const { hash } = await this.ops.transfer(to as Hex, amount, { kind: 'SWEEP', capExempt: true });
      await this.accounts.book([{ ref: `sweep:${hash}`, ts: this.now(), machine: null, bucket: 'PLATFORM', kind: 'SWEEP', amountWei: -amount, txHash: hash, data: { to } }]);
      this.d.log.info({ to, bnb: weiToBnb(amount), hash }, 'platform share swept');
      return { amount, hash };
    });
  }
}
