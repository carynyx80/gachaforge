CREATE TABLE "forge_token" (
	"address" text PRIMARY KEY NOT NULL,
	"created_block" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forge_trades" (
	"token" text NOT NULL,
	"id" text NOT NULL,
	"timestamp" bigint NOT NULL,
	"block_number" bigint NOT NULL,
	"log_index" integer NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "forge_trades_token_id_pk" PRIMARY KEY("token","id")
);
--> statement-breakpoint
CREATE INDEX "forge_trades_token_ts_idx" ON "forge_trades" USING btree ("token","timestamp");