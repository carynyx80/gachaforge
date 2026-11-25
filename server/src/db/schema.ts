import { bigint, boolean, doublePrecision, index, integer, jsonb, numeric, pgTable, primaryKey, serial, text } from 'drizzle-orm/pg-core';
import type { ForgeRecord, StoredForgeTrade } from '../forge/types.js';
import type { ActivityEvent, BurnEvent, CardReleaseStatus, FeeEvent, Machine, Pull, RaffleProof, Trade } from '../types.js';

export const machines = pgTable('machines', {
  address: text('address').primaryKey(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  data: jsonb('data').$type<Machine>().notNull(),
});

export const pulls = pgTable(
  'pulls',
  {
    id: text('id').primaryKey(),
    machine: text('machine').notNull(),
    timestamp: bigint('timestamp', { mode: 'number' }).notNull(),
    data: jsonb('data').$type<Pull>().notNull(),
  },
  (t) => [index('pulls_machine_ts_idx').on(t.machine, t.timestamp)],
);

export const trades = pgTable(
  'trades',
  {
    id: serial('id').primaryKey(),
    machine: text('machine').notNull(),
    timestamp: bigint('timestamp', { mode: 'number' }).notNull(),
    data: jsonb('data').$type<Trade>().notNull(),
  },
  (t) => [index('trades_machine_ts_idx').on(t.machine, t.timestamp)],
);

export const activity = pgTable(
  'activity',
  {
    id: text('id').primaryKey(),
    timestamp: bigint('timestamp', { mode: 'number' }).notNull(),
    data: jsonb('data').$type<ActivityEvent>().notNull(),
  },
  (t) => [index('activity_ts_idx').on(t.timestamp)],
);

export const burns = pgTable(
  'burns',
  {
    id: text('id').primaryKey(),
    timestamp: bigint('timestamp', { mode: 'number' }).notNull(),
    amount: doublePrecision('amount').notNull(),
    data: jsonb('data').$type<BurnEvent>().notNull(),
  },
  (t) => [index('burns_ts_idx').on(t.timestamp)],
);

export const raffleProofs = pgTable('raffle_proofs', {
  pullId: text('pull_id').primaryKey(),
  data: jsonb('data').$type<RaffleProof>().notNull(),
});

export const holderBalances = pgTable(
  'holder_balances',
  {
    machine: text('machine').notNull(),
    holder: text('holder').notNull(),
    balance: numeric('balance', { precision: 78, scale: 0 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.machine, t.holder] })],
);

export const rewards = pgTable(
  'rewards',
  {
    machine: text('machine').notNull(),
    wallet: text('wallet').notNull(),
    claimableBnb: doublePrecision('claimable_bnb').notNull().default(0),
    totalEarnedBnb: doublePrecision('total_earned_bnb').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.machine, t.wallet] })],
);

export const dividendClaims = pgTable(
  'dividend_claims',
  {
    machine: text('machine').notNull(),
    epoch: integer('epoch').notNull(),
    wallet: text('wallet').notNull(),
    root: text('root').notNull(),
    amountWei: numeric('amount_wei', { precision: 78, scale: 0 }).notNull(),
    proof: jsonb('proof').$type<string[]>().notNull(),
    pushed: boolean('pushed').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.machine, t.epoch, t.wallet] }), index('dividend_claims_wallet_idx').on(t.machine, t.wallet)],
);

export const meta = pgTable('meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const counters = pgTable('counters', {
  name: text('name').primaryKey(),
  value: doublePrecision('value').notNull().default(0),
});

export const cardReleases = pgTable(
  'card_releases',
  {
    pullKey: text('pull_key').notNull(),
    tokenId: text('token_id').notNull(),
    machine: text('machine').notNull(),
    ticker: text('ticker').notNull(),
    winner: text('winner').notNull(),
    cardName: text('card_name').notNull(),
    releaseAt: bigint('release_at', { mode: 'number' }).notNull(),
    status: text('status').$type<CardReleaseStatus>().notNull(),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: bigint('next_attempt_at', { mode: 'number' }).notNull(),
    lastError: text('last_error'),
    txHash: text('tx_hash'),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.pullKey, t.tokenId] }), index('card_releases_due_idx').on(t.status, t.nextAttemptAt), index('card_releases_winner_idx').on(t.winner)],
);

export const feeEvents = pgTable(
  'fee_events',
  {
    id: text('id').primaryKey(),
    machine: text('machine').notNull(),
    timestamp: bigint('timestamp', { mode: 'number' }).notNull(),
    pending: boolean('pending').notNull(),
    taxUsd: doublePrecision('tax_usd').notNull(),
    flapUsd: doublePrecision('flap_usd').notNull(),
    platformUsd: doublePrecision('platform_usd').notNull(),
    potUsd: doublePrecision('pot_usd').notNull(),
    buybackUsd: doublePrecision('buyback_usd').notNull(),
    data: jsonb('data').$type<FeeEvent>().notNull(),
  },
  (t) => [index('fee_events_ts_idx').on(t.timestamp), index('fee_events_machine_ts_idx').on(t.machine, t.timestamp), index('fee_events_machine_pending_idx').on(t.machine, t.pending)],
);

/** $FORGE (SPEC "$FORGE token page"): discovered once, then only updated. */
export const forgeToken = pgTable('forge_token', {
  address: text('address').primaryKey(),
  createdBlock: bigint('created_block', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  data: jsonb('data').$type<ForgeRecord>().notNull(),
});

export const forgeTrades = pgTable(
  'forge_trades',
  {
    token: text('token').notNull(),
    id: text('id').notNull(),
    timestamp: bigint('timestamp', { mode: 'number' }).notNull(),
    blockNumber: bigint('block_number', { mode: 'number' }).notNull(),
    logIndex: integer('log_index').notNull(),
    data: jsonb('data').$type<StoredForgeTrade>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.token, t.id] }), index('forge_trades_token_ts_idx').on(t.token, t.timestamp)],
);
