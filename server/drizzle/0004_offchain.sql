CREATE TABLE "ledger_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"ref" text NOT NULL,
	"ts" bigint NOT NULL,
	"machine" text,
	"bucket" text NOT NULL,
	"kind" text NOT NULL,
	"amount_wei" numeric(78, 0) NOT NULL,
	"tx_hash" text,
	"data" jsonb,
	CONSTRAINT "ledger_entries_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "offchain_machines" (
	"token" text PRIMARY KEY NOT NULL,
	"registered_at" bigint NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_txs" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"kind" text NOT NULL,
	"label" text,
	"machine" text,
	"to" text,
	"amount_wei" numeric(78, 0) NOT NULL,
	"fee_wei" numeric(78, 0) DEFAULT '0' NOT NULL,
	"hash" text,
	"status" text NOT NULL,
	"dedupe_key" text,
	"error" text,
	"nonce" integer
);
--> statement-breakpoint
CREATE INDEX "ledger_entries_bucket_machine_idx" ON "ledger_entries" USING btree ("bucket","machine");--> statement-breakpoint
CREATE INDEX "ledger_entries_ts_idx" ON "ledger_entries" USING btree ("ts");--> statement-breakpoint
CREATE INDEX "ops_txs_created_idx" ON "ops_txs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ops_txs_dedupe_idx" ON "ops_txs" USING btree ("dedupe_key","status");--> statement-breakpoint
CREATE OR REPLACE FUNCTION ledger_entries_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER ledger_entries_no_update BEFORE UPDATE OR DELETE ON "ledger_entries" FOR EACH ROW EXECUTE FUNCTION ledger_entries_append_only();
