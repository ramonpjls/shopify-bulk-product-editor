/**
 * Webhook Handler for Bulk Operations
 *
 * Receives notifications from Shopify when bulk operations complete.
 * Topic: BULK_OPERATIONS_FINISH
 */

import type { ActionFunctionArgs } from "react-router";
import {
  findOperationByBulkId,
  updateOperation,
  type OperationRecord,
} from "../models/operation.server";
import {
  pollBulkOperationStatus,
  processBulkOperationResults,
  type BulkOperationResults,
} from "../services/bulk-operations.server";
import { authenticate } from "../shopify.server";

/**
 * Shopify Bulk Operations Webhook Payload
 */
type BulkOperationsFinishWebhook = {
  admin_graphql_api_id: string;
  completed_at: string;
};

/**
 * Handle BULK_OPERATIONS_FINISH webhook
 */
export async function action({ request }: ActionFunctionArgs) {
  try {
    // Authenticate webhook using Shopify's HMAC validation
    const { topic, shop, session, admin } = await authenticate.webhook(request);

    console.log(`Received webhook: ${topic} from ${shop}`);

    if (topic !== "BULK_OPERATIONS_FINISH") {
      return new Response("Webhook topic not supported", { status: 200 });
    }

    // Parse webhook payload
    const payload = (await request.json()) as BulkOperationsFinishWebhook;
    const bulkOperationId = payload.admin_graphql_api_id;

    console.log(`Processing bulk operation completion: ${bulkOperationId}`);

    // Find our operation record
    const operation = await findOperationByBulkId(bulkOperationId);

    if (!operation) {
      console.warn(
        `No operation found for bulk operation ID: ${bulkOperationId}`,
      );
      return new Response("Operation not found", { status: 200 });
    }

    // Poll Shopify for detailed status
    const bulkStatus = await pollBulkOperationStatus(admin, bulkOperationId);

    console.log(`Bulk operation status: ${bulkStatus.status}`);

    // Process results
    const updates: {
      status: OperationRecord["status"];
      completedAt: Date;
      errorMessage?: string;
      results?: BulkOperationResults;
    } = {
      status:
        bulkStatus.status === "COMPLETED"
          ? "COMPLETED"
          : bulkStatus.status === "EXPIRED"
            ? "EXPIRED"
            : "FAILED",
      completedAt: new Date(bulkStatus.completedAt ?? payload.completed_at),
    };

    // Handle EXPIRED status specifically
    if (
      bulkStatus.status === "EXPIRED" ||
      bulkStatus.errorCode === "NOT_FOUND"
    ) {
      updates.status = "EXPIRED";
      updates.errorMessage =
        "Bulk operation expired or not found in Shopify. This can happen with old operations (>7 days).";
      console.log(`⚠️ Marking operation ${operation.id} as EXPIRED`);
    }

    // Download and process JSONL results
    if (bulkStatus.url && bulkStatus.status === "COMPLETED") {
      try {
        console.log(`Processing results from: ${bulkStatus.url}`);
        const results = await processBulkOperationResults(bulkStatus.url);

        updates.results = results;

        console.log(
          `Results processed: ${results.successful} successful, ${results.failed} failed`,
        );

        // If there were errors, include summary in error message
        if (results.failed > 0) {
          const errorSummary = results.errors
            .slice(0, 5) // First 5 errors
            .map((err) => err.message)
            .join("; ");

          updates.errorMessage = `${results.failed} items failed. First errors: ${errorSummary}`;
        }
      } catch (error) {
        console.error("Failed to process bulk operation results:", error);
        updates.errorMessage = "Failed to process operation results";
        updates.status = "FAILED";
      }
    }

    // Handle error codes from Shopify
    if (bulkStatus.errorCode) {
      updates.status = "FAILED";
      updates.errorMessage = `Shopify error: ${bulkStatus.errorCode}`;
    }

    // Update our database
    await updateOperation({
      id: operation.id,
      ...updates,
    });

    console.log(
      `Operation ${operation.id} updated with status: ${updates.status}`,
    );

    return new Response("Webhook processed", { status: 200 });
  } catch (error) {
    console.error("Error processing bulk operations webhook:", error);

    // Return 200 to prevent Shopify from retrying
    // (We've logged the error for debugging)
    return new Response("Webhook processing error", { status: 200 });
  }
}

/**
 * No loader for webhooks
 */
export async function loader() {
  return new Response("Method not allowed", { status: 405 });
}
