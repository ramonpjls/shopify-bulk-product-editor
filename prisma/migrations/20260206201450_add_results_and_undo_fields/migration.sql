-- AlterTable
ALTER TABLE "Operation" ADD COLUMN "results" JSONB;
ALTER TABLE "Operation" ADD COLUMN "undone" BOOLEAN DEFAULT false;
ALTER TABLE "Operation" ADD COLUMN "undoneAt" DATETIME;
ALTER TABLE "Operation" ADD COLUMN "undoneByOperationId" TEXT;
