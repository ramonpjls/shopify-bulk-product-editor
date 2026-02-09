/**
 * Main App Page
 *
 * This route serves as the central hub for managing bulk product edits. It allows merchants to:
 * - View and filter their product list
 * - Select products for bulk editing
 * - Generate previews for price adjustments and tag updates
 * - Start bulk operations for price adjustments and tag updates
 * - Monitor the status of ongoing bulk operations with auto-polling
 *
 * The loader fetches the initial product list based on filters and checks for any active operations.
 */

import { useAppBridge } from "@shopify/app-bridge-react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
  Divider,
  Grid,
  InlineStack,
  Layout,
  Page,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useFetcher, useLoaderData, useRevalidator } from "react-router";
import { findActiveOperationForShop } from "../models/operation.server";
import {
  completeBulkOperation,
  pollBulkOperationStatus,
  startPriceAdjustmentBulkOperation,
  startTagUpdateBulkOperation,
} from "../services/bulk-operations.server";
import {
  buildPriceAdjustmentPreview,
  buildTagUpdatePreview,
  fetchProductList,
  type AdminApiClient,
  type PricePreviewResult,
  type ProductListItem,
  type ProductStatusFilter,
  type TagPreviewResult,
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
    bulkOperationId?: string;
  };
};

type ActionData = {
  pricePreview?: PricePreviewResult;
  tagPreview?: TagPreviewResult;
  operation?: {
    id: string;
    status: string;
    bulkOperationId?: string;
  };
  pollResult?: {
    status: string;
    objectCount?: number;
    errorCode?: string;
    operationUpdated?: boolean;
  };
  errors?: {
    productIds?: string;
    percentage?: string;
    tags?: string;
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
          bulkOperationId: activeOp.bulkOperationId || undefined,
        }
      : undefined,
  } satisfies LoaderData;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("_action");

  if (intent === "preview-price-adjustment") {
    return handlePricePreviewAction(formData, admin);
  }

  if (intent === "start-price-adjustment") {
    return handlePriceStartAction(formData, admin, session.shop);
  }

  if (intent === "preview-tag-update") {
    return handleTagPreviewAction(formData, admin);
  }

  if (intent === "start-tag-update") {
    return handleTagStartAction(formData, admin, session.shop);
  }

  if (intent === "poll-operation") {
    return handlePollAction(formData, admin);
  }

  return Response.json(
    { errors: { form: "Unsupported action." } },
    { status: 400 },
  );
};

async function handlePricePreviewAction(
  formData: FormData,
  admin: AdminApiClient,
) {
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
    const pricePreview = await buildPriceAdjustmentPreview(admin, productIds, {
      direction,
      percentage: percentageValue,
    });
    return Response.json({ pricePreview });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to build price preview. Please try again.";
    return Response.json({ errors: { form: message } }, { status: 500 });
  }
}

