/**
 * Operation Model
 * 
 * Database operations for managing bulk operation records with:
 * - Undo support
 * - Results tracking
 * - Status history
 */

import { type BulkOperationResults } from "../services/bulk-operations.server";

// This is a placeholder - replace with your actual database client
// Examples: Prisma, Drizzle, raw SQLite, etc.

export type OperationType = "PRICE_ADJUSTMENT" | "TAG_UPDATE" | "STATUS_CHANGE";

export type OperationStatus = 
  | "CREATED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELED";

export type OperationRecord = {
  id: string;
  shop: string;
  type: OperationType;
  status: OperationStatus;
  payload: any; // JSON payload with operation details
  inversePayload?: any; // JSON payload for undo
  bulkOperationId?: string;
  results?: BulkOperationResults;
  errorMessage?: string;
  undone?: boolean;
  undoneAt?: Date;
  undoneByOperationId?: string;
  createdAt: Date;
  completedAt?: Date;
};

type CreateOperationInput = {
  shop: string;
  type: OperationType;
  payload: any;
  inversePayload?: any;
};

type UpdateOperationInput = {
  id: string;
  status?: OperationStatus;
  bulkOperationId?: string;
  results?: BulkOperationResults;
  errorMessage?: string;
  completedAt?: Date;
  undone?: boolean;
  undoneAt?: Date;
  undoneByOperationId?: string;
};

/**
 * Create a new operation record
 */
