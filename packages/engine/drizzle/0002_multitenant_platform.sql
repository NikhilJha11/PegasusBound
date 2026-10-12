CREATE TABLE "org_credentials" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"experiment_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"platform_campaign_id" text NOT NULL,
	"step_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "mailboxes_email_uq";--> statement-breakpoint
DROP INDEX "memory_key_uq";--> statement-breakpoint
DROP INDEX "prospects_email_uq";--> statement-breakpoint
DROP INDEX "suppressions_email_uq";--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "org_id" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "org_id" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "org_id" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "memory_entries" ADD COLUMN "org_id" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "org_id" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "suppressions" ADD COLUMN "org_id" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_campaigns" ADD CONSTRAINT "platform_campaigns_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_campaigns" ADD CONSTRAINT "platform_campaigns_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "experiments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_campaigns" ADD CONSTRAINT "platform_campaigns_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_campaigns_arm_uq" ON "platform_campaigns" USING btree ("experiment_id","variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_campaigns_remote_uq" ON "platform_campaigns" USING btree ("platform_campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mailboxes_org_email_uq" ON "mailboxes" USING btree ("org_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_org_key_uq" ON "memory_entries" USING btree ("org_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "prospects_org_email_uq" ON "prospects" USING btree ("org_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "suppressions_org_email_uq" ON "suppressions" USING btree ("org_id","email");