-- CreateEnum
CREATE TYPE "JobLogLevel" AS ENUM ('INFO', 'WARN', 'ERROR');

-- CreateTable
CREATE TABLE "JobLog" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "jobId" TEXT NOT NULL,
    "level" "JobLogLevel" NOT NULL,
    "message" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobLog_jobId_idx" ON "JobLog"("jobId");
