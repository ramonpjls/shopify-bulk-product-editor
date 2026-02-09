/**
 * Operation Model
 * 
 * Database operations for managing bulk operation records with:
 * - Undo support
 * - Results tracking
 * - Status history
 */

import { OperationStatus, OperationType, Prisma } from "@prisma/client";
import prisma from "../db.server";
import { type BulkOperationResults } from "../services/bulk-operations.server";

export type OperationRecord = Prisma.OperationGetPayload<Record<string, never>>;

type CreateOperationInput = {
  shop: string;
  type: OperationType;
  payload: Prisma.InputJsonValue;
  inversePayload?: Prisma.NullableJsonNullValueInput;
};

type UpdateOperationInput = {
  id: string;
  status?: OperationStatus;
  bulkOperationId?: string | null;
  results?: BulkOperationResults;
  errorMessage?: string;
  completedAt?: Date | null;
  undone?: boolean;
  undoneAt?: Date | null;
  undoneByOperationId?: string | null;
};

/**
 * Create a new operation record
 */
export async function createOperation(
  input: CreateOperationInput
): Promise<OperationRecord> {
  return prisma.operation.create({
    data: {
      shop: input.shop,
      type: input.type,
      payload: input.payload,
      inversePayload: input.inversePayload || undefined,
    },
  });
}

/**
 * Update an existing operation
 */
export async function updateOperation(
  input: UpdateOperationInput
): Promise<OperationRecord> {
  const { id, ...updates } = input;

  return prisma.operation.update({
    where: { id },
    data: updates,
  });
}

/**
 * Find operation by ID
 */
export async function findOperationById(
  id: string
): Promise<OperationRecord | null> {
  return prisma.operation.findUnique({
    where: { id },
  });
}

/**
 * Find operation by Shopify bulk operation ID
 */
export async function findOperationByBulkId(
  bulkOperationId: string
): Promise<OperationRecord | null> {
  return prisma.operation.findFirst({
    where: { bulkOperationId },
  });
}

/**
 * Find active operation for a shop
 */
export async function findActiveOperationForShop(
  shop: string
): Promise<OperationRecord | null> {
  return prisma.operation.findFirst({
    where: {
      shop,
      status: {
        in: ["CREATED", "RUNNING"],
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Find operations that need cleanup (stuck or expired)
 */
export async function findStuckOperations(
  shop: string
): Promise<OperationRecord[]> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  
  return prisma.operation.findMany({
    where: {
      shop,
      status: {
        in: ["CREATED", "RUNNING"],
      },
      createdAt: {
        lt: oneHourAgo,
      },
    },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Find all operations for a shop
 */
export async function findOperationsByShop(
  shop: string,
  options?: {
    limit?: number;
    offset?: number;
    status?: OperationStatus;
    type?: OperationType;
  }
): Promise<{ operations: OperationRecord[]; total: number }> {
  const where: Record<string, unknown> = { shop };

  if (options?.status) {
    where.status = options.status;
  }

  if (options?.type) {
    where.type = options.type;
  }

  const [operations, total] = await Promise.all([
    prisma.operation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: options?.limit ?? 50,
      skip: options?.offset ?? 0,
    }),
    prisma.operation.count({ where }),
  ]);

  return { operations, total };
}

/**
 * Delete old operations (for cleanup)
 */
export async function deleteOldOperations(
  olderThanDays: number
): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

  const result = await prisma.operation.deleteMany({
    where: {
      createdAt: { lt: cutoffDate },
      status: { in: ["COMPLETED", "FAILED", "CANCELLED"] },
    },
  });

  return result.count;
}

/**
 * Get operation statistics for a shop
 */
export async function getOperationStats(shop: string): Promise<{
  total: number;
  completed: number;
  failed: number;
  running: number;
}> {
  const [total, completed, failed, running] = await Promise.all([
    prisma.operation.count({ where: { shop } }),
    prisma.operation.count({ where: { shop, status: "COMPLETED" } }),
    prisma.operation.count({ where: { shop, status: "FAILED" } }),
    prisma.operation.count({ where: { shop, status: "RUNNING" } }),
  ]);

  return {
    total,
    completed,
    failed,
    running,
  };
}
