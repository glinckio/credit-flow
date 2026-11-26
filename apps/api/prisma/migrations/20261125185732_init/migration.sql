-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'ANALYST', 'OPERATOR');

-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('INDIVIDUAL', 'COMPANY');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'PENDING_INFORMATION', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CreditProductType" AS ENUM ('PERSONAL_LOAN', 'PAYROLL_LOAN', 'VEHICLE_FINANCING', 'WORKING_CAPITAL', 'EQUIPMENT_FINANCING', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('IDENTIFICATION', 'PROOF_OF_ADDRESS', 'PROOF_OF_INCOME', 'BANK_STATEMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentValidationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ReviewRecommendation" AS ENUM ('APPROVE', 'REJECT', 'REQUEST_INFORMATION');

-- CreateEnum
CREATE TYPE "DecisionOutcome" AS ENUM ('APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "can_decide" BOOLEAN NOT NULL DEFAULT false,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "type" "CustomerType" NOT NULL,
    "name" TEXT NOT NULL,
    "document_number" VARCHAR(14) NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "birth_or_foundation_date" DATE NOT NULL,
    "address_street" TEXT NOT NULL,
    "address_number" TEXT NOT NULL,
    "address_complement" TEXT,
    "address_district" TEXT NOT NULL,
    "address_city" TEXT NOT NULL,
    "address_state" CHAR(2) NOT NULL,
    "address_zip_code" CHAR(8) NOT NULL,
    "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
    "anonymized_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_applications" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "customer_id" UUID NOT NULL,
    "product_type" "CreditProductType" NOT NULL,
    "requested_amount" DECIMAL(14,2) NOT NULL,
    "term_months" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "declared_monthly_income" DECIMAL(14,2) NOT NULL,
    "declared_monthly_commitments" DECIMAL(14,2),
    "status" "ApplicationStatus" NOT NULL DEFAULT 'DRAFT',
    "assignee_id" UUID,
    "created_by_id" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ(3),
    "decided_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "credit_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_documents" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "type" "DocumentType" NOT NULL,
    "other_description" TEXT,
    "original_name" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "uploaded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validation_status" "DocumentValidationStatus" NOT NULL DEFAULT 'PENDING',
    "validation_notes" TEXT,
    "validated_by_id" UUID,
    "validated_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "credit_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_issues" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "status" "IssueStatus" NOT NULL DEFAULT 'OPEN',
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_by_id" UUID,
    "resolved_at" TIMESTAMPTZ(3),
    "resolution_note" TEXT,

    CONSTRAINT "application_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_reviews" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "recommendation" "ReviewRecommendation" NOT NULL,
    "analysis_notes" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_decisions" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "outcome" "DecisionOutcome" NOT NULL,
    "justification" TEXT NOT NULL,
    "decided_by_id" UUID NOT NULL,
    "decided_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "review_id" UUID NOT NULL,

    CONSTRAINT "credit_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_status_history" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "from_status" "ApplicationStatus",
    "to_status" "ApplicationStatus" NOT NULL,
    "actor_id" UUID NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" BIGSERIAL NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "customers_document_number_key" ON "customers"("document_number");

-- CreateIndex
CREATE INDEX "customers_name_idx" ON "customers"("name");

-- CreateIndex
CREATE INDEX "customers_status_idx" ON "customers"("status");

-- CreateIndex
CREATE UNIQUE INDEX "credit_applications_number_key" ON "credit_applications"("number");

-- CreateIndex
CREATE INDEX "credit_applications_status_idx" ON "credit_applications"("status");

-- CreateIndex
CREATE INDEX "credit_applications_customer_id_idx" ON "credit_applications"("customer_id");

-- CreateIndex
CREATE INDEX "credit_applications_assignee_id_idx" ON "credit_applications"("assignee_id");

-- CreateIndex
CREATE INDEX "credit_applications_created_at_idx" ON "credit_applications"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "credit_documents_storage_key_key" ON "credit_documents"("storage_key");

-- CreateIndex
CREATE INDEX "credit_documents_application_id_idx" ON "credit_documents"("application_id");

-- CreateIndex
CREATE INDEX "application_issues_application_id_status_idx" ON "application_issues"("application_id", "status");

-- CreateIndex
CREATE INDEX "credit_reviews_application_id_created_at_idx" ON "credit_reviews"("application_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "credit_decisions_application_id_key" ON "credit_decisions"("application_id");

-- CreateIndex
CREATE INDEX "application_status_history_application_id_created_at_idx" ON "application_status_history"("application_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_entity_type_entity_id_idx" ON "audit_events"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_events_actor_id_idx" ON "audit_events"("actor_id");

-- CreateIndex
CREATE INDEX "audit_events_occurred_at_idx" ON "audit_events"("occurred_at");

-- CreateIndex
CREATE INDEX "audit_events_action_idx" ON "audit_events"("action");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_documents" ADD CONSTRAINT "credit_documents_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "credit_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_documents" ADD CONSTRAINT "credit_documents_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_documents" ADD CONSTRAINT "credit_documents_validated_by_id_fkey" FOREIGN KEY ("validated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_issues" ADD CONSTRAINT "application_issues_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "credit_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_issues" ADD CONSTRAINT "application_issues_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_issues" ADD CONSTRAINT "application_issues_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_reviews" ADD CONSTRAINT "credit_reviews_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "credit_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_reviews" ADD CONSTRAINT "credit_reviews_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_decisions" ADD CONSTRAINT "credit_decisions_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "credit_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_decisions" ADD CONSTRAINT "credit_decisions_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_decisions" ADD CONSTRAINT "credit_decisions_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "credit_reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_status_history" ADD CONSTRAINT "application_status_history_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "credit_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_status_history" ADD CONSTRAINT "application_status_history_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- Hand-written additions (not modelled by Prisma). Keep in sync with
-- docs/domain-model.md.
-- ═══════════════════════════════════════════════════════════════════════════

-- Data integrity checks -------------------------------------------------------
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_lowercase_chk" CHECK ("email" = lower("email"));

ALTER TABLE "customers"
  ADD CONSTRAINT "customers_document_number_chk" CHECK (
    ("type" = 'INDIVIDUAL' AND "document_number" ~ '^[0-9]{11}$') OR
    ("type" = 'COMPANY'    AND "document_number" ~ '^[0-9]{14}$')
  ),
  ADD CONSTRAINT "customers_zip_code_chk" CHECK ("address_zip_code" ~ '^[0-9]{8}$'),
  ADD CONSTRAINT "customers_state_chk" CHECK ("address_state" ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT "customers_version_chk" CHECK ("version" >= 1);

ALTER TABLE "credit_applications"
  ADD CONSTRAINT "credit_applications_amount_chk" CHECK ("requested_amount" > 0),
  ADD CONSTRAINT "credit_applications_term_chk" CHECK ("term_months" BETWEEN 1 AND 360),
  ADD CONSTRAINT "credit_applications_income_chk" CHECK ("declared_monthly_income" >= 0),
  ADD CONSTRAINT "credit_applications_commitments_chk"
    CHECK ("declared_monthly_commitments" IS NULL OR "declared_monthly_commitments" >= 0),
  ADD CONSTRAINT "credit_applications_version_chk" CHECK ("version" >= 1);

ALTER TABLE "credit_documents"
  ADD CONSTRAINT "credit_documents_size_chk" CHECK ("size_bytes" > 0),
  ADD CONSTRAINT "credit_documents_sha256_chk" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "credit_documents_other_description_chk"
    CHECK ("type" <> 'OTHER' OR coalesce(length(trim("other_description")), 0) > 0);

ALTER TABLE "application_issues"
  ADD CONSTRAINT "application_issues_resolution_chk" CHECK (
    ("status" = 'OPEN'     AND "resolved_at" IS NULL     AND "resolved_by_id" IS NULL) OR
    ("status" = 'RESOLVED' AND "resolved_at" IS NOT NULL AND "resolved_by_id" IS NOT NULL)
  );

-- Append-only tables ------------------------------------------------------------
-- History and audit rows can be inserted but never updated or deleted by the
-- application role. Defence in depth: the application code never tries to.
CREATE FUNCTION "forbid_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Table "%" is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "audit_events_append_only"
  BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();

CREATE TRIGGER "application_status_history_append_only"
  BEFORE UPDATE OR DELETE ON "application_status_history"
  FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();

CREATE TRIGGER "credit_reviews_append_only"
  BEFORE UPDATE OR DELETE ON "credit_reviews"
  FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();

CREATE TRIGGER "credit_decisions_append_only"
  BEFORE UPDATE OR DELETE ON "credit_decisions"
  FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();
