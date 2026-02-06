import {
  createOperation,
  findActiveOperationForShop,
  updateOperation,
  type OperationRecord,
} from "../models/operation.server";
import type { AdminApiClient, PricePreviewResult } from "./products.server";

export type StartPriceAdjustmentBulkOperationInput = {
  admin: AdminApiClient;
  shop: string;
  preview: PricePreviewResult;
};

export type StartPriceAdjustmentBulkOperationResult = {
  operation: OperationRecord;
};

export async function startPriceAdjustmentBulkOperation({
  admin,
  shop,
  preview,
}: StartPriceAdjustmentBulkOperationInput): Promise<StartPriceAdjustmentBulkOperationResult> {
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

  const operationRecord = await createOperation({
    shop,
    type: "PRICE_ADJUSTMENT",
    payload,
  });

  try {
    const response = await admin.graphql(START_BULK_OPERATION_MUTATION, {
      variables: {
        mutation,
      },
    });

    const json = (await response.json()) as BulkOperationRunMutationResponse;

    const userErrors = json.data?.bulkOperationRunMutation?.userErrors ?? [];
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
      json.data?.bulkOperationRunMutation?.bulkOperation?.id;
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

function buildPriceAdjustmentMutation(preview: PricePreviewResult): string {
  const aliasMutations = preview.products
    .map((product, productIndex) => {
      const variantsMutations = product.variants
        .map((variant) => {
          const price = variant.priceAfter.toFixed(2);
          return `{ id: "${variant.id}", price: "${price}" }`;
        })
        .join(",\n");

      return `update_${productIndex}: productVariantsBulkUpdate(productId: "${product.id}", variants: [${variantsMutations}]) { userErrors { field message } }`;
    })
    .join("\n");

  return `mutation {\n${aliasMutations}\n}`;
}

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
