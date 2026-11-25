ALTER TABLE "fee_events" ADD COLUMN "creator_usd" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "ops_txs_kind_machine_idx" ON "ops_txs" USING btree ("kind","machine");