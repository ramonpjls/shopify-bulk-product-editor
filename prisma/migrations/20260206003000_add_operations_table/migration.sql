-- CreateTable
CREATE TABLE "Operation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "payload" TEXT NOT NULL,
    "inversePayload" TEXT,
    "bulkOperationId" TEXT,
    "resultUrl" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "Operation_bulkOperationId_unique" UNIQUE ("bulkOperationId")
);

-- CreateIndex
CREATE INDEX "Operation_shop_status_idx" ON "Operation"("shop", "status");

-- CreateTrigger
CREATE TRIGGER "Operation_updatedAt"
AFTER UPDATE ON "Operation"
FOR EACH ROW
WHEN NEW."updatedAt" <= OLD."updatedAt"
BEGIN
    UPDATE "Operation" SET "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = NEW."id";
END;
