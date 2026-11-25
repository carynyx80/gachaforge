CREATE TABLE "fee_events" (
	"id" text PRIMARY KEY NOT NULL,
	"machine" text NOT NULL,
	"timestamp" bigint NOT NULL,
	"pending" boolean NOT NULL,
	"tax_usd" double precision NOT NULL,
	"flap_usd" double precision NOT NULL,
	"platform_usd" double precision NOT NULL,
	"pot_usd" double precision NOT NULL,
	"buyback_usd" double precision NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "fee_events_ts_idx" ON "fee_events" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "fee_events_machine_ts_idx" ON "fee_events" USING btree ("machine","timestamp");--> statement-breakpoint
CREATE INDEX "fee_events_machine_pending_idx" ON "fee_events" USING btree ("machine","pending");