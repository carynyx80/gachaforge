CREATE TABLE "activity" (
	"id" text PRIMARY KEY NOT NULL,
	"timestamp" bigint NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "burns" (
	"id" text PRIMARY KEY NOT NULL,
	"timestamp" bigint NOT NULL,
	"amount" double precision NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "counters" (
	"name" text PRIMARY KEY NOT NULL,
	"value" double precision DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dividend_claims" (
	"machine" text NOT NULL,
	"epoch" integer NOT NULL,
	"wallet" text NOT NULL,
	"root" text NOT NULL,
	"amount_wei" numeric(78, 0) NOT NULL,
	"proof" jsonb NOT NULL,
	"pushed" boolean DEFAULT false NOT NULL,
	CONSTRAINT "dividend_claims_machine_epoch_wallet_pk" PRIMARY KEY("machine","epoch","wallet")
);
--> statement-breakpoint
CREATE TABLE "holder_balances" (
	"machine" text NOT NULL,
	"holder" text NOT NULL,
	"balance" numeric(78, 0) NOT NULL,
	CONSTRAINT "holder_balances_machine_holder_pk" PRIMARY KEY("machine","holder")
);
--> statement-breakpoint
CREATE TABLE "machines" (
	"address" text PRIMARY KEY NOT NULL,
	"created_at" bigint NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pulls" (
	"id" text PRIMARY KEY NOT NULL,
	"machine" text NOT NULL,
	"timestamp" bigint NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raffle_proofs" (
	"pull_id" text PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rewards" (
	"machine" text NOT NULL,
	"wallet" text NOT NULL,
	"claimable_bnb" double precision DEFAULT 0 NOT NULL,
	"total_earned_bnb" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "rewards_machine_wallet_pk" PRIMARY KEY("machine","wallet")
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"machine" text NOT NULL,
	"timestamp" bigint NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "activity_ts_idx" ON "activity" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "burns_ts_idx" ON "burns" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "dividend_claims_wallet_idx" ON "dividend_claims" USING btree ("machine","wallet");--> statement-breakpoint
CREATE INDEX "pulls_machine_ts_idx" ON "pulls" USING btree ("machine","timestamp");--> statement-breakpoint
CREATE INDEX "trades_machine_ts_idx" ON "trades" USING btree ("machine","timestamp");