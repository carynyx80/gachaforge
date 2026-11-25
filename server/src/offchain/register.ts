/**
 * On-chain verification of a machine launch (SPEC "OFF-CHAIN MODE" → Launch):
 *  1. the tx receipt exists and succeeded;
 *  2. the flap.sh Portal emitted TokenCreated in that tx (that is the token);
 *  3. Portal.getTokenV8Safe(token): buy/sell tax each 100–1000 bps in whole % (TAX MODEL v3) and equal to what the creator
 *     signed (when given), native BNB quote;
 *  4. token.taxProcessor().marketAddress() (the beneficiary) == TREASURY_ADDRESS, and no commission receiver.
 */
import { parseEventLogs, type Hex } from 'viem';
import { portalAbi } from '../abi/flap.js';
import { taxProcessorAbi, tokenAbi } from '../abi/token.js';
import { isValidTaxBps, MAX_TAX_BPS, MIN_TAX_BPS } from '../core/packs.js';
import { sameAddr } from '../evm.js';

export type RegisterErrorCode =
  | 'tx_not_found'
  | 'tx_reverted'
  | 'no_token_created'
  | 'not_flap_token'
  | 'bad_tax'
  | 'bad_quote'
  | 'not_tax_token'
  | 'wrong_recipient'
  | 'commission_set'
  | 'already_registered'
  | 'forge_token'
  | 'invalid_params'
  | 'bad_signature';

export class RegistrationError extends Error {
  constructor(
    readonly code: RegisterErrorCode,
    message: string,
    readonly status = 422,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'RegistrationError';
  }
}

/** Subset of viem's PublicClient used here (tests pass a fake). */
export interface ChainReader {
  getTransactionReceipt(p: { hash: Hex }): Promise<{ status: 'success' | 'reverted'; blockNumber: bigint; from: Hex; logs: { address: Hex; topics: readonly Hex[] | Hex[]; data: Hex; logIndex?: number | null; blockNumber?: bigint | null; transactionHash?: Hex | null }[] }>;
  readContract(p: { address: Hex; abi: readonly unknown[]; functionName: string; args?: readonly unknown[]; blockNumber?: bigint }): Promise<unknown>;
}

const ZERO = '0x0000000000000000000000000000000000000000';

export interface TokenTaxInfo {
  token: string;
  status: number;
  buyTaxBps: number;
  sellTaxBps: number;
  quoteToken: string;
  taxProcessor: string;
  taxRecipient: string;
  pool: string | null;
  progress: bigint;
  price: bigint;
}

export interface VerifiedLaunch extends TokenTaxInfo {
  txHash: string;
  /** The launch tx sender (must sign the registration). */
  txFrom: string;
  creator: string;
  name: string;
  symbol: string;
  meta: string;
  createdBlock: number;
  createdAt: number;
}

interface V8 {
  status: number;
  quoteTokenAddress: string;
  buyTaxRate: bigint;
  sellTaxRate: bigint;
  pool: string;
  progress: bigint;
  price: bigint;
}

export interface TaxExpectation {
  /** Exact on-chain buy / sell tax required (the signed values). Omitted: any valid v3 rate. */
  buyTaxBps?: number;
  sellTaxBps?: number;
  /** Skip the 1–10% whole-% range check ($FORGE: the owner sets its tax freely). */
  anyRate?: boolean;
}

