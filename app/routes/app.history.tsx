/**
 * History Page - Operation History with Undo
 *
 * Displays all past bulk operations with:
 * - Status badges
 * - Results summary
 * - Undo functionality
 * - Filtering and pagination
 */

import { useCallback, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData, useNavigation, useSubmit } from "react-router";
import {
  findOperationsByShop,
  getOperationStats,
  type OperationRecord,
} from "../models/operation.server";
import { undoOperation } from "../services/bulk-operations.server";
import { authenticate } from "../shopify.server";

type LoaderData = {
  operations: OperationRecord[];
  total: number;
  stats: {
    total: number;
    completed: number;
    failed: number;
    running: number;
  };
  filters: {
    status?: string;
    type?: string;
  };
  pagination: {
    page: number;
    pageSize: number;
    totalPages: number;
  };
};

type ActionData = {
  success?: boolean;
  error?: string;
  operationId?: string;
};

const PAGE_SIZE = 25;

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);

  const status = url.searchParams.get("status") || undefined;
  const type = url.searchParams.get("type") || undefined;
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));

  const offset = (page - 1) * PAGE_SIZE;

  const { operations, total } = await findOperationsByShop(session.shop, {
    status: status as any,
    type: type as any,
    limit: PAGE_SIZE,
    offset,
  });

  const stats = await getOperationStats(session.shop);

  return {
    operations,
    total,
    stats,
    filters: { status, type },
    pagination: {
      page,
      pageSize: PAGE_SIZE,
      totalPages: Math.ceil(total / PAGE_SIZE),
    },
  } satisfies LoaderData;
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "undo") {
    const operationId = formData.get("operationId")?.toString();

    if (!operationId) {
      return Response.json(
        { error: "Operation ID required" } satisfies ActionData,
        { status: 400 },
      );
    }

    try {
      const result = await undoOperation(admin, session.shop, operationId);

      return Response.json({
        success: true,
        operationId: result.operation.id,
      } satisfies ActionData);
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof Error ? error.message : "Failed to undo operation",
        } satisfies ActionData,
        { status: 500 },
      );
    }
  }

  if (intent === "refresh") {
    const operationId = formData.get("operationId")?.toString();

    if (!operationId) {
      return Response.json(
        { error: "Operation ID required" } satisfies ActionData,
        { status: 400 },
      );
    }

    // Trigger a refresh by polling Shopify (webhook might have failed)
    // Implementation would go here

    return Response.json({ success: true } satisfies ActionData);
  }

  return Response.json({ error: "Unknown action" } satisfies ActionData, {
    status: 400,
  });
}

