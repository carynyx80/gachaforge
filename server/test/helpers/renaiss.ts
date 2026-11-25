import { readFileSync } from 'node:fs';
import { maxUint256, type Hex } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import type { EvmWallet } from '../../src/evm.js';

export const fixture = <T = any>(name: string): T => {
  const j = JSON.parse(readFileSync(new URL(`../fixtures/renaiss/${name}.json`, import.meta.url), 'utf8'));
  delete j._source;
  return j as T;
};

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

export interface Recorded {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body?: any;
}

/** Route table keyed by "METHOD /path"; a handler array is consumed in order (last one repeats). */
export function fakeFetch(routes: Record<string, ((r: Recorded) => Response) | Response | (Response | ((r: Recorded) => Response))[]>) {
  const calls: Recorded[] = [];
  const counters = new Map<string, number>();
  const impl = async (input: URL | string, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const rec: Recorded = { method, url, headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(rec);
    const key = `${method} ${url.pathname}`;
    let h = routes[key];
    if (!h) return json({ code: 'NOT_MOCKED', message: key }, 599);
    if (Array.isArray(h)) {
      const i = counters.get(key) ?? 0;
      counters.set(key, i + 1);
      h = h[Math.min(i, h.length - 1)];
    }
    const res = typeof h === 'function' ? h(rec) : h;
    return res.clone();
  };
  return { fetch: impl as unknown as typeof fetch, calls };
}

export const OPERATOR_TX = ('0x' + 'ee'.repeat(32)) as Hex;

/** Fake operator wallet: real signer (throwaway key generated per test), fake chain state. */
export function fakeWallet(account: PrivateKeyAccount, init: { usdt?: bigint; allowance?: bigint; owners?: Record<string, string> } = {}) {
  const state = { usdt: init.usdt ?? 100n * 10n ** 18n, allowance: init.allowance ?? 0n, owners: { ...(init.owners ?? {}) } as Record<string, string>, writes: [] as { functionName: string; args?: readonly unknown[]; value?: bigint; address: string }[] };
  const wallet: EvmWallet = {
    address: account.address,
    async read({ functionName, args }) {
      if (functionName === 'allowance') return state.allowance as any;
      if (functionName === 'balanceOf') return state.usdt as any;
      if (functionName === 'ownerOf') return (state.owners[String(args![0])] ?? '0x14b662fc59f87ec004c2c25e0a2a49c9f858ef8c') as any;
      throw new Error(`unexpected read ${functionName}`);
    },
    async write(p) {
      state.writes.push({ functionName: p.functionName, args: p.args, value: p.value, address: p.address });
      if (p.functionName === 'approve') state.allowance = maxUint256;
      if (p.functionName === 'safeTransferFrom') state.owners[String(p.args![2])] = String(p.args![1]);
      return { transactionHash: OPERATOR_TX, status: 'success', blockNumber: 1n, logs: [] };
    },
    signTypedData: (p) => account.signTypedData(p as any),
  };
  return { wallet, state };
}

export const noopLog = { info() {}, warn() {}, error() {}, debug() {} };
