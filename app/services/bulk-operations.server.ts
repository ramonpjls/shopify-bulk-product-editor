/**
 * Bulk Operations Service 
 *
 * Fixes:
 * - Graceful handling of "not found" bulk operations
 * - Better error messages
 * - Auto-cleanup of expired operations
 */

import {
  createOperation,
  findActiveOperationForShop,
  findOperationById,
  findStuckOperations,
  updateOperation,
  type OperationRecord
} from "../models/operation.server";
import { graphqlWithRetry, type AdminApiClient } from "./graphql-retry.server";
import type { PricePreviewResult, TagPreviewResult } from "./products.server";

export type StartPriceAdjustmentBulkOperationInput = {
  admin: AdminApiClient;
  shop: string;
  preview: PricePreviewResult;
};

export type StartTagUpdateBulkOperationInput = {
  admin: AdminApiClient;
  shop: string;
  preview: TagPreviewResult;
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

export type PriceAdjustmentPayload = {
  adjustment: PricePreviewResult["adjustment"];
  products: Array<{
    id: string;
    title?: string;
    variants: Array<{
      id: string;
      price: number;
    }>;
  }>;
};


type BulkOperationRunMutationPayload = {
  bulkOperationRunMutation?: {
    bulkOperation?: {
      id: string;
      status: string;
      url: string;
    };
    userErrors?: Array<{
      field?: string[];
      message: string;
    }>;
  };
};

type StagedUploadsCreatePayload = {
  stagedUploadsCreate?: {
    stagedTargets: Array<{
      url: string;
      resourceUrl: string | null;
      parameters: Array<{
        name: string;
        value: string;
      }>;
    }>;
    userErrors?: Array<{
      field?: string[];
      message: string;
    }>;
  };
};

type BulkOperationQueryPayload = {
  node?: {
    __typename?: string;
    id: string;
    status: BulkOperationStatus;
    errorCode?: string;
    objectCount?: number;
    fileSize?: number;
    url?: string;
    createdAt: string;
    completedAt?: string;
  } & { [key: string]: unknown };
};

type CurrentBulkOperationQueryPayload = {
  currentBulkOperation?: {
    id: string;
    status: BulkOperationStatus;
  } | null;
};

/**
 * Auto-cleanup stuck operations for a shop
 */
export async function cleanupStuckOperations(
  admin: AdminApiClient,
  shop: string
): Promise<void> {

  const stuckOperations = await findStuckOperations(shop);

  if (stuckOperations.length === 0) {
    console.log("✅ No stuck operations found");
    return;
  }

  console.log(`⚠️ Found ${stuckOperations.length} stuck operations, cleaning up...`);

  for (const operation of stuckOperations) {
    if (operation.bulkOperationId) {
      // Check if the operation still exists in Shopify
      const status = await pollBulkOperationStatus(admin, operation.bulkOperationId);

      if (status.status === "EXPIRED" || status.errorCode === "NOT_FOUND") {
        await updateOperation({
          id: operation.id,
          status: "EXPIRED",
          completedAt: new Date(),
          errorMessage: "Auto-expired: bulk operation not found in Shopify or timed out (>1 hour)"
        });
        console.log(`⏰ Marked operation ${operation.id} as EXPIRED`);
      }
    } else {
      // No bulk operation ID, mark as FAILED
      await updateOperation({
        id: operation.id,
        status: "FAILED",
        completedAt: new Date(),
        errorMessage: "Auto-failed: no bulk operation ID found after 1 hour"
      });
      console.log(`❌ Marked operation ${operation.id} as FAILED`);
    }
  }
}

/**
 * Start a price adjustment bulk operation
 */
export async function startPriceAdjustmentBulkOperation({
  admin,
  shop,
  preview,
}: StartPriceAdjustmentBulkOperationInput): Promise<StartPriceAdjustmentBulkOperationResult> {
  // 🔧 FIX: Auto-cleanup stuck operations first
  await cleanupStuckOperations(admin, shop);

  // Check for active operations
  const activeOperation = await findActiveOperationForShop(shop);
  if (activeOperation) {
    throw new Error("A bulk operation is already in progress for this shop.");
  }

  if (!preview.products.length) {
    throw new Error("Cannot start bulk operation without products.");
  }

  // 1. Prepare JSONL Data
  const jsonlLines = preview.products
    .map((product) => {
      const variables = {
        productId: product.id,
        variants: product.variants.map((v) => ({
          id: v.id,
          price: v.priceAfter.toFixed(2),
        })),
      };
      return JSON.stringify(variables);
    })
    .join("\n");

  // 2. Upload JSONL via Staged Uploads
  const stagedPath = await uploadBulkOperationFile(admin, jsonlLines);

  const payload: PriceAdjustmentPayload = {
    adjustment: preview.adjustment,
    products: preview.products.map((product) => ({
      id: product.id,
      title: product.title,
      variants: product.variants.map((variant) => ({
        id: variant.id,
        price: variant.priceAfter,
      })),
    })),
  };

  // Create inverse payload for undo
  const inversePayload: PriceAdjustmentPayload = {
    adjustment: {
      direction:
        preview.adjustment.direction === "increase" ? "decrease" : "increase",
      percentage: preview.adjustment.percentage,
    },
    products: preview.products.map((product) => ({
      id: product.id,
      title: product.title,
      variants: product.variants.map((variant) => ({
        id: variant.id,
        price: variant.priceBefore,
      })),
    })),
  };

  const operationRecord = await createOperation({
    shop,
    type: "PRICE_ADJUSTMENT",
    payload: JSON.parse(JSON.stringify(payload)),
    inversePayload: JSON.parse(JSON.stringify(inversePayload)),
  });

  try {
    // 3. Run Bulk Operation with Staged Path
    const response = await graphqlWithRetry<BulkOperationRunMutationPayload>(
      admin,
      START_BULK_OPERATION_MUTATION,
      {
        variables: {
          mutation: PRICE_ADJUSTMENT_MUTATION,
          stagedUploadPath: stagedPath,
        },
      }
    );

    const userErrors =
      response.data?.bulkOperationRunMutation?.userErrors ?? [];
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

    console.log(`✅ Bulk operation created: ${bulkOperationId}`);

    return { operation: updated };
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to start bulk operation.";
    await updateOperation({
      id: operationRecord.id,
      status: "FAILED",
      errorMessage: message,
    });
    throw error;
  }
}

/**
 * Start a tag update bulk operation
 */
export async function startTagUpdateBulkOperation({
  admin,
  shop,
  preview,
}: StartTagUpdateBulkOperationInput): Promise<StartPriceAdjustmentBulkOperationResult> {
  // Auto-cleanup stuck operations first
  await cleanupStuckOperations(admin, shop);

  // Check for active operations
  const activeOperation = await findActiveOperationForShop(shop);
  if (activeOperation) {
    throw new Error("A bulk operation is already in progress for this shop.");
  }

  if (!preview.products.length) {
    throw new Error("Cannot start bulk operation without products.");
  }

  // 1. Prepare JSONL Data
  const jsonlLines = preview.products
    .map((product) => {
      const variables = {
        input: {
          id: product.id,
          tags: product.tagsAfter,
        },
      };
      return JSON.stringify(variables);
    })
    .join("\n");

  // 2. Upload JSONL via Staged Uploads
  const stagedPath = await uploadBulkOperationFile(admin, jsonlLines);

  const payload = {
    update: preview.update,
    products: preview.products.map((product) => ({
      id: product.id,
      title: product.title,
      tagsBefore: product.tagsBefore,
      tagsAfter: product.tagsAfter,
    })),
  };

  // Create inverse payload for undo
  const inversePayload = {
    update: {
      action: "replace" as const,
      tags: [],
      replaceTags: preview.products.map((p) => p.tagsBefore).flat(),
    },
    products: preview.products.map((product) => ({
      id: product.id,
      title: product.title,
      tagsBefore: product.tagsAfter,
      tagsAfter: product.tagsBefore,
    })),
  };

  const operationRecord = await createOperation({
    shop,
    type: "TAG_UPDATE",
    payload: JSON.parse(JSON.stringify(payload)),
    inversePayload: JSON.parse(JSON.stringify(inversePayload)),
  });

  try {
    // 3. Run Bulk Operation with Staged Path
    const response = await graphqlWithRetry<BulkOperationRunMutationPayload>(
      admin,
      START_BULK_OPERATION_MUTATION,
      {
        variables: {
          mutation: TAG_UPDATE_MUTATION,
          stagedUploadPath: stagedPath,
        },
      }
    );

    const userErrors =
      response.data?.bulkOperationRunMutation?.userErrors ?? [];
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

    console.log(`✅ Tag update bulk operation created: ${bulkOperationId}`);

    return { operation: updated };
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to start bulk operation.";
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
  try {
    const response = await graphqlWithRetry<BulkOperationQueryPayload>(
      admin,
      BULK_OPERATION_STATUS_QUERY,
      {
        variables: { id: bulkOperationId },
      }
    );

    if (!response.data?.node) {
      console.warn(`⚠️ Bulk operation not found in Shopify: ${bulkOperationId}`);

      // Retornar un resultado "EXPIRED" en vez de lanzar error
      return {
        id: bulkOperationId,
        status: "EXPIRED",
        errorCode: "NOT_FOUND",
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
    }

    const node = response.data.node as {
      id: string;
      status: BulkOperationStatus;
      errorCode?: string;
      objectCount?: number;
      fileSize?: number;
      url?: string;
      createdAt: string;
      completedAt?: string;
    };

    return {
      id: node.id,
      status: node.status,
      errorCode: node.errorCode,
      objectCount: node.objectCount,
      fileSize: node.fileSize,
      url: node.url,
      createdAt: node.createdAt,
      completedAt: node.completedAt,
    } satisfies BulkOperationPollResult;
  } catch (error) {
    console.error(`❌ Error polling bulk operation ${bulkOperationId}:`, error);

    return {
      id: bulkOperationId,
      status: "FAILED",
      errorCode: "POLL_ERROR",
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
  }
}

/**
 * Check if there's an active bulk operation - SAFE VERSION
 */
export async function checkActiveBulkOperation(
  admin: AdminApiClient
): Promise<{ id: string; status: BulkOperationStatus } | null> {
  try {
    const response = await graphqlWithRetry<CurrentBulkOperationQueryPayload>(
      admin,
      CURRENT_BULK_OPERATION_QUERY
    );

    const operation = response.data?.currentBulkOperation;

    if (!operation) {
      return null;
    }

    if (operation.status === "RUNNING" || operation.status === "CREATED") {
      return operation;
    }

    return null;
  } catch (error) {
    console.error("Error checking active bulk operation:", error);
    return null; // Fail gracefully
  }
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

      if (item.userErrors && item.userErrors.length > 0) {
        results.failed++;
        for (const error of item.userErrors) {
          results.errors.push({
            productId: item.__parentId,
            message: error.message,
            field: error.field?.join("."),
          });
        }
      } else if (item.data?.productVariantsBulkUpdate?.userErrors?.length > 0) {
        results.failed++;
        for (const error of item.data.productVariantsBulkUpdate.userErrors) {
          results.errors.push({
            message: error.message,
            field: error.field?.join("."),
          });
        }
      } else {
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
 * Update operation with completed status - IMPROVED
 */
export async function completeBulkOperation(
  operationId: string,
  bulkOperationResult: BulkOperationPollResult
): Promise<OperationRecord> {
  const updates: {
    status: "COMPLETED" | "FAILED" | "CANCELLED" | "EXPIRED";
    completedAt: Date;
    errorMessage?: string;
    results?: BulkOperationResults;
  } = {
    status: bulkOperationResult.status === "COMPLETED" ? "COMPLETED" :
      bulkOperationResult.status === "EXPIRED" ? "EXPIRED" :
        "FAILED",
    completedAt: new Date(bulkOperationResult.completedAt ?? Date.now()),
  };

  if (bulkOperationResult.status === "EXPIRED" || bulkOperationResult.errorCode === "NOT_FOUND") {
    updates.status = "EXPIRED";
    updates.errorMessage = "Bulk operation expired or not found in Shopify. This can happen with old operations (>7 days).";

    console.log(`⚠️ Marking operation ${operationId} as EXPIRED`);

    return await updateOperation({
      id: operationId,
      ...updates,
    });
  }

  // Process results if available
  if (bulkOperationResult.url && bulkOperationResult.status === "COMPLETED") {
    try {
      const results = await processBulkOperationResults(
        bulkOperationResult.url
      );
      updates.results = results;
    } catch (error) {
      console.error("Failed to process bulk operation results:", error);
      updates.errorMessage = "Failed to process operation results";
    }
  }

  // Handle errors
  if (
    bulkOperationResult.errorCode ||
    bulkOperationResult.status === "FAILED"
  ) {
    updates.status = "FAILED";
    updates.errorMessage =
      bulkOperationResult.errorCode || "Bulk operation failed";
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

  if (operation.type === "PRICE_ADJUSTMENT") {
    const inversePayload = operation.inversePayload as PriceAdjustmentPayload;

    const preview: PricePreviewResult = {
      adjustment: inversePayload.adjustment,
      products: inversePayload.products.map((product) => ({
        id: product.id,
        title: product.title || "",
        status: "",
        tags: [],
        variants: product.variants.map((variant) => ({
          id: variant.id,
          title: "",
          priceBefore: variant.price,
          priceAfter: variant.price,
          currencyCode: "",
        })),
      })),
    };

    const result = await startPriceAdjustmentBulkOperation({
      admin,
      shop,
      preview,
    });

    await updateOperation({
      id: operationId,
      undone: true,
      undoneAt: new Date(),
      undoneByOperationId: result.operation.id,
    });

    return result;
  } else if (operation.type === "TAG_UPDATE") {
    const inversePayload = operation.inversePayload as any; // TagUpdatePayload

    const preview: TagPreviewResult = {
      update: inversePayload.update,
      products: inversePayload.products.map((product: any) => ({
        id: product.id,
        title: product.title || "",
        status: "",
        tagsBefore: product.tags,
        tags: product.tagsBefore, 
        variants: []
      })),
    };

    const tagPreview: TagPreviewResult = {
      update: inversePayload.update,
      products: inversePayload.products.map((product: any) => ({
        id: product.id,
        title: product.title || "",
        status: "",
        tags: [], 
        tagsBefore: product.tagsBefore,
        tagsAfter: product.tagsAfter, 
      })),
    };

    const result = await startTagUpdateBulkOperation({
      admin,
      shop,
      preview: tagPreview,
    });

    await updateOperation({
      id: operationId,
      undone: true,
      undoneAt: new Date(),
      undoneByOperationId: result.operation.id,
    });

    return result as any;
  }

  throw new Error("Undo not implemented for this operation type");
}

/**
 * Uploads a string content to a staged upload URL
 */
async function uploadBulkOperationFile(
  admin: AdminApiClient,
  jsonlContent: string
): Promise<string> {
  const response = await graphqlWithRetry<StagedUploadsCreatePayload>(
    admin,
    STAGED_UPLOADS_CREATE_MUTATION,
    {
      variables: {
        input: [
          {
            resource: "BULK_MUTATION_VARIABLES",
            filename: "bulk_op_vars.jsonl",
            mimeType: "text/jsonl",
            httpMethod: "POST",
          },
        ],
      },
    }
  );

  const target = response.data?.stagedUploadsCreate?.stagedTargets?.[0];
  const userErrors = response.data?.stagedUploadsCreate?.userErrors;

  if (userErrors?.length) {
    throw new Error(
      `Staged upload failed: ${userErrors.map((e) => e.message).join(", ")}`
    );
  }

  if (!target?.url || !target?.parameters) {
    throw new Error("Failed to get staged upload target.");
  }

  const formData = new FormData();
  for (const param of target.parameters) {
    formData.append(param.name, param.value);
  }
  formData.append("file", new Blob([jsonlContent], { type: "text/jsonl" }));

  const uploadResponse = await fetch(target.url, {
    method: "POST",
    body: formData,
  });

  if (!uploadResponse.ok) {
    throw new Error(`Failed to upload file: ${uploadResponse.statusText}`);
  }

  const keyParam = target.parameters.find((p) => p.name === "key");
  if (!keyParam) throw new Error("Missing key parameter in staged upload.");

  return keyParam.value;
}

// GraphQL Mutations and Queries

const STAGED_UPLOADS_CREATE_MUTATION = `#graphql
  mutation StagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters {
          name
          value
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const START_BULK_OPERATION_MUTATION = `#graphql
  mutation StartBulkOperation($mutation: String!, $stagedUploadPath: String!) {
    bulkOperationRunMutation(mutation: $mutation, stagedUploadPath: $stagedUploadPath) {
      bulkOperation {
        id
        status
        url
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const PRICE_ADJUSTMENT_MUTATION = `
  mutation PriceAdjustment($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      product {
        id
      }
      productVariants {
        id
        price
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const TAG_UPDATE_MUTATION = `
  mutation TagUpdate($input: ProductInput!) {
    productUpdate(input: $input) {
      product {
        id
        tags
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