export default function History() {
  const { operations, stats, filters, pagination } =
    useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [selectedOperation, setSelectedOperation] = useState<string | null>(
    null,
  );

  const isUndoing =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "undo";

  const handleUndo = useCallback(
    (operationId: string) => {
      if (
        confirm(
          "Are you sure you want to undo this operation? This will create a new bulk operation to revert the changes.",
        )
      ) {
        setSelectedOperation(operationId);
        const formData = new FormData();
        formData.append("intent", "undo");
        formData.append("operationId", operationId);
        submit(formData, { method: "post" });
      }
    },
    [submit],
  );

  return (
    <s-page title="Operation History">
      <s-layout>
        <s-layout-section>
          {/* Stats Cards */}
          <s-grid gridTemplateColumns="repeat(4, 1fr)" gap="base">
            <s-card>
              <s-stack gap="small-200">
                <s-text tone="neutral">Total Operations</s-text>
                <s-text variant="headingLg">{stats.total}</s-text>
              </s-stack>
            </s-card>
            <s-card>
              <s-stack gap="small-200">
                <s-text tone="neutral">Completed</s-text>
                <s-text variant="headingLg" tone="success">
                  {stats.completed}
                </s-text>
              </s-stack>
            </s-card>
            <s-card>
              <s-stack gap="small-200">
                <s-text tone="neutral">Failed</s-text>
                <s-text variant="headingLg" tone="critical">
                  {stats.failed}
                </s-text>
              </s-stack>
            </s-card>
            <s-card>
              <s-stack gap="small-200">
                <s-text tone="neutral">Running</s-text>
                <s-text variant="headingLg" tone="info">
                  {stats.running}
                </s-text>
              </s-stack>
            </s-card>
          </s-grid>

          {/* Filters */}
          <s-card>
            <Form method="get">
              <s-grid
                gridTemplateColumns="1fr 1fr auto"
                gap="base"
                alignItems="end"
              >
                <div>
                  <label htmlFor="status">
                    <s-text>Status</s-text>
                  </label>
                  <select
                    id="status"
                    name="status"
                    defaultValue={filters.status || ""}
                    style={{ width: "100%", padding: "8px" }}
                  >
                    <option value="">All Statuses</option>
                    <option value="COMPLETED">Completed</option>
                    <option value="RUNNING">Running</option>
                    <option value="FAILED">Failed</option>
                    <option value="CANCELED">Canceled</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="type">
                    <s-text>Type</s-text>
                  </label>
                  <select
                    id="type"
                    name="type"
                    defaultValue={filters.type || ""}
                    style={{ width: "100%", padding: "8px" }}
                  >
                    <option value="">All Types</option>
                    <option value="PRICE_ADJUSTMENT">Price Adjustment</option>
                    <option value="TAG_UPDATE">Tag Update</option>
                    <option value="STATUS_CHANGE">Status Change</option>
                  </select>
                </div>

                <s-button type="submit" variant="primary">
                  Apply Filters
                </s-button>
              </s-grid>
            </Form>
          </s-card>

          {/* Operations Table */}
          <s-card>
            <s-section>
              <s-stack gap="base">
                {operations.length === 0 ? (
                  <s-stack
                    paddingInline="base"
                    paddingBlock="large"
                    alignItems="center"
                  >
                    <s-text tone="neutral">No operations found.</s-text>
                  </s-stack>
                ) : (
                  <s-stack>
                    {/* Table Header */}
                    <s-grid
                      gridTemplateColumns="2fr 1fr 1fr 1fr 2fr 1fr"
                      gap="base"
                      paddingInline="base"
                      paddingBlock="small"
                      borderStyle="none none solid none"
                      border="base"
                    >
                      <s-text variant="headingSm">Date</s-text>
                      <s-text variant="headingSm">Type</s-text>
                      <s-text variant="headingSm">Status</s-text>
                      <s-text variant="headingSm">Items</s-text>
                      <s-text variant="headingSm">Results</s-text>
                      <s-text variant="headingSm">Actions</s-text>
                    </s-grid>

                    {/* Table Rows */}
                    {operations.map((operation) => (
                      <s-grid
                        key={operation.id}
                        gridTemplateColumns="2fr 1fr 1fr 1fr 2fr 1fr"
                        gap="base"
                        paddingInline="base"
                        paddingBlock="small"
                        borderStyle="none none solid none"
                        border="base"
                        alignItems="center"
                      >
                        {/* Date */}
                        <s-stack gap="small-200">
                          <s-text>{formatDate(operation.createdAt)}</s-text>
                          {operation.completedAt && (
                            <s-text tone="neutral" variant="bodySm">
                              Completed: {formatDate(operation.completedAt)}
                            </s-text>
                          )}
                        </s-stack>

                        {/* Type */}
                        <s-text>{formatOperationType(operation.type)}</s-text>

                        {/* Status */}
                        <div>
                          <StatusBadge
                            status={operation.status}
                            undone={operation.undone}
                          />
                        </div>

                        {/* Items Count */}
                        <s-text>
                          {operation.payload?.products?.length ?? 0} products
                        </s-text>

                        {/* Results */}
                        <div>
                          {operation.results ? (
                            <s-stack gap="small-200">
                              <s-text tone="success" variant="bodySm">
                                ✓ {operation.results.successful} successful
                              </s-text>
                              {operation.results.failed > 0 && (
                                <s-text tone="critical" variant="bodySm">
                                  ✗ {operation.results.failed} failed
                                </s-text>
                              )}
                            </s-stack>
                          ) : operation.status === "RUNNING" ? (
                            <s-text tone="neutral" variant="bodySm">
                              In progress...
                            </s-text>
                          ) : operation.errorMessage ? (
                            <s-text tone="critical" variant="bodySm">
                              {operation.errorMessage}
                            </s-text>
                          ) : (
                            <s-text tone="neutral" variant="bodySm">
                              No results
                            </s-text>
                          )}
                        </div>

                        {/* Actions */}
                        <div>
                          {operation.status === "COMPLETED" &&
                            !operation.undone &&
                            operation.inversePayload && (
                              <s-button
                                variant="tertiary"
                                size="small"
                                onClick={() => handleUndo(operation.id)}
                                disabled={
                                  isUndoing &&
                                  selectedOperation === operation.id
                                }
                              >
                                {isUndoing && selectedOperation === operation.id
                                  ? "Undoing..."
                                  : "Undo"}
                              </s-button>
                            )}
                          {operation.undone && (
                            <s-text tone="neutral" variant="bodySm">
                              Undone
                            </s-text>
                          )}
                        </div>
                      </s-grid>
                    ))}
                  </s-stack>
                )}

                {/* Pagination */}
                {pagination.totalPages > 1 && (
                  <s-stack
                    direction="inline"
                    gap="small-200"
                    justifyContent="center"
                    paddingBlock="base"
                  >
                    {pagination.page > 1 && (
                      <Form method="get">
                        <input
                          type="hidden"
                          name="page"
                          value={pagination.page - 1}
                        />
                        {filters.status && (
                          <input
                            type="hidden"
                            name="status"
                            value={filters.status}
                          />
                        )}
                        {filters.type && (
                          <input
                            type="hidden"
                            name="type"
                            value={filters.type}
                          />
                        )}
                        <s-button type="submit" variant="tertiary">
                          Previous
                        </s-button>
                      </Form>
                    )}

                    <s-text>
                      Page {pagination.page} of {pagination.totalPages}
                    </s-text>

                    {pagination.page < pagination.totalPages && (
                      <Form method="get">
                        <input
                          type="hidden"
                          name="page"
                          value={pagination.page + 1}
                        />
                        {filters.status && (
                          <input
                            type="hidden"
                            name="status"
                            value={filters.status}
                          />
                        )}
                        {filters.type && (
                          <input
                            type="hidden"
                            name="type"
                            value={filters.type}
                          />
                        )}
                        <s-button type="submit" variant="tertiary">
                          Next
                        </s-button>
                      </Form>
                    )}
                  </s-stack>
                )}
              </s-stack>
            </s-section>
          </s-card>
        </s-layout-section>
      </s-layout>
    </s-page>
  );
}

function StatusBadge({ status, undone }: { status: string; undone?: boolean }) {
  if (undone) {
    return (
      <s-badge tone="neutral" variant="subtle">
        Undone
      </s-badge>
    );
  }

  switch (status) {
    case "COMPLETED":
      return (
        <s-badge tone="success" variant="subtle">
          Completed
        </s-badge>
      );
    case "RUNNING":
      return (
        <s-badge tone="info" variant="subtle">
          Running
        </s-badge>
      );
    case "FAILED":
      return (
        <s-badge tone="critical" variant="subtle">
          Failed
        </s-badge>
      );
    case "CANCELED":
      return (
        <s-badge tone="neutral" variant="subtle">
          Canceled
        </s-badge>
      );
    default:
      return (
        <s-badge tone="neutral" variant="subtle">
          {status}
        </s-badge>
      );
  }
}

function formatOperationType(type: string): string {
  switch (type) {
    case "PRICE_ADJUSTMENT":
      return "Price Adjustment";
    case "TAG_UPDATE":
      return "Tag Update";
    case "STATUS_CHANGE":
      return "Status Change";
    default:
      return type;
  }
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date));
}
