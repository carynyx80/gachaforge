import { bigint, boolean, doublePrecision, index, integer, jsonb, numeric, pgTable, primaryKey, serial, text } from 'drizzle-orm/pg-core';
import type { ActivityEvent, BurnEvent, Machine, Pull, RaffleProof, Trade } from '../types.js';

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
