/**
 * Bulk Operations Service 
 * 
 * Handles bulk operation lifecycle:
 * - Starting bulk operations
 * - Polling operation status
 * - Processing JSONL results
 * - Undo operations
 */

import {
  createOperation,
  findActiveOperationForShop,
  findOperationById,
  updateOperation,
  type OperationRecord,
} from "../models/operation.server";
import { graphqlWithRetry, type AdminApiClient } from "./graphql-retry.server";
import type { PricePreviewResult } from "./products.server";

export type StartPriceAdjustmentBulkOperationInput = {
  admin: AdminApiClient;
  shop: string;
  preview: PricePreviewResult;
};

export type StartPriceAdjustmentBulkOperationResult = {
  operation: OperationRecord;
};

export type BulkOperationStatus = 
  | "CREATED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELED"
  | "CANCELING"
  | "EXPIRED";

export type BulkOperationPollResult = {
  id: string;
  status: BulkOperationStatus;
  errorCode?: string;
  objectCount?: number;
  fileSize?: number;
  url?: string;
  createdAt: string;
  completedAt?: string;
};

export type BulkOperationResults = {
  successful: number;
  failed: number;
  errors: Array<{
    productId?: string;
    variantId?: string;
    message: string;
    field?: string;
  }>;
};

type PriceAdjustmentPayload = {
  adjustment: PricePreviewResult["adjustment"];
  products: Array<{
    id: string;
    variants: Array<{
      id: string;
      price: number;
    }>;
  }>;
};

type BulkOperationRunMutationResponse = {
  data?: {
    bulkOperationRunMutation?: {
      bulkOperation?: {
        id: string;
        status: string;
      };
      userErrors?: Array<{
        field?: string[];
        message: string;
      }>;
    };
  };
  errors?: Array<{
    message: string;
  }>;
};

type BulkOperationQueryResponse = {
  node?: {
    id: string;
    status: BulkOperationStatus;
    errorCode?: string;
    objectCount?: number;
    fileSize?: number;
    url?: string;
    createdAt: string;
    completedAt?: string;
  };
};

type CurrentBulkOperationQueryResponse = {
  currentBulkOperation?: {
    id: string;
    status: BulkOperationStatus;
  } | null;
};

/**
 * Start a price adjustment bulk operation
 */
export async function startPriceAdjustmentBulkOperation({
  admin,
  shop,
  preview,
}: StartPriceAdjustmentBulkOperationInput): Promise<StartPriceAdjustmentBulkOperationResult> {
  // Check for active operations
  const activeOperation = await findActiveOperationForShop(shop);
  if (activeOperation) {
    throw new Error("A bulk operation is already in progress for this shop.");
  }

  if (!preview.products.length) {
    throw new Error("Cannot start bulk operation without products.");
  }

  const mutation = buildPriceAdjustmentMutation(preview);

  const payload: PriceAdjustmentPayload = {
    adjustment: preview.adjustment,
    products: preview.products.map((product) => ({
      id: product.id,
      variants: product.variants.map((variant) => ({
        id: variant.id,
        price: variant.priceAfter,
      })),
    })),
  };

  // Create inverse payload for undo
  const inversePayload: PriceAdjustmentPayload = {
    adjustment: {
      direction: preview.adjustment.direction === "increase" ? "decrease" : "increase",
      percentage: preview.adjustment.percentage,
    },
    products: preview.products.map((product) => ({
      id: product.id,
      variants: product.variants.map((variant) => ({
        id: variant.id,
        price: variant.priceBefore,
      })),
    })),
  };

  const operationRecord = await createOperation({
    shop,
    type: "PRICE_ADJUSTMENT",
    payload,
    inversePayload,
  });

  try {
    const response = await graphqlWithRetry<BulkOperationRunMutationResponse>(
      admin,
      START_BULK_OPERATION_MUTATION,
      {
        variables: { mutation },
      }
    );

    const userErrors = response.data?.bulkOperationRunMutation?.userErrors ?? [];
    if (userErrors.length) {
      const message = userErrors.map((error) => error.message).join("\n");
      await updateOperation({
        id: operationRecord.id,
        status: "FAILED",
        errorMessage: message,
      });
      throw new Error(message || "Failed to start bulk operation.");
    }

    const bulkOperationId =
      response.data?.bulkOperationRunMutation?.bulkOperation?.id;
    if (!bulkOperationId) {
      await updateOperation({
        id: operationRecord.id,
        status: "FAILED",
        errorMessage: "Shopify did not return a bulk operation id.",
      });
      throw new Error("Shopify did not return a bulk operation id.");
    }

    const updated = await updateOperation({
      id: operationRecord.id,
      status: "RUNNING",
      bulkOperationId,
    });

    return { operation: updated };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to start bulk operation.";
    await updateOperation({
      id: operationRecord.id,
      status: "FAILED",
      errorMessage: message,
    });
    throw error;
  }
}

/**
 * Poll bulk operation status
 */
export async function pollBulkOperationStatus(
  admin: AdminApiClient,
  bulkOperationId: string
): Promise<BulkOperationPollResult> {
  const response = await graphqlWithRetry<BulkOperationQueryResponse>(
    admin,
    BULK_OPERATION_STATUS_QUERY,
    {
      variables: { id: bulkOperationId },
    }
  );

  if (!response.data?.node) {
    throw new Error(`Bulk operation ${bulkOperationId} not found.`);
  }

  return response.data.node;
}

/**
 * Check if there's an active bulk operation for the shop
 */
