-- CreateEnum
CREATE TYPE "AiAnalysisRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "AiAnalysisTrigger" AS ENUM ('AUTO_FIRST_REVIEW', 'MANUAL');

-- CreateEnum
CREATE TYPE "DocumentExtractionStatus" AS ENUM ('OK', 'UNSUPPORTED', 'UNREADABLE', 'SCHEMA_INVALID', 'REFUSED', 'TIMEOUT', 'PROVIDER_ERROR');

-- CreateTable
CREATE TABLE "ai_analysis_runs" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "trigger" "AiAnalysisTrigger" NOT NULL,
    "requested_by_id" UUID,
    "status" "AiAnalysisRunStatus" NOT NULL DEFAULT 'QUEUED',
    "input_fingerprint" CHAR(64) NOT NULL,
    "application_version" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "pipeline_version" TEXT NOT NULL,
    "extraction_schema_version" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "error_code" TEXT,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(12,6),
    "latency_ms" INTEGER,
    "lease_expires_at" TIMESTAMPTZ(3),
    "queued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "purged_at" TIMESTAMPTZ(3),

    CONSTRAINT "ai_analysis_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_document_extractions" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "document_sha256" CHAR(64) NOT NULL,
    "declared_type" "DocumentType" NOT NULL,
    "status" "DocumentExtractionStatus" NOT NULL,
    "detected_type" TEXT,
    "type_matches_declared" BOOLEAN,
    "has_text_layer" BOOLEAN NOT NULL,
    "injection_alert" BOOLEAN NOT NULL,
    "injection_patterns" TEXT[],
    "injection_model_flag" BOOLEAN,
    "fields" JSONB NOT NULL,
    "schema_errors" JSONB NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "latency_ms" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_document_extractions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_analysis_runs_application_id_queued_at_idx" ON "ai_analysis_runs"("application_id", "queued_at");

-- CreateIndex
CREATE INDEX "ai_analysis_runs_status_queued_at_idx" ON "ai_analysis_runs"("status", "queued_at");

-- CreateIndex
CREATE INDEX "ai_analysis_runs_finished_at_idx" ON "ai_analysis_runs"("finished_at");

-- CreateIndex
CREATE INDEX "ai_document_extractions_document_id_idx" ON "ai_document_extractions"("document_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_document_extractions_run_id_document_id_key" ON "ai_document_extractions"("run_id", "document_id");

-- AddForeignKey
ALTER TABLE "ai_analysis_runs" ADD CONSTRAINT "ai_analysis_runs_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "credit_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_analysis_runs" ADD CONSTRAINT "ai_analysis_runs_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_document_extractions" ADD CONSTRAINT "ai_document_extractions_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_analysis_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_document_extractions" ADD CONSTRAINT "ai_document_extractions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "credit_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rules Prisma does not model (ADR-0011) ----------------------------------------

-- At most one active (queued or running) analysis per application.
CREATE UNIQUE INDEX "ai_analysis_runs_one_active_per_application"
  ON "ai_analysis_runs" ("application_id")
  WHERE "status" IN ('QUEUED', 'RUNNING');

ALTER TABLE "ai_analysis_runs"
  ADD CONSTRAINT "ai_analysis_runs_fingerprint_chk" CHECK ("input_fingerprint" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "ai_analysis_runs_tokens_chk" CHECK ("input_tokens" >= 0 AND "output_tokens" >= 0),
  ADD CONSTRAINT "ai_analysis_runs_finished_chk" CHECK (
    ("status" IN ('QUEUED', 'RUNNING') AND "finished_at" IS NULL) OR
    ("status" IN ('SUCCEEDED', 'PARTIAL', 'FAILED') AND "finished_at" IS NOT NULL)
  ),
  ADD CONSTRAINT "ai_analysis_runs_failed_code_chk"
    CHECK ("status" <> 'FAILED' OR "error_code" IS NOT NULL),
  ADD CONSTRAINT "ai_analysis_runs_purge_chk"
    CHECK ("purged_at" IS NULL OR "finished_at" IS NOT NULL);

ALTER TABLE "ai_document_extractions"
  ADD CONSTRAINT "ai_document_extractions_sha256_chk" CHECK ("document_sha256" ~ '^[0-9a-f]{64}$');

-- Extractions are write-once: no UPDATE. DELETE stays allowed for the retention purge.
CREATE TRIGGER "ai_document_extractions_write_once"
  BEFORE UPDATE ON "ai_document_extractions"
  FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();
