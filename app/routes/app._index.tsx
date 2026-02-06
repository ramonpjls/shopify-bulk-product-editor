/**
 * Main App Page
 *
 * Improvements:
 * - Real-time operation status polling
 * - Enhanced preview table with diffs
 * - Progress indicator
 * - Better error handling
 * - Rate limit friendly
 */

import { useAppBridge } from "@shopify/app-bridge-react";
import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, useFetcher, useLoaderData } from "react-router";
import { findActiveOperationForShop } from "../models/operation.server";
import {
  pollBulkOperationStatus,
  startPriceAdjustmentBulkOperation,
} from "../services/bulk-operations.server";
import {
  buildPriceAdjustmentPreview,
  fetchProductList,
  type PricePreviewResult,
  type ProductListItem,
  type ProductStatusFilter,
} from "../services/products.server";
import { authenticate } from "../shopify.server";

type LoaderData = {
  products: ProductListItem[];
  pageInfo: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    startCursor: string | null;
    endCursor: string | null;
  };
  availableTags: string[];
  filters: {
    status: ProductStatusFilter;
    tagsInput: string;
  };
  activeOperation?: {
    id: string;
    type: string;
    status: string;
    createdAt: string;
  };
};

type ActionData = {
  preview?: PricePreviewResult;
  operation?: {
    id: string;
    status: string;
    bulkOperationId?: string;
  };
  pollResult?: {
    status: string;
    objectCount?: number;
    errorCode?: string;
  };
  errors?: {
    productIds?: string;
    percentage?: string;
    form?: string;
  };
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);

  const status = parseStatus(url.searchParams.get("status"));
  const tagsInput = url.searchParams.get("tags") ?? "";
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const direction =
    url.searchParams.get("direction") === "backward" ? "backward" : "forward";

  const tags = tagsInput
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

  const list = await fetchProductList(admin, {
    status,
    tags,
    cursor,
    direction,
    pageSize: 25,
  });

  // Check for active operation
  const activeOp = await findActiveOperationForShop(session.shop);

  return {
    products: list.products,
    pageInfo: list.pageInfo,
    availableTags: list.availableTags,
    filters: {
      status,
      tagsInput,
    },
    activeOperation: activeOp
      ? {
          id: activeOp.id,
          type: activeOp.type,
          status: activeOp.status,
          createdAt: activeOp.createdAt.toISOString(),
        }
      : undefined,
  } satisfies LoaderData;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("_action");

  if (intent === "preview-price-adjustment") {
    return handlePreviewAction(formData, admin);
  }

  if (intent === "start-price-adjustment") {
    return handleStartAction(formData, admin, session.shop);
  }

  if (intent === "poll-operation") {
    return handlePollAction(formData, admin);
  }

  return Response.json(
    { errors: { form: "Unsupported action." } },
    { status: 400 },
  );
};

async function handlePreviewAction(formData: FormData, admin: any) {
  const productIds = formData.getAll("productIds").map(String).filter(Boolean);
  const direction =
    formData.get("direction") === "decrease" ? "decrease" : "increase";
  const percentageValue = Number(formData.get("percentage"));

  const errors: ActionData["errors"] = {};

  if (productIds.length === 0) {
    errors.productIds = "Select at least one product to preview changes.";
  }

  if (!Number.isFinite(percentageValue) || percentageValue <= 0) {
    errors.percentage = "Enter a percentage greater than zero.";
  } else if (percentageValue > 1000) {
    errors.percentage = "Percentage is too large.";
  }

  if (errors.productIds || errors.percentage) {
    return Response.json({ errors }, { status: 400 });
  }

  try {
    const preview = await buildPriceAdjustmentPreview(admin, productIds, {
      direction,
      percentage: percentageValue,
    });
    return Response.json({ preview });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to build price preview. Please try again.";
    return Response.json({ errors: { form: message } }, { status: 500 });
  }
}

