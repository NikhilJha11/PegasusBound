CREATE TABLE "knowledge_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"idx" integer NOT NULL,
	"text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"page_count" integer,
	"text" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"status_detail" text,
	"analysis" jsonb,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_context" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"profile" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_chunks_org_idx" ON "knowledge_chunks" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_chunks_doc_idx_uq" ON "knowledge_chunks" USING btree ("document_id","idx");--> statement-breakpoint
CREATE INDEX "knowledge_documents_org_idx" ON "knowledge_documents" USING btree ("org_id");