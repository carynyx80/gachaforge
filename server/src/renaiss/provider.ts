/**
 * CardProvider backed by the real Renaiss Builder API v2.
 *
 * Pull:      catalog → POST /pull/prepare → verify → USDT allowance to Permit2 → sign PermitWitnessTransferFrom
 *            with the operator wallet → POST /pull/request (202) → poll GET /pull/status ~1s (10 min cap).
 * Sell-back: GET /buyback/offers (wallet) → sign BuybackUserAuthorization → POST /buyback/request → poll status.
 * Release:   Renaiss sends the ERC-721 to the operator wallet after the buyback window (72h for PANDORA);
 *            we then safeTransferFrom it to the raffle winner. There is no transfer endpoint.
 */
import { erc20Abi, maxUint256, type Hex } from 'viem';
import type { EvmWallet } from '../evm.js';
import { sameAddr } from '../evm.js';
import type { Logger } from '../log.js';
import type { PackId } from '../types.js';
import { currentTier, expectedPriceUsdt, type RenaissCatalog, type ResolvedPack } from './catalog.js';
import type { RenaissClient } from './client.js';
import { mapDraw } from './mapping.js';
import { ONE_USDT, type RenaissNetwork } from './networks.js';
import {
  BUYBACK_DOMAIN_NAME,
  BUYBACK_DOMAIN_VERSION,
  BUYBACK_TYPES,
  PERMIT2_TYPES,
  type BuybackBody,
  type PullRequestBody,
  type RenaissBuybackOffer,
  type RenaissBuybackStatus,
  type RenaissPrepare,
  type RenaissPullStatus,
} from './schemas.js';
import type { BuyPackResult, CardProvider, PackCost, ProviderCard, ReleaseStatus, SellBackQuote, SellBackResult } from './types.js';

export const registryAbi = [
  { type: 'function', name: 'ownerOf', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: '', type: 'address' }] },
  {
    type: 'function',
    name: 'safeTransferFrom',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'tokenId', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

export class RenaissFlowError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'RenaissFlowError';
  }
}

