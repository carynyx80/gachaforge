CREATE TABLE "card_releases" (
	"pull_key" text NOT NULL,
	"token_id" text NOT NULL,
	"machine" text NOT NULL,
	"ticker" text NOT NULL,
	"winner" text NOT NULL,
	"card_name" text NOT NULL,
	"release_at" bigint NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" bigint NOT NULL,
	"last_error" text,
	"tx_hash" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "card_releases_pull_key_token_id_pk" PRIMARY KEY("pull_key","token_id")
);
--> statement-breakpoint
CREATE INDEX "card_releases_due_idx" ON "card_releases" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "card_releases_winner_idx" ON "card_releases" USING btree ("winner");