async function handleStartAction(formData: FormData, admin: any, shop: string) {
  const productIds = formData.getAll("productIds").map(String).filter(Boolean);
  const direction =
    formData.get("direction") === "decrease" ? "decrease" : "increase";
  const percentageValue = Number(formData.get("percentage"));

  const errors: ActionData["errors"] = {};

  if (productIds.length === 0) {
    errors.productIds = "Select at least one product to start the bulk change.";
  }

  if (!Number.isFinite(percentageValue) || percentageValue <= 0) {
    errors.percentage = "Enter a percentage greater than zero.";
  } else if (percentageValue > 1000) {
    errors.percentage = "Percentage is too large.";
  }

  if (errors.productIds || errors.percentage) {
    return Response.json({ errors }, { status: 400 });
  }

  try {
    const previewResult = await buildPriceAdjustmentPreview(admin, productIds, {
      direction,
      percentage: percentageValue,
    });

    if (previewResult.products.length === 0) {
      return Response.json(
        {
          errors: {
            form: "Selected products do not have variants to update.",
          },
        },
        { status: 400 },
      );
    }

    const { operation } = await startPriceAdjustmentBulkOperation({
      admin,
      shop,
      preview: previewResult,
    });

    return Response.json({
      operation: {
        id: operation.id,
        status: operation.status,
        bulkOperationId: operation.bulkOperationId,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to start the bulk operation. Please try again.";
    return Response.json({ errors: { form: message } }, { status: 500 });
  }
}

async function handlePollAction(formData: FormData, admin: any) {
  const bulkOperationId = formData.get("bulkOperationId")?.toString();

  if (!bulkOperationId) {
    return Response.json(
      { errors: { form: "Bulk operation ID required" } },
      { status: 400 },
    );
  }

  try {
    const result = await pollBulkOperationStatus(admin, bulkOperationId);
    return Response.json({ pollResult: result });
  } catch (error) {
    return Response.json(
      {
        errors: {
          form: error instanceof Error ? error.message : "Polling failed",
        },
      },
      { status: 500 },
    );
  }
}

export default function Index() {
  const { products, pageInfo, filters, availableTags, activeOperation } =
    useLoaderData<typeof loader>();
  const previewFetcher = useFetcher<ActionData>();
  const startFetcher = useFetcher<ActionData>();
  const pollFetcher = useFetcher<ActionData>();
  const shopify = useAppBridge();

  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [direction, setDirection] = useState<"increase" | "decrease">(
    "increase",
  );
  const [percentage, setPercentage] = useState("10");

  const isPreviewing =
    previewFetcher.state === "submitting" &&
    previewFetcher.formData?.get("_action") === "preview-price-adjustment";
  const isStarting =
    startFetcher.state === "submitting" &&
    startFetcher.formData?.get("_action") === "start-price-adjustment";

  const preview = previewFetcher.data?.preview;
  const previewErrors = previewFetcher.data?.errors;
  const startErrors = startFetcher.data?.errors;
  const startedOperation = startFetcher.data?.operation;

  // Auto-polling for active operations
  useEffect(() => {
    if (!startedOperation?.bulkOperationId) return;

    const pollInterval = setInterval(() => {
      const formData = new FormData();
      formData.append("_action", "poll-operation");
      formData.append("bulkOperationId", startedOperation.bulkOperationId!);
      pollFetcher.submit(formData, { method: "post" });
    }, 3000); // Poll every 3 seconds

    return () => clearInterval(pollInterval);
  }, [startedOperation?.bulkOperationId]);

  const pollResult = pollFetcher.data?.pollResult;
  const operationComplete =
    pollResult?.status === "COMPLETED" || pollResult?.status === "FAILED";

  // Show success toast when operation completes
  useEffect(() => {
    if (operationComplete && pollResult?.status === "COMPLETED") {
      shopify.toast.show("Bulk operation completed successfully!", {
        duration: 5000,
      });
    }
  }, [operationComplete, pollResult?.status]);

  const toggleProduct = (productId: string) => {
    setSelectedProductIds((prev) =>
      prev.includes(productId)
        ? prev.filter((id) => id !== productId)
        : [...prev, productId],
    );
  };

  const selectAll = () => {
    setSelectedProductIds(products.map((p) => p.id));
  };

  const deselectAll = () => {
    setSelectedProductIds([]);
  };

  const previewProductIds =
    preview?.products.map((product) => product.id) ?? [];
  const selectionMatchesPreview =
    previewProductIds.length > 0 &&
    selectedProductIds.length === previewProductIds.length &&
    selectedProductIds.every((id) => previewProductIds.includes(id));

  return (
    <s-page
      title="Bulk Product Editor"
      actions={
        <Link to="/app/history">
          <s-button variant="tertiary">View History</s-button>
        </Link>
      }
    >
      <s-layout>
        {/* Active Operation Banner */}
        {(activeOperation || startedOperation) && (
          <s-layout-section>
            <s-banner
              tone={
                pollResult?.status === "COMPLETED"
                  ? "success"
                  : pollResult?.status === "FAILED"
                    ? "critical"
                    : "info"
              }
              title={
                pollResult?.status === "COMPLETED"
                  ? "Bulk operation completed"
                  : pollResult?.status === "FAILED"
                    ? "Bulk operation failed"
                    : "Bulk operation in progress"
              }
            >
              {pollResult && (
                <s-stack gap="small-200">
                  <s-text>Status: {pollResult.status}</s-text>
                  {pollResult.objectCount !== undefined && (
                    <s-text>Processed {pollResult.objectCount} items</s-text>
                  )}
                  {pollResult.errorCode && (
                    <s-text>Error: {pollResult.errorCode}</s-text>
                  )}
                </s-stack>
              )}
              {!pollResult && (
                <s-text>
                  Started at{" "}
                  {new Date(activeOperation!.createdAt).toLocaleString()}
                </s-text>
              )}
            </s-banner>
          </s-layout-section>
        )}

        <s-layout-section variant="twoThirds">
          <s-card>
            <s-section>
              <s-stack gap="base">
                {/* Filters */}
                <Form method="get">
                  <s-grid gridTemplateColumns="1fr 1fr auto" gap="base">
                    <div>
                      <label htmlFor="status">
                        <s-text>Product Status</s-text>
                      </label>
                      <select
                        id="status"
                        name="status"
                        defaultValue={filters.status}
                        style={{ width: "100%", padding: "8px" }}
                      >
                        <option value="ANY">Any</option>
                        <option value="ACTIVE">Active</option>
                        <option value="DRAFT">Draft</option>
                        <option value="ARCHIVED">Archived</option>
                      </select>
                    </div>

                    <div>
                      <label htmlFor="tags">
                        <s-text>Tags (comma-separated)</s-text>
                      </label>
                      <input
                        type="text"
                        id="tags"
                        name="tags"
                        defaultValue={filters.tagsInput}
                        placeholder="e.g. sale, summer"
                        style={{ width: "100%", padding: "8px" }}
                      />
                    </div>

                    <div style={{ alignSelf: "flex-end" }}>
                      <s-button type="submit" variant="primary">
                        Filter
                      </s-button>
                    </div>
                  </s-grid>
                </Form>

                {/* Selection Controls */}
                <s-stack
                  direction="inline"
                  gap="small-200"
                  justifyContent="space-between"
                  alignItems="center"
                >
                  <s-stack direction="inline" gap="small-200">
                    <s-button
                      variant="tertiary"
                      size="small"
                      onClick={selectAll}
                    >
                      Select all
                    </s-button>
                    <s-button
                      variant="tertiary"
                      size="small"
                      onClick={deselectAll}
                    >
                      Deselect all
                    </s-button>
                    <s-text tone="neutral">
                      {selectedProductIds.length} selected
                    </s-text>
                  </s-stack>

                  {availableTags.length > 0 && (
                    <s-stack direction="inline" gap="small-200" wrap="wrap">
                      <s-text tone="neutral" variant="bodySm">
                        Available tags:
                      </s-text>
                      {availableTags.slice(0, 5).map((tag) => (
                        <s-clickable-chip key={tag}>{tag}</s-clickable-chip>
                      ))}
                      {availableTags.length > 5 && (
                        <s-text tone="neutral" variant="bodySm">
                          +{availableTags.length - 5} more
                        </s-text>
                      )}
                    </s-stack>
                  )}
                </s-stack>

                {/* Product List */}
                <s-stack>
                  {products.map((product) => {
                    const selected = selectedProductIds.includes(product.id);
                    return (
                      <s-clickable
                        key={product.id}
                        borderStyle="solid none none none"
                        border="base"
                        paddingInline="base"
                        paddingBlock="small"
                        onClick={() => toggleProduct(product.id)}
                      >
                        <s-grid
                          gridTemplateColumns="auto 1fr auto"
                          gap="base"
                          alignItems="center"
                        >
                          <input
                            type="checkbox"
                            aria-label={`Select ${product.title}`}
                            checked={selected}
                            onChange={() => toggleProduct(product.id)}
                            onClick={(event) => event.stopPropagation()}
                          />

                          <s-stack gap="small-200">
                            <strong>{product.title}</strong>
                            <s-text tone="neutral" variant="bodySm">
                              {product.status.toLowerCase()} ·{" "}
                              {product.variants.length} variant
                              {product.variants.length !== 1 ? "s" : ""}
                            </s-text>
                            {product.tags.length > 0 && (
                              <s-stack
                                direction="inline"
                                gap="small-200"
                                wrap="wrap"
                              >
                                {product.tags.map((tag) => (
                                  <s-clickable-chip key={tag}>
                                    {tag}
                                  </s-clickable-chip>
                                ))}
                              </s-stack>
                            )}
                          </s-stack>

                          <s-stack gap="small-200" alignItems="flex-end">
                            {product.variants.map((variant) => (
                              <s-text key={variant.id} variant="bodySm">
                                {variant.title}: ${variant.price.toFixed(2)}
                              </s-text>
                            ))}
                          </s-stack>
                        </s-grid>
                      </s-clickable>
                    );
                  })}

                  {products.length === 0 && (
                    <s-stack paddingInline="base" paddingBlock="base">
                      <s-text tone="neutral">
                        No products match your filters.
                      </s-text>
                    </s-stack>
                  )}
                </s-stack>

                {/* Pagination */}
                <s-stack
                  direction="inline"
                  gap="small-200"
                  justifyContent="flex-end"
                >
                  {pageInfo.hasPreviousPage && (
                    <Form method="get">
                      <input
                        type="hidden"
                        name="status"
                        value={filters.status}
                      />
                      <input
                        type="hidden"
                        name="tags"
                        value={filters.tagsInput}
                      />
                      <input
                        type="hidden"
                        name="cursor"
                        value={pageInfo.startCursor ?? ""}
                      />
                      <input type="hidden" name="direction" value="backward" />
                      <s-button type="submit" variant="tertiary">
                        Previous
                      </s-button>
                    </Form>
                  )}
                  {pageInfo.hasNextPage && (
                    <Form method="get">
                      <input
                        type="hidden"
                        name="status"
                        value={filters.status}
                      />
                      <input
                        type="hidden"
                        name="tags"
                        value={filters.tagsInput}
                      />
                      <input
                        type="hidden"
                        name="cursor"
                        value={pageInfo.endCursor ?? ""}
                      />
                      <input type="hidden" name="direction" value="forward" />
                      <s-button type="submit" variant="tertiary">
                        Next
                      </s-button>
                    </Form>
                  )}
                </s-stack>
              </s-stack>
            </s-section>
          </s-card>
        </s-layout-section>

        <s-layout-section variant="oneThird">
          <s-card>
            <s-section>
              <s-stack gap="base">
                <s-text variant="headingMd">Price Adjustment</s-text>

                <previewFetcher.Form method="post">
                  <input
                    type="hidden"
                    name="_action"
                    value="preview-price-adjustment"
                  />
                  {selectedProductIds.map((id) => (
                    <input
                      key={id}
                      type="hidden"
                      name="productIds"
                      value={id}
                    />
                  ))}

                  <s-stack gap="base">
                    <div>
                      <label>
                        <s-text>Direction</s-text>
                      </label>
                      <select
                        name="direction"
                        value={direction}
                        onChange={(e) =>
                          setDirection(
                            e.target.value as "increase" | "decrease",
                          )
                        }
                        style={{ width: "100%", padding: "8px" }}
                      >
                        <option value="increase">Increase</option>
                        <option value="decrease">Decrease</option>
                      </select>
                    </div>

                    <div>
                      <label htmlFor="percentage">
                        <s-text>Percentage</s-text>
                      </label>
                      <input
                        type="number"
                        id="percentage"
                        name="percentage"
                        value={percentage}
                        onChange={(e) => setPercentage(e.target.value)}
                        min="0"
                        max="1000"
                        step="0.1"
                        style={{ width: "100%", padding: "8px" }}
                      />
                      {previewErrors?.percentage && (
                        <s-text tone="critical" variant="bodySm">
                          {previewErrors.percentage}
                        </s-text>
                      )}
                    </div>

                    <s-button
                      type="submit"
                      variant="secondary"
                      loading={isPreviewing}
                      disabled={selectedProductIds.length === 0}
                    >
                      Generate Preview
                    </s-button>

                    {previewErrors?.productIds && (
                      <s-text tone="critical">
                        {previewErrors.productIds}
                      </s-text>
                    )}
                    {previewErrors?.form && (
                      <s-text tone="critical">{previewErrors.form}</s-text>
                    )}
                  </s-stack>
                </previewFetcher.Form>

                {/* Enhanced Preview Table */}
                {!isPreviewing && preview && preview.products.length > 0 && (
                  <s-stack gap="base">
                    <s-divider />
                    <s-text variant="headingSm">Preview Changes</s-text>

                    <div style={{ maxHeight: "400px", overflowY: "auto" }}>
                      <table style={{ width: "100%", fontSize: "0.875rem" }}>
                        <thead>
                          <tr style={{ borderBottom: "1px solid #e1e1e1" }}>
                            <th style={{ textAlign: "left", padding: "8px" }}>
                              Product
                            </th>
                            <th style={{ textAlign: "right", padding: "8px" }}>
                              Before
                            </th>
                            <th style={{ textAlign: "right", padding: "8px" }}>
                              After
                            </th>
                            <th style={{ textAlign: "right", padding: "8px" }}>
                              Change
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.products.map((product) =>
                            product.variants.map((variant, idx) => (
                              <tr
                                key={variant.id}
                                style={{
                                  borderBottom: "1px solid #f1f1f1",
                                  backgroundColor:
                                    idx % 2 === 0 ? "#fafafa" : "white",
                                }}
                              >
                                <td style={{ padding: "8px" }}>
                                  <div>
                                    <strong>{product.title}</strong>
                                    <br />
                                    <span style={{ color: "#666" }}>
                                      {variant.title}
                                    </span>
                                  </div>
                                </td>
                                <td
                                  style={{
                                    textAlign: "right",
                                    padding: "8px",
                                    textDecoration: "line-through",
                                    color: "#999",
                                  }}
                                >
                                  ${variant.priceBefore.toFixed(2)}
                                </td>
                                <td
                                  style={{
                                    textAlign: "right",
                                    padding: "8px",
                                    fontWeight: "bold",
                                  }}
                                >
                                  ${variant.priceAfter.toFixed(2)}
                                </td>
                                <td
                                  style={{
                                    textAlign: "right",
                                    padding: "8px",
                                  }}
                                >
                                  <s-badge
                                    tone={
                                      variant.priceAfter > variant.priceBefore
                                        ? "info"
                                        : "warning"
                                    }
                                  >
                                    {variant.priceAfter > variant.priceBefore
                                      ? "+"
                                      : ""}
                                    {(
                                      ((variant.priceAfter -
                                        variant.priceBefore) /
                                        variant.priceBefore) *
                                      100
                                    ).toFixed(1)}
                                    %
                                  </s-badge>
                                </td>
                              </tr>
                            )),
                          )}
                        </tbody>
                      </table>
                    </div>

                    <s-divider />

                    {/* Start Operation Button */}
                    <startFetcher.Form method="post">
                      <input
                        type="hidden"
                        name="_action"
                        value="start-price-adjustment"
                      />
                      {preview.products.map((product) => (
                        <input
                          key={product.id}
                          type="hidden"
                          name="productIds"
                          value={product.id}
                        />
                      ))}
                      <input type="hidden" name="direction" value={direction} />
                      <input
                        type="hidden"
                        name="percentage"
                        value={percentage}
                      />

                      <s-button
                        type="submit"
                        variant="primary"
                        loading={isStarting}
                        disabled={!selectionMatchesPreview || isStarting}
                      >
                        Start Bulk Update
                      </s-button>

                      {!selectionMatchesPreview && (
                        <s-text tone="neutral" variant="bodySm">
                          Rerun the preview after adjusting your selection.
                        </s-text>
                      )}

                      {startErrors?.form && (
                        <s-text tone="critical">{startErrors.form}</s-text>
                      )}
                    </startFetcher.Form>
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

function parseStatus(value: string | null): ProductStatusFilter {
  if (!value) return "ANY";
  const normalized = value.toUpperCase();
  if (
    normalized === "ACTIVE" ||
    normalized === "DRAFT" ||
    normalized === "ARCHIVED"
  ) {
    return normalized as ProductStatusFilter;
  }
  return "ANY";
}