export interface RenaissProviderOptions {
  client: RenaissClient;
  catalog: RenaissCatalog;
  network: RenaissNetwork;
  wallet: EvmWallet;
  log?: Logger;
  pollIntervalMs?: number;
  /** Total wait for a pull/buyback to finish before giving up (docs: contact Renaiss after 10 min pending). */
  maxWaitMs?: number;
  /** Resends of the same signed request after FAILED OP_WALLET_BUSY. */
  busyRetries?: number;
  busyRetryDelayMs?: number;
  /** How long to keep re-reading buyback offers for freshly resolved draws. */
  offerWaitMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const sleepReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const noop: Logger = { info() {}, warn() {}, error() {}, debug() {} };
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Same consistency checks as the SDK's EOA pull signer, plus our own expectations (network contracts, price). */
export function verifyPrepare(prep: RenaissPrepare, o: { pack: ResolvedPack; network: Pick<RenaissNetwork, 'chainId' | 'permit2' | 'usdt' | 'vendingMachine'>; buyer: string; quantity: number; nowSec: number }) {
  const { pack, network: n } = o;
  const td = prep.permit2TypedData;
  const m = td.message;
  const u = prep.unsignedPullPayload;
  const fail = (why: string) => {
    throw new RenaissFlowError(`prepare response rejected: ${why}`, 'PREPARE_MISMATCH');
  };
  if (!sameAddr(prep.buyerWalletAddress, o.buyer)) fail(`buyer ${prep.buyerWalletAddress}`);
  if (prep.chainId !== n.chainId || td.domain.chainId !== n.chainId) fail(`chainId ${prep.chainId}/${td.domain.chainId}`);
  if (!sameAddr(td.domain.verifyingContract, n.permit2)) fail(`permit2 ${td.domain.verifyingContract}`);
  if (!sameJson(td.types, PERMIT2_TYPES)) fail('unexpected Permit2 types');
  if (prep.pack.id !== pack.id || u.packId !== pack.id) fail(`pack id ${prep.pack.id}`);
  if (!sameAddr(prep.pack.onChainPackId, pack.onChainPackId) || !sameAddr(m.witness.packId, pack.onChainPackId)) fail(`onChainPackId ${m.witness.packId}`);
  if (!sameAddr(prep.pack.vendingMachineAddress, n.vendingMachine) || !sameAddr(m.spender, n.vendingMachine)) fail(`spender ${m.spender}`);
  if (!sameAddr(m.permitted.token, n.usdt) || !sameAddr(prep.approval.token, n.usdt)) fail(`token ${m.permitted.token}`);
  if (!sameAddr(prep.approval.spender, n.permit2)) fail(`approval spender ${prep.approval.spender}`);
  if (BigInt(u.amountPerToken) !== pack.priceInUsdt || BigInt(prep.pack.priceInUsdt) !== pack.priceInUsdt) fail(`price ${u.amountPerToken}`);
  if (u.numOfTokens !== o.quantity || BigInt(m.witness.numOfTokens) !== BigInt(o.quantity)) fail(`quantity ${u.numOfTokens}`);
  const total = BigInt(u.amountPerToken) * BigInt(u.numOfTokens);
  if (BigInt(m.permitted.amount) !== total || BigInt(prep.approval.requiredAmount) !== total) fail(`amount ${m.permitted.amount}`);
  if (!sameAddr(u.builderCode, m.witness.builder)) fail('builder code');
  if (BigInt(u.nonce) !== BigInt(m.nonce) || BigInt(u.deadline) !== BigInt(m.deadline)) fail('nonce/deadline');
  if (u.deadline <= o.nowSec + 15) fail(`deadline ${u.deadline} already (nearly) expired`);
  return { total };
}

/** EIP-712 payload we sign, rebuilt from verified fields (never signs the server's object verbatim). */
export function permit2TypedData(prep: RenaissPrepare, n: Pick<RenaissNetwork, 'chainId' | 'permit2' | 'usdt' | 'vendingMachine'>) {
  const m = prep.permit2TypedData.message;
  return {
    domain: { name: 'Permit2', chainId: n.chainId, verifyingContract: n.permit2 },
    types: PERMIT2_TYPES,
    primaryType: 'PermitWitnessTransferFrom' as const,
    message: {
      permitted: { token: n.usdt, amount: BigInt(m.permitted.amount) },
      spender: n.vendingMachine,
      nonce: BigInt(m.nonce),
      deadline: BigInt(m.deadline),
      witness: { packId: m.witness.packId as Hex, builder: m.witness.builder as Hex, numOfTokens: BigInt(m.witness.numOfTokens) },
    },
  };
}

export function buybackTypedData(o: { chainId: number; vendingMachine: string; settlementIds: string[]; token: string; amount: bigint }) {
  return {
    domain: { name: BUYBACK_DOMAIN_NAME, version: BUYBACK_DOMAIN_VERSION, chainId: o.chainId, verifyingContract: o.vendingMachine as Hex },
    types: BUYBACK_TYPES,
    primaryType: 'BuybackUserAuthorization' as const,
    message: { buybackIds: o.settlementIds as Hex[], token: o.token as Hex, amount: o.amount },
  };
}

export class RenaissProvider implements CardProvider {
  readonly name = 'renaiss';
  private client: RenaissClient;
  private catalog: RenaissCatalog;
  private network: RenaissNetwork;
  private wallet: EvmWallet;
  private log: Logger;
  private pollIntervalMs: number;
  private maxWaitMs: number;
  private busyRetries: number;
  private busyRetryDelayMs: number;
  private offerWaitMs: number;
  private now: () => number;
  private sleep: (ms: number) => Promise<void>;

