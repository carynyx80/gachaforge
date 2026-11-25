import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('defaults to mock mode without a factory', () => {
    const c = loadConfig({});
    expect(c.MOCK_MODE).toBe(true);
    expect(c.PORT).toBe(4000);
    expect(c.HOST).toBe('0.0.0.0');
    expect(c.CORS_ORIGINS).toEqual(['http://localhost:3000', 'https://gachaforge.xyz', 'https://www.gachaforge.xyz']);
    expect(c.CHAIN_ID).toBe(97);
    expect(c.OPERATOR_ENABLED).toBe(false);
    expect(c.TREASURY_ADDRESS).toBe('0x49060cd4C7679e7F6dB1075027F121a7c9F97a7c');
    expect(c.VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
  it('turns mock off when a factory is set, treats empty strings as unset', () => {
    const c = loadConfig({ FACTORY_ADDRESS: '0x' + '1'.repeat(40), RPC_URL: 'https://rpc.example', DATABASE_URL: '', CHAIN_ID: '56' });
    expect(c.MOCK_MODE).toBe(false);
    expect(c.DATABASE_URL).toBeUndefined();
    expect(c.CHAIN_ID).toBe(56);
  });
  it('MOCK_MODE explicit wins', () => {
    expect(loadConfig({ FACTORY_ADDRESS: '0x' + '1'.repeat(40), MOCK_MODE: 'true' }).MOCK_MODE).toBe(true);
  });
  it('rejects bad values', () => {
    expect(() => loadConfig({ CHAIN_ID: '1' })).toThrow(/CHAIN_ID/);
    expect(() => loadConfig({ OPERATOR_PRIVATE_KEY: '0x12' })).toThrow(/OPERATOR_PRIVATE_KEY/);
    expect(() => loadConfig({ EXCLUDED_ADDRESSES: '0xnope' })).toThrow();
  });
  it('CORS_ORIGINS parsing and legacy CORS_ORIGIN alias', () => {
    expect(loadConfig({ CORS_ORIGINS: 'https://a.xyz, https://b.xyz/' }).CORS_ORIGINS).toEqual(['https://a.xyz', 'https://b.xyz']);
    expect(loadConfig({ CORS_ORIGIN: 'https://c.xyz' }).CORS_ORIGINS).toEqual(['https://c.xyz']);
  });
  it('live mode requires RPC_URL; operator key only when OPERATOR_ENABLED', () => {
    const f = '0x' + '1'.repeat(40);
    expect(() => loadConfig({ FACTORY_ADDRESS: f })).toThrow(/RPC_URL/);
    const idx = loadConfig({ FACTORY_ADDRESS: f, RPC_URL: 'https://rpc.example' });
    expect(idx.MOCK_MODE).toBe(false);
    expect(idx.OPERATOR_ENABLED).toBe(false);
    expect(() => loadConfig({ FACTORY_ADDRESS: f, RPC_URL: 'https://rpc.example', OPERATOR_ENABLED: 'true' })).toThrow(/OPERATOR_PRIVATE_KEY/);
    const key = '0x' + 'a'.repeat(64);
    expect(() => loadConfig({ FACTORY_ADDRESS: f, RPC_URL: 'https://rpc.example', OPERATOR_ENABLED: 'true', OPERATOR_PRIVATE_KEY: key })).toThrow(/RENAISS_API_KEY/);
    expect(loadConfig({ FACTORY_ADDRESS: f, RPC_URL: 'https://rpc.example', OPERATOR_ENABLED: 'true', OPERATOR_PRIVATE_KEY: key, RENAISS_API_KEY: 'test-key' }).OPERATOR_ENABLED).toBe(true);
    // mock mode never needs the key
    expect(loadConfig({ OPERATOR_ENABLED: 'true' }).MOCK_MODE).toBe(true);
    expect(() => loadConfig({ MOCK_MODE: 'false' })).toThrow(/FACTORY_ADDRESS/);
  });
  it('Renaiss network follows CHAIN_ID; swap defaults', () => {
    expect(loadConfig({}).RENAISS_NETWORK).toBe('testnet');
    expect(loadConfig({ CHAIN_ID: '56' }).RENAISS_NETWORK).toBe('mainnet');
    expect(() => loadConfig({ CHAIN_ID: '97', RENAISS_NETWORK: 'mainnet' })).toThrow(/does not match/);
    const c = loadConfig({});
    expect([c.SWAP_SLIPPAGE_BPS, c.SWAP_USDT_BUFFER_BPS, c.PANCAKE_ROUTER, c.USDT_ADDRESS, c.RENAISS_REGISTRY]).toEqual([100, 10, undefined, undefined, undefined]);
    expect(() => loadConfig({ SWAP_SLIPPAGE_BPS: '5000' })).toThrow(/SWAP_SLIPPAGE_BPS/);
    expect(() => loadConfig({ PANCAKE_ROUTER: '0xnope' })).toThrow(/PANCAKE_ROUTER/);
  });
  it('parses excluded list', () => {
    const a = '0x' + 'A'.repeat(40);
    expect(loadConfig({ EXCLUDED_ADDRESSES: ` ${a} ,` }).EXCLUDED_ADDRESSES).toEqual([a.toLowerCase()]);
  });
});