/** Steps 3–4 for an already-known token (also used by auto-detection). */
export async function verifyToken(client: ChainReader, p: { token: string; portal: string; treasury: string; tax?: TaxExpectation }): Promise<TokenTaxInfo> {
  const token = p.token as Hex;
  let st: V8;
  try {
    st = (await client.readContract({ address: p.portal as Hex, abi: portalAbi, functionName: 'getTokenV8Safe', args: [token] })) as V8;
  } catch (err) {
    throw new RegistrationError('not_flap_token', `Portal.getTokenV8Safe(${token}) failed: ${(err as Error)?.message?.slice(0, 120)}`);
  }
  if (!st || Number(st.status) === 0) throw new RegistrationError('not_flap_token', `${token} is not a flap.sh Portal token`);
  const buy = Number(st.buyTaxRate);
  const sell = Number(st.sellTaxRate);
  const t = p.tax ?? {};
  if (!t.anyRate && (!isValidTaxBps(buy) || !isValidTaxBps(sell)))
    throw new RegistrationError('bad_tax', `buy and sell tax must each be ${MIN_TAX_BPS}–${MAX_TAX_BPS} bps in whole % (1%–10%), token has ${buy}/${sell}`, 422, { buyTaxBps: buy, sellTaxBps: sell });
  if ((t.buyTaxBps !== undefined && t.buyTaxBps !== buy) || (t.sellTaxBps !== undefined && t.sellTaxBps !== sell))
    throw new RegistrationError('bad_tax', `on-chain tax ${buy}/${sell} bps does not match the signed ${t.buyTaxBps}/${t.sellTaxBps} bps`, 422, { buyTaxBps: buy, sellTaxBps: sell, signedBuyTaxBps: t.buyTaxBps, signedSellTaxBps: t.sellTaxBps });
  if (!sameAddr(st.quoteTokenAddress, ZERO)) throw new RegistrationError('bad_quote', `quote token must be native BNB, token uses ${st.quoteTokenAddress}`);
  let tp: string;
  try {
    tp = (await client.readContract({ address: token, abi: tokenAbi, functionName: 'taxProcessor' })) as string;
  } catch {
    throw new RegistrationError('not_tax_token', `${token} has no taxProcessor() (not a flap Tax Token V3)`);
  }
  if (!tp || sameAddr(tp, ZERO)) throw new RegistrationError('not_tax_token', `${token} has no tax processor`);
  const recipient = (await client.readContract({ address: tp as Hex, abi: taxProcessorAbi, functionName: 'marketAddress' })) as string;
  if (!sameAddr(recipient, p.treasury))
    throw new RegistrationError('wrong_recipient', `tax recipient is ${recipient}, must be the GachaForge treasury ${p.treasury}`, 422, { taxRecipient: recipient, treasury: p.treasury });
  const commission = (await client.readContract({ address: tp as Hex, abi: taxProcessorAbi, functionName: 'commissionReceiver' }).catch(() => ZERO)) as string;
  if (commission && !sameAddr(commission, ZERO)) throw new RegistrationError('commission_set', `commission receiver must be 0x0, token has ${commission}`, 422, { commissionReceiver: commission });
  return {
    token: token.toLowerCase(),
    status: Number(st.status),
    buyTaxBps: buy,
    sellTaxBps: sell,
    quoteToken: st.quoteTokenAddress.toLowerCase(),
    taxProcessor: tp.toLowerCase(),
    taxRecipient: recipient.toLowerCase(),
    pool: st.pool && !sameAddr(st.pool, ZERO) ? st.pool.toLowerCase() : null,
    progress: st.progress,
    price: st.price,
  };
}

/** Full check from the launch tx hash. */
export async function verifyLaunchTx(client: ChainReader, p: { txHash: string; portal: string; treasury: string; tax?: TaxExpectation }): Promise<VerifiedLaunch> {
  let receipt: Awaited<ReturnType<ChainReader['getTransactionReceipt']>>;
  try {
    receipt = await client.getTransactionReceipt({ hash: p.txHash as Hex });
  } catch {
    throw new RegistrationError('tx_not_found', `transaction ${p.txHash} not found (not mined yet? retry in a few seconds)`, 404);
  }
  if (!receipt) throw new RegistrationError('tx_not_found', `transaction ${p.txHash} not found`, 404);
  if (receipt.status !== 'success') throw new RegistrationError('tx_reverted', `transaction ${p.txHash} reverted`);
  const portalLogs = receipt.logs.filter((l) => sameAddr(l.address, p.portal));
  const created = parseEventLogs({ abi: portalAbi, eventName: 'TokenCreated', logs: portalLogs as never, strict: false });
  const ev = created[0];
  if (!ev?.args?.token) throw new RegistrationError('no_token_created', `no flap.sh Portal TokenCreated event in ${p.txHash}`);
  const a = ev.args as { ts?: bigint; creator?: string; token: string; name?: string; symbol?: string; meta?: string };
  const info = await verifyToken(client, { token: a.token, portal: p.portal, treasury: p.treasury, tax: p.tax });
  const creator = a.creator && !sameAddr(a.creator, ZERO) && !sameAddr(a.creator, p.portal) ? a.creator : receipt.from;
  return {
    ...info,
    txHash: p.txHash.toLowerCase(),
    txFrom: receipt.from.toLowerCase(),
    creator: creator.toLowerCase(),
    name: a.name ?? '',
    symbol: a.symbol ?? '',
    meta: a.meta ?? '',
    createdBlock: Number(receipt.blockNumber),
    createdAt: a.ts ? Number(a.ts) : Math.floor(Date.now() / 1000),
  };
}
