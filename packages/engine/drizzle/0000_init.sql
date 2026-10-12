CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"experiment_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"idempotency_key" text NOT NULL,
	"provider_message_id" text,
	"sent_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"status_detail" text,
	"brief" jsonb NOT NULL,
	"limits" jsonb NOT NULL,
	"sender_provider" text DEFAULT 'mock' NOT NULL,
	"knowledge" jsonb,
	"plan" jsonb,
	"stage_index" integer DEFAULT 0 NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"auth_type" text DEFAULT 'none' NOT NULL,
	"secret" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"status_detail" text,
	"tools" jsonb,
	"capabilities" jsonb,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"status" text DEFAULT 'eligible' NOT NULL,
	"exclusion_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "experiment_arms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experiment_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"role" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "experiments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"hypothesis" text NOT NULL,
	"variable_tested" text NOT NULL,
	"status" text NOT NULL,
	"batch_size" integer NOT NULL,
	"sending_started_at" timestamp with time zone,
	"last_sent_at" timestamp with time zone,
	"observe_until" timestamp with time zone,
	"evaluation" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"experiment_id" uuid NOT NULL,
	"observation" text NOT NULL,
	"scope" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"confidence" text NOT NULL,
	"limitations" text NOT NULL,
	"next_action" text NOT NULL,
	"brain_write_status" text DEFAULT 'pending' NOT NULL,
	"brain_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"booked_at" timestamp with time zone NOT NULL,
	"qualified" boolean,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"type" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"company" text,
	"title" text,
	"persona" text,
	"source" text NOT NULL,
	"crm_record_id" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"from_email" text NOT NULL,
	"body" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reply_classifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reply_id" uuid NOT NULL,
	"category" text NOT NULL,
	"confidence" real NOT NULL,
	"objection" text,
	"reason" text NOT NULL,
	"classifier" text NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"reviewed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"reason" text NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"label" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"parent_variant_id" uuid,
	"angle" text NOT NULL,
	"cta" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"rationale" text NOT NULL,
	"source_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "experiments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "prospects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "prospects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_arms" ADD CONSTRAINT "experiment_arms_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "experiments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_arms" ADD CONSTRAINT "experiment_arms_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_records" ADD CONSTRAINT "learning_records_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_records" ADD CONSTRAINT "learning_records_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "experiments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_events" ADD CONSTRAINT "message_events_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_event_id_message_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "message_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_classifications" ADD CONSTRAINT "reply_classifications_reply_id_replies_id_fk" FOREIGN KEY ("reply_id") REFERENCES "replies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variants" ADD CONSTRAINT "variants_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_campaign_prospect_uq" ON "assignments" USING btree ("campaign_id","prospect_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_idem_uq" ON "assignments" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "assignments_experiment_idx" ON "assignments" USING btree ("experiment_id");--> statement-breakpoint
CREATE INDEX "assignments_provider_msg_idx" ON "assignments" USING btree ("provider_message_id");--> statement-breakpoint
CREATE INDEX "audit_campaign_idx" ON "audit_log" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "enrollments_uq" ON "enrollments" USING btree ("campaign_id","prospect_id");--> statement-breakpoint
CREATE UNIQUE INDEX "experiment_arms_uq" ON "experiment_arms" USING btree ("experiment_id","variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "experiments_campaign_seq_uq" ON "experiments" USING btree ("campaign_id","seq");--> statement-breakpoint
CREATE INDEX "jobs_due_idx" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_pending_uq" ON "jobs" USING btree ("dedupe_key") WHERE status = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "message_events_provider_uq" ON "message_events" USING btree ("provider_event_id");--> statement-breakpoint
CREATE INDEX "message_events_assignment_idx" ON "message_events" USING btree ("assignment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prospects_email_uq" ON "prospects" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "replies_event_uq" ON "replies" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "reply_classifications_reply_idx" ON "reply_classifications" USING btree ("reply_id");--> statement-breakpoint
CREATE UNIQUE INDEX "suppressions_email_uq" ON "suppressions" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "variants_campaign_label_version_uq" ON "variants" USING btree ("campaign_id","label","version");