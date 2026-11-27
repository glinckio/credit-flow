-- CreateEnum
CREATE TYPE "FindingFeedbackVerdict" AS ENUM ('CORRECT', 'INCORRECT');

-- CreateTable
CREATE TABLE "ai_finding_feedback" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "finding_id" VARCHAR(120) NOT NULL,
    "author_id" UUID NOT NULL,
    "verdict" "FindingFeedbackVerdict" NOT NULL,
    "comment" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_finding_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_finding_feedback_author_id_idx" ON "ai_finding_feedback"("author_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_finding_feedback_run_id_finding_id_author_id_key" ON "ai_finding_feedback"("run_id", "finding_id", "author_id");

-- AddForeignKey
ALTER TABLE "ai_finding_feedback" ADD CONSTRAINT "ai_finding_feedback_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_analysis_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_finding_feedback" ADD CONSTRAINT "ai_finding_feedback_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
