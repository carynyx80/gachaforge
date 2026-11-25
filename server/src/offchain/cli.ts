/**
 * Ops runbook CLI for OFF-CHAIN MODE (needs DATABASE_URL; see docs/OFFCHAIN-OPS.md).
 *   node dist/offchain/cli.js status
 *   node dist/offchain/cli.js clear-pull <token> [--refund-wei <wei>] [--bump-round]
 *   node dist/offchain/cli.js adjust <POT|BUYBACK|DIVIDEND|BURN|PLATFORM> <token|global> <signedWei> <reason>
 * Ledger rows are never edited: corrections are new ADJUST entries.
 */
import { loadConfig } from '../config.js';
import { createOffchainStore } from './store.js';
import { BUCKETS, type Bucket } from './types.js';

const [cmd, ...args] = process.argv.slice(2);
const cfg = loadConfig();
if (!cfg.DATABASE_URL) {
  console.error('DATABASE_URL is not set (the in-memory store lives only inside the running server)');
  process.exit(1);
}
const store = await createOffchainStore(cfg.DATABASE_URL);
const now = Math.floor(Date.now() / 1000);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? '') : undefined;
};

try {
  if (cmd === 'status') {
    const regs = await store.listRegistrations();
    const sum = async (b: Bucket) => (await store.sum({ bucket: b })).toString();
    console.log(JSON.stringify({ buckets: Object.fromEntries(await Promise.all(BUCKETS.map(async (b) => [b, await sum(b)]))), spent24hWei: (await store.spentSince(now - 86_400)).toString(), machines: regs.map((r) => ({ token: r.token, strategy: r.strategy, round: r.round, syncedTo: r.syncedTo, pullQueued: r.pullQueued, reason: r.pullQueuedReason ?? null, openPull: r.openPull ?? null })) }, null, 2));
    const txs = await store.listOpsTxs({ limit: 20 });
    for (const t of txs) console.log(`${new Date(t.createdAt * 1000).toISOString()} ${t.status.padEnd(9)} ${t.kind.padEnd(13)} ${t.label ?? ''} ${t.machine ?? ''} ${t.amountWei} ${t.hash ?? ''} ${t.error ?? ''}`);
  } else if (cmd === 'clear-pull') {
    const token = args[0]?.toLowerCase();
    const r = token ? await store.getRegistration(token) : null;
    if (!r?.openPull) throw new Error(`no open pull for ${token}`);
    const refund = flag('--refund-wei');
    if (refund) await store.appendEntries([{ ref: `adjust:clear-pull:${r.openPull.key}`, ts: now, machine: r.token, bucket: 'POT', kind: 'ADJUST', amountWei: BigInt(refund), data: { reason: 'manual stuck-pull recovery', openPull: r.openPull } }]);
    const round = args.includes('--bump-round') ? r.openPull.round : r.round;
    await store.saveRegistration({ ...r, openPull: null, round, lastPullAt: now });
    console.log(`cleared ${r.openPull.key} (stage ${r.openPull.stage})${refund ? `, pot +${refund} wei` : ''}`);
  } else if (cmd === 'adjust') {
    const [bucket, machine, wei, ...why] = args;
    if (!BUCKETS.includes(bucket as Bucket) || !machine || !wei || !why.length) throw new Error('usage: adjust <bucket> <token|global> <signedWei> <reason>');
    const m = machine === 'global' ? null : machine.toLowerCase();
    await store.appendEntries([{ ref: `adjust:${now}:${bucket}:${m}:${wei}`, ts: now, machine: m, bucket: bucket as Bucket, kind: 'ADJUST', amountWei: BigInt(wei), data: { reason: why.join(' ') } }]);
    console.log(`booked ADJUST ${bucket} ${m ?? 'global'} ${wei} wei`);
  } else {
    console.log('commands: status | clear-pull <token> [--refund-wei <wei>] [--bump-round] | adjust <bucket> <token|global> <signedWei> <reason>');
  }
} finally {
  await (store as { close?: () => Promise<void> }).close?.();
}