  constructor(o: RenaissProviderOptions) {
    this.client = o.client;
    this.catalog = o.catalog;
    this.network = o.network;
    this.wallet = o.wallet;
    this.log = o.log ?? noop;
    this.pollIntervalMs = o.pollIntervalMs ?? 1000;
    this.maxWaitMs = o.maxWaitMs ?? 10 * 60_000;
    this.busyRetries = o.busyRetries ?? 3;
    this.busyRetryDelayMs = o.busyRetryDelayMs ?? 3000;
    this.offerWaitMs = o.offerWaitMs ?? 60_000;
    this.now = o.now ?? Date.now;
    this.sleep = o.sleep ?? sleepReal;
  }

  async packCost(packId: PackId): Promise<PackCost> {
    const p = await this.catalog.resolve(packId);
    return { usdt: p.priceInUsdt, usd: Number(p.priceInUsdt / ONE_USDT) };
  }

  /** One-time max approval of USDT to Permit2 (costs BNB gas; sponsored execution does not cover it). */
  async ensureUsdtAllowance(spender: Hex, amount: bigint) {
    const current = await this.wallet.read<bigint>({ address: this.network.usdt, abi: erc20Abi, functionName: 'allowance', args: [this.wallet.address, spender] });
    if (current >= amount) return null;
    const r = await this.wallet.write({ address: this.network.usdt, abi: erc20Abi, functionName: 'approve', args: [spender, maxUint256] });
    this.log.info({ spender, tx: r.transactionHash }, 'approved USDT (max) for Permit2');
    return r.transactionHash;
  }

  async buyPack(packId: PackId, opts: { onSubmitted?: (requestId: string) => void | Promise<void> } = {}): Promise<BuyPackResult> {
    const pack = await this.catalog.resolve(packId);
    if (pack.priceInUsdt !== expectedPriceUsdt(packId)) throw new RenaissFlowError(`price drift for ${packId}`, 'PRICE_MISMATCH');
    const buyer = this.wallet.address;
    const quantity = 1;
    const prep = await this.client.preparePull({ buyerWalletAddress: buyer, packId: pack.id, quantity });
    const { total } = verifyPrepare(prep, { pack, network: this.network, buyer, quantity, nowSec: Math.floor(this.now() / 1000) });

    const balance = await this.wallet.read<bigint>({ address: this.network.usdt, abi: erc20Abi, functionName: 'balanceOf', args: [buyer] });
    if (balance < total) throw new RenaissFlowError(`operator USDT ${balance} < pull cost ${total}`, 'INSUFFICIENT_USDT_AMOUNT');
    await this.ensureUsdtAllowance(this.network.permit2, total);

    const permitSignature = await this.wallet.signTypedData(permit2TypedData(prep, this.network) as any);
    const u = prep.unsignedPullPayload;
    const body: PullRequestBody = { packId: u.packId, numOfTokens: u.numOfTokens, amountPerToken: u.amountPerToken, nonce: u.nonce, deadline: u.deadline, buyerWalletAddress: buyer, permitSignature };

    let status = await this.client.submitPull(body);
    await opts.onSubmitted?.(status.requestId);
    this.log.info({ requestId: status.requestId, pack: pack.slug, status: status.status }, 'renaiss pull submitted');
    status = await this.waitForPull(status, body);

    const res = status.result!;
    const pulledAtSec = res.pulledAt ? Math.floor(Date.parse(res.pulledAt) / 1000) : Math.floor(this.now() / 1000);
    const cards = res.draws.map((d) => {
      const c = mapDraw(d, { cardPackId: pack.id, pulledAtSec });
      c.releaseAt ??= pulledAtSec + pack.releaseAfterSeconds;
      return c;
    });
    if (!cards.length) throw new RenaissFlowError('resolved pull has no draws', 'NO_DRAWS', status.requestId);
    return {
      pullId: status.requestId,
      cards,
      totalValueUsd: Math.round(cards.reduce((s, c) => s + c.valueUsd, 0) * 100) / 100,
      paidUsdt: total,
      purchasedAt: pulledAtSec,
      fundingTxHash: res.permitFundTxHash,
    };
  }

