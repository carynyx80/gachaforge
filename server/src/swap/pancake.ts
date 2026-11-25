/**
 * BNB <-> USDT via PancakeSwap V2 (single hop WBNB/USDT).
 *  - before a pull: swapETHForExactTokens for just the USDT the pack needs (+ small buffer), capped at the BNB the
 *    vault sent; the router refunds unused BNB. BNB actually spent = WBNB Deposit amount in the receipt.
 *  - after a sell-back: swapExactTokensForETH for the exact USDT proceeds; BNB received = WBNB Withdrawal amount.
 * Quotes come from getAmountsIn/getAmountsOut, guarded by SWAP_SLIPPAGE_BPS, with a deadline.
 */
import { erc20Abi, maxUint256, parseEventLogs, type Hex, type Log } from 'viem';
import type { EvmWallet } from '../evm.js';
import { sameAddr } from '../evm.js';
import type { Logger } from '../log.js';

export const pancakeRouterAbi = [
  { type: 'function', name: 'WETH', stateMutability: 'pure', inputs: [], outputs: [{ type: 'address' }] },
  {
    type: 'function',
    name: 'getAmountsIn',
    stateMutability: 'view',
    inputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'path', type: 'address[]' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
  {
    type: 'function',
    name: 'getAmountsOut',
    stateMutability: 'view',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'path', type: 'address[]' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
  {
    type: 'function',
    name: 'swapETHForExactTokens',
    stateMutability: 'payable',
    inputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
  {
    type: 'function',
    name: 'swapExactTokensForETH',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
] as const;

export const wbnbEventsAbi = [
  { type: 'event', name: 'Deposit', inputs: [{ name: 'dst', type: 'address', indexed: true }, { name: 'wad', type: 'uint256', indexed: false }] },
  { type: 'event', name: 'Withdrawal', inputs: [{ name: 'src', type: 'address', indexed: true }, { name: 'wad', type: 'uint256', indexed: false }] },
] as const;

const BPS = 10_000n;
/** x * (1 + bps), rounded up. */
export const plusBps = (x: bigint, bps: number) => (x * (BPS + BigInt(bps)) + BPS - 1n) / BPS;
/** x * (1 - bps), rounded down. */
export const minusBps = (x: bigint, bps: number) => (x * (BPS - BigInt(bps))) / BPS;

/** USDT to buy so the wallet holds at least `price`: shortfall + buffer (leftover dust is used by the next pull). */
export function usdtToBuy(price: bigint, balance: bigint, bufferBps: number): bigint {
  if (balance >= price) return 0n;
  return plusBps(price - balance, bufferBps);
}

/** What goes back to the vault pot in settlePull: BNB received from openPull minus BNB the swap actually spent. */
export function refundFor(amountSent: bigint, bnbSpent: bigint): bigint {
  if (bnbSpent > amountSent) throw new SwapError(`swap spent ${bnbSpent} > pull amount ${amountSent}`);
  return amountSent - bnbSpent;
}

export class SwapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SwapError';
  }
}

export interface SwapResult {
  bnb: bigint;
  usdt: bigint;
  txHash?: string;
}

export interface Swapper {
  readonly name: string;
  usdtBalance(): Promise<bigint>;
  /** Buy exactly `usdtOut`, spending at most `maxBnbIn`. Returns BNB actually spent. */
  buyExactUsdt(usdtOut: bigint, maxBnbIn: bigint): Promise<SwapResult>;
  /** Sell exactly `usdtIn`. Returns BNB actually received. */
  sellUsdt(usdtIn: bigint): Promise<SwapResult>;
}

function sumWbnb(logs: Log[], wbnb: string, eventName: 'Deposit' | 'Withdrawal', who: string): bigint | null {
  const evs = parseEventLogs({ abi: wbnbEventsAbi, eventName, logs: logs.filter((l) => sameAddr(l.address, wbnb)), strict: false });
  const mine = evs.filter((e) => sameAddr((e.args as { dst?: string; src?: string }).dst ?? (e.args as { src?: string }).src, who));
  if (!mine.length) return null;
  return mine.reduce((s, e) => s + ((e.args as { wad?: bigint }).wad ?? 0n), 0n);
}

export class PancakeSwapper implements Swapper {
  readonly name = 'pancake-v2';
  private wbnb: Hex | null = null;

  constructor(
    private wallet: EvmWallet,
    private o: { router: Hex; usdt: Hex; slippageBps: number; deadlineSeconds: number; log?: Logger; now?: () => number },
  ) {}

  private nowSec() {
    return Math.floor((this.o.now?.() ?? Date.now()) / 1000);
  }

  async weth(): Promise<Hex> {
    this.wbnb ??= await this.wallet.read<Hex>({ address: this.o.router, abi: pancakeRouterAbi, functionName: 'WETH' });
    return this.wbnb;
  }

  usdtBalance() {
    return this.wallet.read<bigint>({ address: this.o.usdt, abi: erc20Abi, functionName: 'balanceOf', args: [this.wallet.address] });
  }

  /** BNB needed (quote, before slippage) for `usdtOut`. */
  async quoteBnbIn(usdtOut: bigint) {
    const amounts = await this.wallet.read<readonly bigint[]>({ address: this.o.router, abi: pancakeRouterAbi, functionName: 'getAmountsIn', args: [usdtOut, [await this.weth(), this.o.usdt]] });
    return amounts[0];
  }

  async quoteBnbOut(usdtIn: bigint) {
    const amounts = await this.wallet.read<readonly bigint[]>({ address: this.o.router, abi: pancakeRouterAbi, functionName: 'getAmountsOut', args: [usdtIn, [this.o.usdt, await this.weth()]] });
    return amounts[amounts.length - 1];
  }

  async buyExactUsdt(usdtOut: bigint, maxBnbIn: bigint): Promise<SwapResult> {
    if (usdtOut <= 0n) return { bnb: 0n, usdt: 0n };
    const wbnb = await this.weth();
    const quoted = await this.quoteBnbIn(usdtOut);
    if (quoted > maxBnbIn) throw new SwapError(`need ~${quoted} wei BNB for ${usdtOut} USDT, budget is ${maxBnbIn}`);
    const value = plusBps(quoted, this.o.slippageBps) < maxBnbIn ? plusBps(quoted, this.o.slippageBps) : maxBnbIn;
    const r = await this.wallet.write({
      address: this.o.router,
      abi: pancakeRouterAbi,
      functionName: 'swapETHForExactTokens',
      args: [usdtOut, [wbnb, this.o.usdt], this.wallet.address, BigInt(this.nowSec() + this.o.deadlineSeconds)],
      value,
    });
    // The router wraps exactly amounts[0] (and refunds the rest), so the WBNB Deposit is the real spend.
    const spent = sumWbnb(r.logs, wbnb, 'Deposit', this.o.router);
    if (spent === null) throw new SwapError(`no WBNB Deposit in swap receipt ${r.transactionHash}`);
    this.o.log?.info({ usdtOut: usdtOut.toString(), bnbSpent: spent.toString(), tx: r.transactionHash }, 'swapped BNB → USDT');
    return { bnb: spent, usdt: usdtOut, txHash: r.transactionHash };
  }

  async sellUsdt(usdtIn: bigint): Promise<SwapResult> {
    if (usdtIn <= 0n) return { bnb: 0n, usdt: 0n };
    const wbnb = await this.weth();
    const allowance = await this.wallet.read<bigint>({ address: this.o.usdt, abi: erc20Abi, functionName: 'allowance', args: [this.wallet.address, this.o.router] });
    if (allowance < usdtIn) await this.wallet.write({ address: this.o.usdt, abi: erc20Abi, functionName: 'approve', args: [this.o.router, maxUint256] });
    const quoted = await this.quoteBnbOut(usdtIn);
    const minOut = minusBps(quoted, this.o.slippageBps);
    const r = await this.wallet.write({
      address: this.o.router,
      abi: pancakeRouterAbi,
      functionName: 'swapExactTokensForETH',
      args: [usdtIn, minOut, [this.o.usdt, wbnb], this.wallet.address, BigInt(this.nowSec() + this.o.deadlineSeconds)],
    });
    const got = sumWbnb(r.logs, wbnb, 'Withdrawal', this.o.router);
    if (got === null) throw new SwapError(`no WBNB Withdrawal in swap receipt ${r.transactionHash}`);
    this.o.log?.info({ usdtIn: usdtIn.toString(), bnbOut: got.toString(), tx: r.transactionHash }, 'swapped USDT → BNB');
    return { bnb: got, usdt: usdtIn, txHash: r.transactionHash };
  }
}

/** Fixed-price swapper for MOCK_MODE / tests: converts at `bnbUsd`, holds no USDT between pulls. */
export class SimulatedSwapper implements Swapper {
  readonly name = 'simulated';
  constructor(private bnbUsd: number) {}
  private cents() {
    return BigInt(Math.round(this.bnbUsd * 100));
  }
  async usdtBalance() {
    return 0n;
  }
  async buyExactUsdt(usdtOut: bigint, maxBnbIn: bigint) {
    const bnb = (usdtOut * 100n + this.cents() - 1n) / this.cents();
    if (bnb > maxBnbIn) throw new SwapError(`need ${bnb} wei BNB, budget ${maxBnbIn}`);
    return { bnb, usdt: usdtOut };
  }
  async sellUsdt(usdtIn: bigint) {
    return { bnb: (usdtIn * 100n) / this.cents(), usdt: usdtIn };
  }
}