export async function createOperation(
  input: CreateOperationInput
): Promise<OperationRecord> {
  const operation: OperationRecord = {
    id: generateId(),
    shop: input.shop,
    type: input.type,
    status: "CREATED",
    payload: input.payload,
    inversePayload: input.inversePayload,
    createdAt: new Date(),
  };

  // Example using SQLite (adjust for your database)
  await db.execute({
    sql: `
      INSERT INTO operations (
        id, shop, type, status, payload, inverse_payload, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      operation.id,
      operation.shop,
      operation.type,
      operation.status,
      JSON.stringify(operation.payload),
      operation.inversePayload ? JSON.stringify(operation.inversePayload) : null,
      operation.createdAt.toISOString(),
    ],
  });

  return operation;
}

/**
 * Update an existing operation
 */
export async function updateOperation(
  input: UpdateOperationInput
): Promise<OperationRecord> {
  const updates: string[] = [];
  const args: any[] = [];

  if (input.status !== undefined) {
    updates.push("status = ?");
    args.push(input.status);
  }

  if (input.bulkOperationId !== undefined) {
    updates.push("bulk_operation_id = ?");
    args.push(input.bulkOperationId);
  }

  if (input.results !== undefined) {
    updates.push("results = ?");
    args.push(JSON.stringify(input.results));
  }

  if (input.errorMessage !== undefined) {
    updates.push("error_message = ?");
    args.push(input.errorMessage);
  }

  if (input.completedAt !== undefined) {
    updates.push("completed_at = ?");
    args.push(input.completedAt.toISOString());
  }

  if (input.undone !== undefined) {
    updates.push("undone = ?");
    args.push(input.undone ? 1 : 0);
  }

  if (input.undoneAt !== undefined) {
    updates.push("undone_at = ?");
    args.push(input.undoneAt.toISOString());
  }

  if (input.undoneByOperationId !== undefined) {
    updates.push("undone_by_operation_id = ?");
    args.push(input.undoneByOperationId);
  }

  updates.push("updated_at = ?");
  args.push(new Date().toISOString());

  args.push(input.id);

  await db.execute({
    sql: `UPDATE operations SET ${updates.join(", ")} WHERE id = ?`,
    args,
  });

  return await findOperationById(input.id);
}

/**
 * Find operation by ID
 */
export async function findOperationById(
  id: string
): Promise<OperationRecord | null> {
  const result = await db.execute({
    sql: "SELECT * FROM operations WHERE id = ?",
    args: [id],
  });

  if (!result.rows.length) {
    return null;
  }

  return mapRowToOperation(result.rows[0]);
}

/**
 * Find operation by Shopify bulk operation ID
 */
export async function findOperationByBulkId(
  bulkOperationId: string
): Promise<OperationRecord | null> {
  const result = await db.execute({
    sql: "SELECT * FROM operations WHERE bulk_operation_id = ?",
    args: [bulkOperationId],
  });

  if (!result.rows.length) {
    return null;
  }

  return mapRowToOperation(result.rows[0]);
}

/**
 * Find active operation for a shop
 */
export async function findActiveOperationForShop(
  shop: string
): Promise<OperationRecord | null> {
  const result = await db.execute({
    sql: `
      SELECT * FROM operations 
      WHERE shop = ? 
      AND status IN ('CREATED', 'RUNNING')
      ORDER BY created_at DESC
      LIMIT 1
    `,
    args: [shop],
  });

  if (!result.rows.length) {
    return null;
  }

  return mapRowToOperation(result.rows[0]);
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
  const conditions: string[] = ["shop = ?"];
  const args: any[] = [shop];

  if (options?.status) {
    conditions.push("status = ?");
    args.push(options.status);
  }

  if (options?.type) {
    conditions.push("type = ?");
    args.push(options.type);
  }

  // Get total count
  const countResult = await db.execute({
    sql: `SELECT COUNT(*) as count FROM operations WHERE ${conditions.join(" AND ")}`,
    args,
  });
  const total = Number(countResult.rows[0].count);

  // Get paginated results
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  const result = await db.execute({
    sql: `
      SELECT * FROM operations 
      WHERE ${conditions.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `,
    args: [...args, limit, offset],
  });

  return {
    operations: result.rows.map(mapRowToOperation),
    total,
  };
}

/**
 * Delete old operations (for cleanup)
 */
export async function deleteOldOperations(
  olderThanDays: number
): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

  const result = await db.execute({
    sql: `
      DELETE FROM operations 
      WHERE created_at < ? 
      AND status IN ('COMPLETED', 'FAILED', 'CANCELED')
    `,
    args: [cutoffDate.toISOString()],
  });

  return result.rowsAffected ?? 0;
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
  const result = await db.execute({
    sql: `
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'RUNNING' THEN 1 ELSE 0 END) as running
      FROM operations
      WHERE shop = ?
    `,
    args: [shop],
  });

  const row = result.rows[0];
  return {
    total: Number(row.total ?? 0),
    completed: Number(row.completed ?? 0),
    failed: Number(row.failed ?? 0),
    running: Number(row.running ?? 0),
  };
}

/**
 * Map database row to OperationRecord
 */
function mapRowToOperation(row: any): OperationRecord {
  return {
    id: row.id,
    shop: row.shop,
    type: row.type,
    status: row.status,
    payload: row.payload ? JSON.parse(row.payload) : null,
    inversePayload: row.inverse_payload ? JSON.parse(row.inverse_payload) : undefined,
    bulkOperationId: row.bulk_operation_id ?? undefined,
    results: row.results ? JSON.parse(row.results) : undefined,
    errorMessage: row.error_message ?? undefined,
    undone: Boolean(row.undone),
    undoneAt: row.undone_at ? new Date(row.undone_at) : undefined,
    undoneByOperationId: row.undone_by_operation_id ?? undefined,
    createdAt: new Date(row.created_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
  };
}

/**
 * Generate unique ID (use UUID in production)
 */
function generateId(): string {
  return `op_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Initialize database schema (SQLite example)
 */
export async function initializeOperationsTable() {
  await db.execute({
    sql: `
      CREATE TABLE IF NOT EXISTS operations (
        id TEXT PRIMARY KEY,
        shop TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        payload TEXT NOT NULL,
        inverse_payload TEXT,
        bulk_operation_id TEXT,
        results TEXT,
        error_message TEXT,
        undone INTEGER DEFAULT 0,
        undone_at TEXT,
        undone_by_operation_id TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        updated_at TEXT
      )
    `,
    args: [],
  });

  // Create indexes for common queries
  await db.execute({
    sql: "CREATE INDEX IF NOT EXISTS idx_operations_shop ON operations(shop)",
    args: [],
  });

  await db.execute({
    sql: "CREATE INDEX IF NOT EXISTS idx_operations_status ON operations(status)",
    args: [],
  });

  await db.execute({
    sql: "CREATE INDEX IF NOT EXISTS idx_operations_bulk_id ON operations(bulk_operation_id)",
    args: [],
  });
}