  /** Polls until RESOLVED (with draws) or FAILED. FAILED+OP_WALLET_BUSY resends the same signed pull. */
  async waitForPull(first: RenaissPullStatus, body: PullRequestBody): Promise<RenaissPullStatus> {
    const started = this.now();
    let s = first;
    let busy = 0;
    for (;;) {
      if (s.status === 'RESOLVED' && s.result?.status === 'RESOLVED') return s;
      if (s.status === 'FAILED') {
        const code = s.error?.code ?? 'UNKNOWN';
        if (code === 'OP_WALLET_BUSY' && busy < this.busyRetries && body.deadline * 1000 > this.now() + this.busyRetryDelayMs + 5000) {
          busy++;
          this.log.warn({ requestId: s.requestId, attempt: busy }, 'renaiss pull: OP_WALLET_BUSY, resending same signed pull');
          await this.sleep(this.busyRetryDelayMs);
          s = await this.client.submitPull(body);
          continue;
        }
        // A FAILED pull was never charged (spec).
        throw new RenaissFlowError(`Renaiss pull ${s.requestId} FAILED: ${code}${s.error?.message ? ` (${s.error.message})` : ''}`, code, s.requestId);
      }
      if (this.now() - started >= this.maxWaitMs) {
        // PENDING_RESOLUTION = already charged, never fails; PENDING_PAYMENT >10 min = contact Renaiss. Do not re-sign.
        throw new RenaissFlowError(`Renaiss pull ${s.requestId} still ${s.status} after ${Math.round(this.maxWaitMs / 1000)}s; recover with GET /v2/gacha/pull/status`, 'PULL_TIMEOUT', s.requestId);
      }
      await this.sleep(this.pollIntervalMs);
      s = await this.client.pullStatus(s.requestId);
    }
  }

  private async offersFor(settlementIds: string[]): Promise<RenaissBuybackOffer[]> {
    const want = new Set(settlementIds.map((x) => x.toLowerCase()));
    const found = new Map<string, RenaissBuybackOffer>();
    const limit = 100;
    const started = this.now();
    // Offers can trail the RESOLVED status by a few seconds: re-read until every id shows up or offerWaitMs passes.
    for (;;) {
      for (let page = 0; page < 20 && found.size < want.size; page++) {
        const { offers } = await this.client.buybackOffers({ buyerWalletAddress: this.wallet.address, limit, offset: page * limit });
        for (const o of offers) if (want.has(o.settlementId.toLowerCase())) found.set(o.settlementId.toLowerCase(), o);
        if (offers.length < limit) break;
      }
      if (found.size >= want.size || this.now() - started >= this.offerWaitMs) break;
      await this.sleep(Math.max(this.pollIntervalMs, 2000));
    }
    return settlementIds.map((id) => {
      const o = found.get(id.toLowerCase());
      if (!o) throw new RenaissFlowError(`no buyback offer for settlement ${id}`, 'NO_BUYBACK_OFFER');
      return o;
    });
  }

  async quoteSellBack(cards: ProviderCard[]): Promise<SellBackQuote & { offers: RenaissBuybackOffer[] }> {
    if (!cards.length || cards.length > 10) throw new RenaissFlowError(`sell-back batch must have 1–10 cards, got ${cards.length}`, 'BAD_BATCH');
    const settlementIds = cards.map((c) => c.settlementId);
    if (new Set(settlementIds.map((s) => s.toLowerCase())).size !== settlementIds.length) throw new RenaissFlowError('duplicate settlement ids', 'BAD_BATCH');
    const offers = await this.offersFor(settlementIds);
    const first = offers[0];
    let total = 0n;
    let pctWeighted = 0;
    for (const o of offers) {
      if (o.cardPackId !== first.cardPackId || !sameAddr(o.vendingMachineAddress, first.vendingMachineAddress)) throw new RenaissFlowError('buyback batch spans packs/contracts', 'BAD_BATCH');
      if (!sameAddr(o.vendingMachineAddress, this.network.vendingMachine)) throw new RenaissFlowError(`offer vending machine ${o.vendingMachineAddress}`, 'BAD_OFFER');
      const t = currentTier(o.buybackTiers, this.now());
      const amt = t ? BigInt(t.amountInUsdt) : 0n;
      if (!t || amt <= 0n) throw new RenaissFlowError(`buyback window closed for settlement ${o.settlementId}`, 'BUYBACK_EXPIRED');
      total += amt;
      pctWeighted += t.buybackPercentage;
    }
    const valueUsd = Math.round(cards.reduce((s, c) => s + c.valueUsd, 0) * 100) / 100;
    return {
      settlementIds,
      valueUsd,
      rate: pctWeighted / offers.length / 100,
      proceedsUsdt: total,
      proceedsUsd: Number((total * 100n) / ONE_USDT) / 100,
      offers,
    };
  }