export async function checkActiveBulkOperation(
  admin: AdminApiClient
): Promise<{ id: string; status: BulkOperationStatus } | null> {
  const response = await graphqlWithRetry<CurrentBulkOperationQueryResponse>(
    admin,
    CURRENT_BULK_OPERATION_QUERY
  );

  const operation = response.data?.currentBulkOperation;
  
  if (!operation) {
    return null;
  }

  // Only return if truly active (not completed/failed)
  if (operation.status === "RUNNING" || operation.status === "CREATED") {
    return operation;
  }

  return null;
}

/**
 * Process bulk operation results from JSONL file
 */
export async function processBulkOperationResults(
  resultsUrl: string
): Promise<BulkOperationResults> {
  const response = await fetch(resultsUrl);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch results: ${response.statusText}`);
  }

  const jsonlText = await response.text();
  const lines = jsonlText.trim().split("\n").filter(Boolean);

  const results: BulkOperationResults = {
    successful: 0,
    failed: 0,
    errors: [],
  };

  for (const line of lines) {
    try {
      const item = JSON.parse(line);

      // Check for user errors in the response
      if (item.userErrors && item.userErrors.length > 0) {
        results.failed++;
        
        for (const error of item.userErrors) {
          results.errors.push({
            productId: item.__parentId,
            message: error.message,
            field: error.field?.join("."),
          });
        }
      } else if (item.id) {
        // Successful update
        results.successful++;
      }
    } catch (parseError) {
      console.error("Failed to parse JSONL line:", line, parseError);
      results.errors.push({
        message: "Failed to parse result line",
      });
    }
  }

  return results;
}

/**
 * Update operation with completed status and results
 */
export async function completeBulkOperation(
  operationId: string,
  bulkOperationResult: BulkOperationPollResult
): Promise<OperationRecord> {
  const updates: {
    status: "COMPLETED" | "FAILED" | "CANCELED";
    completedAt: Date;
    errorMessage?: string;
    results?: BulkOperationResults;
  } = {
    status: bulkOperationResult.status === "COMPLETED" ? "COMPLETED" : "FAILED",
    completedAt: new Date(bulkOperationResult.completedAt ?? Date.now()),
  };

  // Process results if available
  if (bulkOperationResult.url && bulkOperationResult.status === "COMPLETED") {
    try {
      const results = await processBulkOperationResults(bulkOperationResult.url);
      updates.results = results;
    } catch (error) {
      console.error("Failed to process bulk operation results:", error);
      updates.errorMessage = "Failed to process operation results";
    }
  }

  // Handle errors
  if (bulkOperationResult.errorCode || bulkOperationResult.status === "FAILED") {
    updates.status = "FAILED";
    updates.errorMessage = bulkOperationResult.errorCode || "Bulk operation failed";
  }

  return await updateOperation({
    id: operationId,
    ...updates,
  });
}

/**
 * Undo a completed operation
 */
export async function undoOperation(
  admin: AdminApiClient,
  shop: string,
  operationId: string
): Promise<StartPriceAdjustmentBulkOperationResult> {
  const operation = await findOperationById(operationId);

  if (!operation) {
    throw new Error("Operation not found");
  }

  if (operation.status !== "COMPLETED") {
    throw new Error("Can only undo completed operations");
  }

  if (!operation.inversePayload) {
    throw new Error("Operation does not support undo");
  }

  if (operation.type !== "PRICE_ADJUSTMENT") {
    throw new Error("Undo not implemented for this operation type");
  }

  // Build preview from inverse payload
  const inversePayload = operation.inversePayload as PriceAdjustmentPayload;
  
  const preview: PricePreviewResult = {
    adjustment: inversePayload.adjustment,
    products: inversePayload.products.map((product) => ({
      id: product.id,
      title: "", // Not needed for undo
      status: "",
      tags: [],
      variants: product.variants.map((variant) => ({
        id: variant.id,
        title: "",
        priceBefore: variant.price, // In undo, "before" is what we're reverting to
        priceAfter: variant.price,
        currencyCode: "",
      })),
    })),
  };

  // Start the undo operation
  const result = await startPriceAdjustmentBulkOperation({
    admin,
    shop,
    preview,
  });

  // Mark original operation as undone
  await updateOperation({
    id: operationId,
    undone: true,
    undoneAt: new Date(),
    undoneByOperationId: result.operation.id,
  });

  return result;
}

/**
 * Build price adjustment mutation string
 */
function buildPriceAdjustmentMutation(preview: PricePreviewResult): string {
  const aliasMutations = preview.products
    .map((product, productIndex) => {
      const variantsMutations = product.variants
        .map((variant) => {
          const price = variant.priceAfter.toFixed(2);
          return `{ id: "${variant.id}", price: "${price}" }`;
        })
        .join(",\n");

      return `update_${productIndex}: productVariantsBulkUpdate(productId: "${product.id}", variants: [${variantsMutations}]) { 
        productVariants { id price }
        userErrors { field message } 
      }`;
    })
    .join("\n");

  return `mutation {\n${aliasMutations}\n}`;
}

// GraphQL Queries

const START_BULK_OPERATION_MUTATION = `#graphql
  mutation StartBulkOperation($mutation: String!) {
    bulkOperationRunMutation(mutation: $mutation) {
      bulkOperation {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const BULK_OPERATION_STATUS_QUERY = `#graphql
  query BulkOperationStatus($id: ID!) {
    node(id: $id) {
      ... on BulkOperation {
        id
        status
        errorCode
        objectCount
        fileSize
        url
        createdAt
        completedAt
      }
    }
  }
`;

const CURRENT_BULK_OPERATION_QUERY = `#graphql
  query CurrentBulkOperation {
    currentBulkOperation {
      id
      status
    }
  }
`;
