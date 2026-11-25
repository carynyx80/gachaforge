import { describe, expect, it } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, maxUint256, parseEther, type Hex, type Log } from 'viem';
import type { EvmWallet } from '../src/evm.js';
import { minusBps, PancakeSwapper, plusBps, refundFor, SimulatedSwapper, SwapError, usdtToBuy, wbnbEventsAbi } from '../src/swap/pancake.js';

const E18 = 10n ** 18n;
const ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E' as Hex;
const USDT = '0x55d398326f99059fF775485246999027B3197955' as Hex;
const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' as Hex;
const ME = '0x00000000000000000000000000000000000000aa' as Hex;

function wbnbLog(eventName: 'Deposit' | 'Withdrawal', who: Hex, wad: bigint, address: Hex = WBNB): Log {
  const topics = encodeEventTopics({ abi: wbnbEventsAbi, eventName, args: eventName === 'Deposit' ? { dst: who } : { src: who } } as any);
  return { address, topics, data: encodeAbiParameters([{ type: 'uint256' }], [wad]), blockNumber: 1n, logIndex: 0, transactionHash: '0x' + '1'.repeat(64), blockHash: '0x' + '0'.repeat(64), transactionIndex: 0, removed: false } as unknown as Log;
}

function fakeRouterWallet(o: { bnbPerUsdt: number; allowance?: bigint; depositWad?: bigint; withdrawWad?: bigint }) {
  const writes: { functionName: string; args?: readonly unknown[]; value?: bigint }[] = [];
  const price = BigInt(Math.round(o.bnbPerUsdt * 1e6));
  const wallet: EvmWallet = {
    address: ME,
    async read({ functionName, args }) {
      if (functionName === 'WETH') return WBNB as any;
      if (functionName === 'allowance') return (o.allowance ?? 0n) as any;
      if (functionName === 'balanceOf') return 5n * E18 as any;
      if (functionName === 'getAmountsIn') return [((args![0] as bigint) * price) / 1_000_000n, args![0]] as any;
      if (functionName === 'getAmountsOut') return [args![0], ((args![0] as bigint) * price) / 1_000_000n] as any;
      throw new Error(functionName);
    },
    async write(p) {
      writes.push({ functionName: p.functionName, args: p.args, value: p.value });
      const logs: Log[] = [];
      if (p.functionName === 'swapETHForExactTokens') logs.push(wbnbLog('Deposit', ME, 1n, '0x' + '9'.repeat(40) as Hex), wbnbLog('Deposit', ROUTER, o.depositWad ?? 0n));
      if (p.functionName === 'swapExactTokensForETH' && o.withdrawWad !== undefined) logs.push(wbnbLog('Withdrawal', ROUTER, o.withdrawWad));
      return { transactionHash: ('0x' + 'ab'.repeat(32)) as Hex, status: 'success', blockNumber: 1n, logs };
    },
    async signTypedData() {
      return '0x' as Hex;
    },
  };
  return { wallet, writes };
}

describe('swap math', () => {
  it('bps helpers round in the safe direction', () => {
    expect(plusBps(10_000n, 100)).toBe(10_100n);
    expect(plusBps(1n, 1)).toBe(2n);
    expect(minusBps(10_000n, 100)).toBe(9_900n);
    expect(minusBps(1n, 1)).toBe(0n);
  });
  it('usdtToBuy buys only the shortfall plus buffer', () => {
    expect(usdtToBuy(28n * E18, 0n, 10)).toBe(28_028_000_000_000_000_000n);
    expect(usdtToBuy(28n * E18, 3n * E18, 0)).toBe(25n * E18);
    expect(usdtToBuy(28n * E18, 30n * E18, 10)).toBe(0n);
  });
  it('refund = BNB from openPull minus BNB spent; never negative', () => {
    expect(refundFor(parseEther('0.055'), parseEther('0.0471'))).toBe(parseEther('0.0079'));
    expect(refundFor(parseEther('0.05'), parseEther('0.05'))).toBe(0n);
    expect(() => refundFor(1n, 2n)).toThrow(SwapError);
  });
});

describe('PancakeSwapper', () => {
  const opts = { router: ROUTER, usdt: USDT, slippageBps: 100, deadlineSeconds: 180, now: () => 1_000_000_000 };

  it('BNB→USDT: exact output, value = quote + slippage (capped at budget), spend from WBNB Deposit', async () => {
    const { wallet, writes } = fakeRouterWallet({ bnbPerUsdt: 0.0016, depositWad: parseEther('0.0447') });
    const s = new PancakeSwapper(wallet, opts);
    const r = await s.buyExactUsdt(28n * E18, parseEther('0.055'));
    expect(r.bnb).toBe(parseEther('0.0447'));
    const w = writes[0];
    expect(w.functionName).toBe('swapETHForExactTokens');
    expect(w.args).toEqual([28n * E18, [WBNB, USDT], ME, 1_000_180n]);
    expect(w.value).toBe(plusBps(parseEther('0.0448'), 100));
    // budget smaller than quote+slippage: capped at budget
    await s.buyExactUsdt(28n * E18, parseEther('0.045'));
    expect(writes[1].value).toBe(parseEther('0.045'));
  });

  it('BNB→USDT refuses when even the quote exceeds the BNB the vault sent', async () => {
    const { wallet } = fakeRouterWallet({ bnbPerUsdt: 0.0025 });
    await expect(new PancakeSwapper(wallet, opts).buyExactUsdt(28n * E18, parseEther('0.055'))).rejects.toThrow(/budget/);
  });

  it('USDT→BNB: approves router once, minOut = quote - slippage, BNB from WBNB Withdrawal', async () => {
    const { wallet, writes } = fakeRouterWallet({ bnbPerUsdt: 0.0016, withdrawWad: parseEther('0.0295') });
    const r = await new PancakeSwapper(wallet, opts).sellUsdt(18_450_000_000_000_000_000n);
    expect(r.bnb).toBe(parseEther('0.0295'));
    expect(writes.map((w) => w.functionName)).toEqual(['approve', 'swapExactTokensForETH']);
    expect(writes[0].args).toEqual([ROUTER, maxUint256]);
    expect(writes[1].args![1]).toBe(minusBps(parseEther('0.02952'), 100));
    const { wallet: w2, writes: wr2 } = fakeRouterWallet({ bnbPerUsdt: 0.0016, withdrawWad: 1n, allowance: maxUint256 });
    await new PancakeSwapper(w2, opts).sellUsdt(E18);
    expect(wr2.map((w) => w.functionName)).toEqual(['swapExactTokensForETH']);
  });

  it('throws if the receipt has no WBNB Withdrawal (cannot know the exact BNB to deposit)', async () => {
    const { wallet } = fakeRouterWallet({ bnbPerUsdt: 0.0016, allowance: maxUint256 });
    await expect(new PancakeSwapper(wallet, opts).sellUsdt(E18)).rejects.toThrow(/Withdrawal/);
  });

  it('SimulatedSwapper converts at a fixed price', async () => {
    const s = new SimulatedSwapper(600);
    expect((await s.buyExactUsdt(60n * E18, E18)).bnb).toBe(E18 / 10n);
    expect((await s.sellUsdt(600n * E18)).bnb).toBe(E18);
    await expect(s.buyExactUsdt(600n * E18, E18 / 2n)).rejects.toThrow(SwapError);
  });
});