  async sellBack(cards: ProviderCard[]): Promise<SellBackResult> {
    const q = await this.quoteSellBack(cards);
    const offer = q.offers[0];
    const userSignature = await this.wallet.signTypedData(
      buybackTypedData({ chainId: this.network.chainId, vendingMachine: offer.vendingMachineAddress, settlementIds: q.settlementIds, token: this.network.usdt, amount: q.proceedsUsdt }) as any,
    );
    const body: BuybackBody = {
      buyerWalletAddress: this.wallet.address,
      cardPackId: offer.cardPackId,
      buybackAuth: { buybackIds: q.settlementIds, token: this.network.usdt, amount: q.proceedsUsdt.toString() },
      userSignature,
    };
    const done = await this.waitForBuyback(await this.client.submitBuyback(body), body);
    const paid = done.totalAmountInUsdt ? BigInt(done.totalAmountInUsdt) : q.proceedsUsdt;
    const { offers: _o, ...quote } = q;
    return { ...quote, proceedsUsdt: paid, proceedsUsd: Number((paid * 100n) / ONE_USDT) / 100, txRef: done.txHash ?? done.requestId };
  }

  async waitForBuyback(first: RenaissBuybackStatus, body: BuybackBody): Promise<RenaissBuybackStatus> {
    const started = this.now();
    let s = first;
    let busy = 0;
    for (;;) {
      if (s.status === 'COMPLETED') return s;
      if (s.status === 'FAILED') {
        const code = s.error?.code ?? 'UNKNOWN';
        if (code === 'OP_WALLET_BUSY' && busy < this.busyRetries) {
          busy++;
          this.log.warn({ requestId: s.requestId, attempt: busy }, 'renaiss buyback: OP_WALLET_BUSY, resending same signature');
          await this.sleep(this.busyRetryDelayMs);
          s = await this.client.submitBuyback(body);
          continue;
        }
        throw new RenaissFlowError(`Renaiss buyback ${s.requestId} FAILED: ${code}`, code, s.requestId);
      }
      if (this.now() - started >= this.maxWaitMs) throw new RenaissFlowError(`Renaiss buyback ${s.requestId} still PENDING`, 'BUYBACK_TIMEOUT', s.requestId);
      await this.sleep(this.pollIntervalMs);
      s = await this.client.buybackStatus(s.requestId);
    }
  }

  async releaseStatus(card: Pick<ProviderCard, 'tokenId' | 'releaseAt'>): Promise<ReleaseStatus> {
    const owner = await this.wallet.read<string>({ address: this.network.registry, abi: registryAbi, functionName: 'ownerOf', args: [BigInt(card.tokenId)] });
    return { released: sameAddr(owner, this.wallet.address), owner, releaseAt: card.releaseAt };
  }

  async transferCard(tokenId: string, to: string): Promise<string> {
    const owner = await this.wallet.read<string>({ address: this.network.registry, abi: registryAbi, functionName: 'ownerOf', args: [BigInt(tokenId)] });
    if (!sameAddr(owner, this.wallet.address)) throw new RenaissFlowError(`card ${tokenId} is owned by ${owner}, not the operator (not released yet?)`, 'NOT_RELEASED');
    const r = await this.wallet.write({ address: this.network.registry, abi: registryAbi, functionName: 'safeTransferFrom', args: [this.wallet.address, to as Hex, BigInt(tokenId)] });
    return r.transactionHash;
  }
}