async function handlePriceStartAction(
  formData: FormData,
  admin: AdminApiClient,
  shop: string,
) {
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

async function handleTagPreviewAction(
  formData: FormData,
  admin: AdminApiClient,
) {
  const productIds = formData.getAll("productIds").map(String).filter(Boolean);
  const tagAction =
    (formData.get("tagAction")?.toString() as "add" | "remove" | "replace") ||
    "add";
  const tagsInput = formData.get("tags")?.toString() || "";
  const tags = tagsInput
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const errors: ActionData["errors"] = {};

  if (productIds.length === 0) {
    errors.productIds = "Select at least one product to preview changes.";
  }

  if (tags.length === 0) {
    errors.tags = "Enter at least one tag.";
  }

  if (errors.productIds || errors.tags) {
    return Response.json({ errors }, { status: 400 });
  }

  try {
    const tagPreview = await buildTagUpdatePreview(admin, productIds, {
      action: tagAction,
      tags,
    });
    return Response.json({ tagPreview });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to build tag preview. Please try again.";
    return Response.json({ errors: { form: message } }, { status: 500 });
  }
}

async function handleTagStartAction(
  formData: FormData,
  admin: AdminApiClient,
  shop: string,
) {
  const productIds = formData.getAll("productIds").map(String).filter(Boolean);
  const tagAction =
    (formData.get("tagAction")?.toString() as "add" | "remove" | "replace") ||
    "add";
  const tagsInput = formData.get("tags")?.toString() || "";
  const tags = tagsInput
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const errors: ActionData["errors"] = {};

  if (productIds.length === 0) {
    errors.productIds = "Select at least one product.";
  }

  if (tags.length === 0) {
    errors.tags = "Enter at least one tag.";
  }

  if (errors.productIds || errors.tags) {
    return Response.json({ errors }, { status: 400 });
  }

  try {
    const previewResult = await buildTagUpdatePreview(admin, productIds, {
      action: tagAction,
      tags,
    });

    if (previewResult.products.length === 0) {
      return Response.json(
        {
          errors: {
            form: "Selected products could not be found.",
          },
        },
        { status: 400 },
      );
    }

    const { operation } = await startTagUpdateBulkOperation({
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
        : "Failed to start tag update operation.";
    return Response.json({ errors: { form: message } }, { status: 500 });
  }
}

async function handlePollAction(formData: FormData, admin: AdminApiClient) {
  const bulkOperationId = formData.get("bulkOperationId")?.toString();
  const operationId = formData.get("operationId")?.toString();

  if (!bulkOperationId) {
    return Response.json(
      { errors: { form: "Bulk operation ID required" } },
      { status: 400 },
    );
  }

  try {
    const bulkStatus = await pollBulkOperationStatus(admin, bulkOperationId);

    let operationUpdated = false;
    if (
      operationId &&
      (bulkStatus.status === "COMPLETED" || bulkStatus.status === "FAILED")
    ) {
      try {
        await completeBulkOperation(operationId, bulkStatus);
        operationUpdated = true;
        console.log(
          `✅ Operation ${operationId} updated to ${bulkStatus.status}`,
        );
      } catch (error) {
        console.error("Failed to update operation:", error);
      }
    }

    return Response.json({
      pollResult: {
        status: bulkStatus.status,
        objectCount: bulkStatus.objectCount,
        errorCode: bulkStatus.errorCode,
        operationUpdated,
      },
    });
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
  const revalidator = useRevalidator();
  const shopify = useAppBridge();
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [direction, setDirection] = useState<"increase" | "decrease">(
    "increase",
  );
  const [percentage, setPercentage] = useState("10");
  const [pollCount, setPollCount] = useState(0);
  const [tagAction, setTagAction] = useState<"add" | "remove" | "replace">(
    "add",
  );
  const [tagInput, setTagInput] = useState("");

  // Filter state
  const [statusFilter, setStatusFilter] = useState(filters.status);
  const [tagsFilter, setTagsFilter] = useState(filters.tagsInput);

  // Sync filters from URL/loader
  useEffect(() => {
    setStatusFilter(filters.status);
    setTagsFilter(filters.tagsInput);
  }, [filters]);

  const isPreviewing =
    previewFetcher.state === "submitting" &&
    (previewFetcher.formData?.get("_action") === "preview-price-adjustment" ||
      previewFetcher.formData?.get("_action") === "preview-tag-update");
  const isStarting =
    startFetcher.state === "submitting" &&
    (startFetcher.formData?.get("_action") === "start-price-adjustment" ||
      startFetcher.formData?.get("_action") === "start-tag-update");
  const pricePreview = previewFetcher.data?.pricePreview;
  const tagPreview = previewFetcher.data?.tagPreview;
  const previewErrors = previewFetcher.data?.errors;
  const startErrors = startFetcher.data?.errors;
  const startedOperation = startFetcher.data?.operation;
  const operationToMonitor = startedOperation || activeOperation;

  // Auto-polling
  useEffect(() => {
    if (!operationToMonitor?.bulkOperationId) {
      setPollCount(0);
      return;
    }

    const pollInterval = setInterval(() => {
      const formData = new FormData();
      formData.append("_action", "poll-operation");
      formData.append("bulkOperationId", operationToMonitor.bulkOperationId!);
      formData.append("operationId", operationToMonitor.id);

      pollFetcher.submit(formData, { method: "post" });
      setPollCount((prev) => prev + 1);
    }, 3000);

    return () => {
      clearInterval(pollInterval);
      console.log(
        `⏹️ Stopped polling for ${operationToMonitor.bulkOperationId}, polled ${pollCount} times`,
      );
    };
  }, [operationToMonitor?.bulkOperationId]);

  const pollResult = pollFetcher.data?.pollResult;
  const operationComplete =
    pollResult?.status === "COMPLETED" || pollResult?.status === "FAILED";

  useEffect(() => {
    if (pollResult?.operationUpdated) {
      console.log("♻️ Revalidating loader data...");
      revalidator.revalidate();
    }
  }, [pollResult?.operationUpdated, revalidator]);

  useEffect(() => {
    if (operationComplete && pollResult?.status === "COMPLETED") {
      shopify.toast.show("Bulk operation completed successfully!", {
        duration: 5000,
      });
      setTimeout(() => revalidator.revalidate(), 1000);
    } else if (operationComplete && pollResult?.status === "FAILED") {
      shopify.toast.show("Bulk operation failed. Check history for details.", {
        duration: 5000,
        isError: true,
      });
      setTimeout(() => revalidator.revalidate(), 1000);
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


  // Check if the current selection matches the products in the preview to enable/disable the Start button
  const pricePreviewProductIds =
    pricePreview?.products?.map((product) => product.id) ?? [];
  const tagPreviewProductIds =
    tagPreview?.products?.map((product) => product.id) ?? [];

  const priceSelectionMatches =
    pricePreviewProductIds.length > 0 &&
    selectedProductIds.length === pricePreviewProductIds.length &&
    selectedProductIds.every((id) => pricePreviewProductIds.includes(id));

  const tagSelectionMatches =
    tagPreviewProductIds.length > 0 &&
    selectedProductIds.length === tagPreviewProductIds.length &&
    selectedProductIds.every((id) => tagPreviewProductIds.includes(id));

  return (
    <Page title="Bulk Product Editor">
      <Layout>
        {/* Operation Banner */}
        {operationToMonitor && (
          <Layout.Section>
            <Banner
              tone={
                pollResult?.status === "COMPLETED"
                  ? "success"
                  : pollResult?.status === "FAILED"
                    ? "critical"
                    : "info"
              }
              title={
                pollResult?.status === "COMPLETED"
                  ? "✅ Bulk operation completed"
                  : pollResult?.status === "FAILED"
                    ? "❌ Bulk operation failed"
                    : "⏳ Bulk operation in progress"
              }
            >
              <BlockStack gap="200">
                <Text>
                  <strong>Status:</strong>{" "}
                  {pollResult?.status || operationToMonitor.status}
                </Text>

                {pollResult?.objectCount !== undefined && (
                  <Text>
                    <strong>Processed:</strong> {pollResult.objectCount} items
                  </Text>
                )}

                {pollResult?.errorCode && (
                  <Text tone="critical">
                    <strong>Error:</strong> {pollResult.errorCode}
                  </Text>
                )}
              </BlockStack>
            </Banner>
          </Layout.Section>
        )}

        {/* Product List */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              {/* Filters */}
              <Form method="get">
                <Grid columns={{ xs: 1, sm: 1, md: 2, lg: 3 }} gap="4">
                  <div>
                    <Select
                      label="Product Status"
                      id="status"
                      name="status"
                      value={statusFilter}
                      options={[
                        { label: "Any", value: "ANY" },
                        { label: "Active", value: "ACTIVE" },
                        { label: "Draft", value: "DRAFT" },
                        { label: "Archived", value: "ARCHIVED" },
                      ]}
                      onChange={(value) =>
                        setStatusFilter(value as ProductStatusFilter)
                      }
                    />
                  </div>

                  <div>
                    <TextField
                      label="Tags (comma-separated)"
                      id="tags"
                      name="tags"
                      value={tagsFilter}
                      onChange={setTagsFilter}
                      placeholder="e.g. sale, summer"
                    />
                  </div>

                  <div style={{ alignSelf: "flex-end" }}>
                    <Button submit variant="primary">
                      Filter
                    </Button>
                  </div>
                </Grid>
              </Form>

              {/* Selection Controls */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "var(--p-space-200)",
                }}
              >
                <InlineStack gap="200">
                  <Button variant="tertiary" size="slim" onClick={selectAll}>
                    Select all
                  </Button>
                  <Button variant="tertiary" size="slim" onClick={deselectAll}>
                    Deselect all
                  </Button>
                  <Text tone="subdued" as="span">
                    {selectedProductIds.length} selected
                  </Text>
                </InlineStack>

                {availableTags.length > 0 && (
                  <InlineStack gap="100" wrap>
                    <Text tone="subdued" variant="bodySm" as="span">
                      Available tags:
                    </Text>
                    {availableTags.slice(0, 5).map((tag) => (
                      <Badge key={tag} size="small">
                        {tag}
                      </Badge>
                    ))}
                    {availableTags.length > 5 && (
                      <Text tone="subdued" variant="bodySm" as="span">
                        +{availableTags.length - 5} more
                      </Text>
                    )}
                  </InlineStack>
                )}
              </div>

              {/* Product List */}
              <BlockStack>
                {products.map((product) => {
                  const selected = selectedProductIds.includes(product.id);
                  return (
                    <div
                      key={product.id}
                      onClick={() => toggleProduct(product.id)}
                      style={{
                        cursor: "pointer",
                        borderBottom: "1px solid var(--p-color-border)",
                        padding: "var(--p-space-200) var(--p-space-400)",
                      }}
                    >
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "auto 1fr auto",
                          gap: "var(--p-space-400)",
                          alignItems: "center",
                        }}
                      >
                        <Checkbox
                          label={`Select ${product.title}`}
                          labelHidden
                          checked={selected}
                          onChange={() => toggleProduct(product.id)}
                        />

                        <BlockStack gap="200">
                          <Text as="strong" fontWeight="bold">
                            {product.title}
                          </Text>
                          <Text tone="subdued" variant="bodySm" as="p">
                            {product.status.toLowerCase()} ·{" "}
                            {product.variants.length} variant
                            {product.variants.length !== 1 ? "s" : ""}
                          </Text>
                          {product.tags.length > 0 && (
                            <InlineStack gap="200" wrap>
                              {product.tags.map((tag) => (
                                <Badge key={tag} size="small">
                                  {tag}
                                </Badge>
                              ))}
                            </InlineStack>
                          )}
                        </BlockStack>

                        <BlockStack gap="200" align="end">
                          {product.variants.map((variant) => (
                            <Text key={variant.id} variant="bodySm" as="p">
                              {variant.title}: ${variant.price.toFixed(2)}
                            </Text>
                          ))}
                        </BlockStack>
                      </div>
                    </div>
                  );
                })}

                {products.length === 0 && (
                  <Box padding="400">
                    <Text tone="subdued" as="p">
                      No products match your filters.
                    </Text>
                  </Box>
                )}
              </BlockStack>

              {/* Pagination */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "var(--p-space-200)",
                }}
              >
                {pageInfo.hasPreviousPage && (
                  <Form method="get">
                    <input type="hidden" name="status" value={filters.status} />
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
                    <Button submit variant="tertiary">
                      Previous
                    </Button>
                  </Form>
                )}
                {pageInfo.hasNextPage && (
                  <Form method="get">
                    <input type="hidden" name="status" value={filters.status} />
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
                    <Button submit variant="tertiary">
                      Next
                    </Button>
                  </Form>
                )}
              </div>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Actions Panel */}
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="400">
              {/* Price Adjustment Section */}
              <Text variant="headingMd" as="h2">
                Price Adjustment
              </Text>

              <previewFetcher.Form method="post">
                <input
                  type="hidden"
                  name="_action"
                  value="preview-price-adjustment"
                />
                {selectedProductIds.map((id) => (
                  <input key={id} type="hidden" name="productIds" value={id} />
                ))}

                <BlockStack gap="400">
                  <Select
                    label="Direction"
                    name="direction"
                    value={direction}
                    options={[
                      { label: "Increase", value: "increase" },
                      { label: "Decrease", value: "decrease" },
                    ]}
                    onChange={(val) =>
                      setDirection(val as "increase" | "decrease")
                    }
                  />

                  <TextField
                    label="Percentage"
                    type="number"
                    name="percentage"
                    value={percentage}
                    onChange={(val) => setPercentage(val)}
                    min={0}
                    max={1000}
                    step={0.1}
                    error={previewErrors?.percentage}
                    autoComplete="off"
                  />

                  <Button
                    submit
                    variant="secondary"
                    loading={isPreviewing}
                    disabled={selectedProductIds.length === 0}
                  >
                    Generate Preview
                  </Button>

                  {previewErrors?.productIds && (
                    <Text tone="critical" as="p">
                      {previewErrors.productIds}
                    </Text>
                  )}
                  {previewErrors?.form && (
                    <Text tone="critical" as="p">
                      {previewErrors.form}
                    </Text>
                  )}
                </BlockStack>
              </previewFetcher.Form>

              {!isPreviewing &&
                pricePreview &&
                pricePreview.products &&
                pricePreview.products.length > 0 && (
                  <BlockStack gap="400">
                    <Divider />
                    <Text variant="headingSm" as="h3">
                      Price Preview
                    </Text>

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
                          {pricePreview.products.map((product) =>
                            product.variants?.map((variant, idx) => (
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
                                  <Badge
                                    tone={
                                      variant.priceAfter > variant.priceBefore
                                        ? "info"
                                        : "warning"
                                    }
                                  >
                                    {`${variant.priceAfter > variant.priceBefore ? "+" : ""}${(((variant.priceAfter - variant.priceBefore) / variant.priceBefore) * 100).toFixed(1)}%`}
                                  </Badge>
                                </td>
                              </tr>
                            )),
                          )}
                        </tbody>
                      </table>
                    </div>

                    <Divider />

                    <startFetcher.Form method="post">
                      <input
                        type="hidden"
                        name="_action"
                        value="start-price-adjustment"
                      />
                      {pricePreview.products.map((product) => (
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

                      <Button
                        submit
                        variant="primary"
                        loading={isStarting}
                        disabled={!priceSelectionMatches || isStarting}
                      >
                        Start Bulk Update
                      </Button>

                      {!priceSelectionMatches && (
                        <Text tone="subdued" variant="bodySm" as="p">
                          Rerun the preview after adjusting your selection.
                        </Text>
                      )}

                      {startErrors?.form && (
                        <Text tone="critical" as="p">
                          {startErrors.form}
                        </Text>
                      )}
                    </startFetcher.Form>
                  </BlockStack>
                )}

              <Divider />

              <Text variant="headingMd" as="h2">
                Tag Update
              </Text>

              <previewFetcher.Form method="post">
                <input
                  type="hidden"
                  name="_action"
                  value="preview-tag-update"
                />
                {selectedProductIds.map((id) => (
                  <input key={id} type="hidden" name="productIds" value={id} />
                ))}

                <BlockStack gap="400">
                  <Select
                    label="Action"
                    name="tagAction"
                    value={tagAction}
                    options={[
                      { label: "Add Tags", value: "add" },
                      { label: "Remove Tags", value: "remove" },
                      { label: "Replace Tags", value: "replace" },
                    ]}
                    onChange={(val) =>
                      setTagAction(val as "add" | "remove" | "replace")
                    }
                  />

                  <TextField
                    label="Tags (comma-separated)"
                    name="tags"
                    value={tagInput}
                    onChange={(val) => setTagInput(val)}
                    placeholder="e.g. summer, sale, new"
                    autoComplete="off"
                    error={previewErrors?.tags}
                  />

                  <Button
                    submit
                    variant="secondary"
                    loading={isPreviewing}
                    disabled={selectedProductIds.length === 0}
                  >
                    Generate Tag Preview
                  </Button>

                  {previewErrors?.productIds && (
                    <Text tone="critical" as="p">
                      {previewErrors.productIds}
                    </Text>
                  )}
                </BlockStack>
              </previewFetcher.Form>

              {!isPreviewing &&
                tagPreview &&
                tagPreview.products &&
                tagPreview.products.length > 0 && (
                  <BlockStack gap="400">
                    <Divider />
                    <Text variant="headingSm" as="h3">
                      Tag Preview
                    </Text>

                    <div style={{ maxHeight: "400px", overflowY: "auto" }}>
                      <table style={{ width: "100%", fontSize: "0.875rem" }}>
                        <thead>
                          <tr style={{ borderBottom: "1px solid #e1e1e1" }}>
                            <th style={{ textAlign: "left", padding: "8px" }}>
                              Product
                            </th>
                            <th style={{ textAlign: "left", padding: "8px" }}>
                              Current Tags
                            </th>
                            <th style={{ textAlign: "left", padding: "8px" }}>
                              New Tags
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {tagPreview.products.map((product) => (
                            <tr
                              key={product.id}
                              style={{ borderBottom: "1px solid #f1f1f1" }}
                            >
                              <td style={{ padding: "8px" }}>
                                <strong>{product.title}</strong>
                              </td>
                              <td style={{ padding: "8px" }}>
                                {product.tagsBefore?.join(", ") || "None"}
                              </td>
                              <td style={{ padding: "8px" }}>
                                <span style={{ color: "#008060" }}>
                                  {product.tagsAfter?.join(", ") || "None"}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <Divider />

                    <startFetcher.Form method="post">
                      <input
                        type="hidden"
                        name="_action"
                        value="start-tag-update"
                      />
                      {tagPreview.products.map((product) => (
                        <input
                          key={product.id}
                          type="hidden"
                          name="productIds"
                          value={product.id}
                        />
                      ))}
                      <input type="hidden" name="tagAction" value={tagAction} />
                      <input type="hidden" name="tags" value={tagInput} />

                      <Button
                        submit
                        variant="primary"
                        loading={isStarting}
                        disabled={!tagSelectionMatches || isStarting}
                      >
                        Start Tag Update
                      </Button>

                      {!tagSelectionMatches && (
                        <Text tone="subdued" variant="bodySm" as="p">
                          Rerun the preview after adjusting your selection.
                        </Text>
                      )}

                      {startErrors?.form && (
                        <Text tone="critical" as="p">
                          {startErrors.form}
                        </Text>
                      )}
                    </startFetcher.Form>
                  </BlockStack>
                )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
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
