import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useFetcher, useLoaderData } from "react-router";

import { startPriceAdjustmentBulkOperation } from "../services/bulk-operations.server";
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
};

type ActionData = {
  preview?: PricePreviewResult;
  operation?: {
    id: string;
    status: string;
  };
  errors?: {
    productIds?: string;
    percentage?: string;
    form?: string;
  };
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
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

  return {
    products: list.products,
    pageInfo: list.pageInfo,
    availableTags: list.availableTags,
    filters: {
      status,
      tagsInput,
    },
  } satisfies LoaderData;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("_action");

  if (intent === "preview-price-adjustment") {
    const productIds = formData
      .getAll("productIds")
      .map(String)
      .filter(Boolean);
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

  if (intent === "start-price-adjustment") {
    const productIds = formData
      .getAll("productIds")
      .map(String)
      .filter(Boolean);
    const direction =
      formData.get("direction") === "decrease" ? "decrease" : "increase";
    const percentageValue = Number(formData.get("percentage"));

    const errors: ActionData["errors"] = {};

    if (productIds.length === 0) {
      errors.productIds =
        "Select at least one product to start the bulk change.";
    }

    if (!Number.isFinite(percentageValue) || percentageValue <= 0) {
      errors.percentage = "Enter a percentage greater than zero.";
    } else if (percentageValue > 1000) {
      errors.percentage = "Percentage is too large.";
    }

    if (errors.productIds || errors.percentage) {
      return Response.json({ errors }, { status: 400 });
    }

    const shop = session?.shop;
    if (!shop) {
      return Response.json(
        { errors: { form: "Unable to determine shop for this session." } },
        { status: 500 },
      );
    }

    try {
      const previewResult = await buildPriceAdjustmentPreview(
        admin,
        productIds,
        {
          direction,
          percentage: percentageValue,
        },
      );

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
        operation: { id: operation.id, status: operation.status },
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to start the bulk operation. Please try again.";
      return Response.json({ errors: { form: message } }, { status: 500 });
    }
  }

  return Response.json(
    {
      errors: {
        form: "Unsupported action.",
      },
    },
    { status: 400 },
  );
};

export default function Index() {
  const { products, pageInfo, filters, availableTags } =
    useLoaderData<typeof loader>();
  const previewFetcher = useFetcher<ActionData>();
  const startFetcher = useFetcher<ActionData>();
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

  const previewProductIds =
    preview?.products.map((product) => product.id) ?? [];
  const selectionMatchesPreview =
    previewProductIds.length > 0 &&
    previewProductIds.length === selectedProductIds.length &&
    previewProductIds.every((id) => selectedProductIds.includes(id));

  const productIdSignature = products.map((product) => product.id).join(",");

  useEffect(() => {
    if (previewFetcher.state !== "idle" || !previewFetcher.data) {
      return;
    }

    if (previewFetcher.data.errors?.form) {
      shopify.toast.show(previewFetcher.data.errors.form, { isError: true });
    } else if (previewFetcher.data.preview) {
      shopify.toast.show("Preview ready");
    }
  }, [previewFetcher.data, previewFetcher.state, shopify]);

  useEffect(() => {
    if (startFetcher.state !== "idle" || !startFetcher.data) {
      return;
    }

    if (startFetcher.data.errors?.form) {
      shopify.toast.show(startFetcher.data.errors.form, { isError: true });
    } else if (startFetcher.data.operation) {
      shopify.toast.show("Bulk operation started");
      setSelectedProductIds([]);
    }
  }, [shopify, startFetcher.data, startFetcher.state]);

  useEffect(() => {
    setSelectedProductIds([]);
  }, [productIdSignature]);

  const allSelected =
    selectedProductIds.length > 0 &&
    selectedProductIds.length === products.length;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedProductIds([]);
    } else {
      setSelectedProductIds(products.map((product) => product.id));
    }
  };

  const toggleProduct = (productId: string) => {
    setSelectedProductIds((current) =>
      current.includes(productId)
        ? current.filter((id) => id !== productId)
        : [...current, productId],
    );
  };

  return (
    <s-page heading="Bulk price adjustment">
      <div slot="primary-action">
        <previewFetcher.Form method="post">
          <input
            type="hidden"
            name="_action"
            value="preview-price-adjustment"
          />
          {selectedProductIds.map((id) => (
            <input key={id} type="hidden" name="productIds" value={id} />
          ))}
          <div
            style={{
              display: "flex",
              gap: "var(--s-space-4)",
              flexWrap: "wrap",
            }}
          >
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span>Direction</span>
              <select
                name="direction"
                value={direction}
                onChange={(event) =>
                  setDirection(
                    event.currentTarget.value === "decrease"
                      ? "decrease"
                      : "increase",
                  )
                }
              >
                <option value="increase">Increase</option>
                <option value="decrease">Decrease</option>
              </select>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span>Percentage</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                name="percentage"
                value={percentage}
                onChange={(event) => setPercentage(event.currentTarget.value)}
                style={{ width: 120 }}
              />
            </label>
            <s-button type="submit" loading={isPreviewing} variant="primary">
              Preview changes
            </s-button>
          </div>
          <input type="hidden" name="direction" value={direction} />
          <input type="hidden" name="percentage" value={percentage} />
          {previewErrors?.productIds && (
            <p style={{ color: "var(--s-color-text-critical)" }}>
              {previewErrors.productIds}
            </p>
          )}
          {previewErrors?.percentage && (
            <p style={{ color: "var(--s-color-text-critical)" }}>
              {previewErrors.percentage}
            </p>
          )}
        </previewFetcher.Form>
      </div>

      <s-layout>
        <s-layout-section>
          <s-card padding="none">
            <s-section padding="none">
              <s-stack gap="small-400">
                <Form method="get" style={{ display: "contents" }}>
                  <s-grid
                    gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))"
                    gap="small-200"
                    alignItems="end"
                    paddingInline="base"
                    paddingBlockStart="base"
                  >
                    <s-select
                      label="Status"
                      name="status"
                      value={filters.status}
                    >
                      <s-option value="ANY">Any</s-option>
                      <s-option value="ACTIVE">Active</s-option>
                      <s-option value="DRAFT">Draft</s-option>
                      <s-option value="ARCHIVED">Archived</s-option>
                    </s-select>
                    <s-text-field
                      label="Tags (comma separated)"
                      name="tags"
                      value={filters.tagsInput}
                      placeholder="summer, sale"
                    ></s-text-field>
                    <s-button type="submit" variant="primary">
                      Apply filters
                    </s-button>
                  </s-grid>
                </Form>
                <s-grid
                  gridTemplateColumns="1fr auto"
                  gap="base"
                  alignItems="center"
                  paddingInline="base"
                >
                  <s-stack direction="inline" gap="small" alignItems="center">
                    <input
                      type="checkbox"
                      aria-label="Select all products"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                    />
                    <s-text tone="neutral">
                      Showing {products.length} product
                      {products.length === 1 ? "" : "s"}
                    </s-text>
                  </s-stack>
                  <s-text tone="neutral">
                    Selected: {selectedProductIds.length}
                  </s-text>
                </s-grid>

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
                          gridTemplateColumns="1fr auto"
                          gap="base"
                          alignItems="center"
                        >
                          <s-stack
                            direction="inline"
                            gap="small"
                            alignItems="center"
                          >
                            <input
                              type="checkbox"
                              aria-label={`Select ${product.title}`}
                              checked={selected}
                              onChange={() => toggleProduct(product.id)}
                              onClick={(event) => event.stopPropagation()}
                            />
                            <s-stack>
                              <strong>{product.title}</strong>
                              <s-text tone="neutral">
                                {product.status.toLowerCase()}
                              </s-text>
                              <s-stack
                                direction="inline"
                                gap="small-200"
                                wrap="wrap"
                              >
                                {product.tags.length > 0 ? (
                                  product.tags.map((tag) => (
                                    <s-clickable-chip key={tag}>
                                      {tag}
                                    </s-clickable-chip>
                                  ))
                                ) : (
                                  <s-text tone="neutral">No tags</s-text>
                                )}
                              </s-stack>
                            </s-stack>
                          </s-stack>
                          <div style={{ textAlign: "right" }}>
                            <s-text tone="neutral">Variants</s-text>
                            <ul
                              style={{
                                margin: 0,
                                paddingInlineStart: "1.2rem",
                                maxWidth: 220,
                                textAlign: "left",
                              }}
                            >
                              {product.variants.map((variant) => (
                                <li key={variant.id}>
                                  {variant.title} · {variant.price.toFixed(2)}{" "}
                                  {variant.currencyCode}
                                </li>
                              ))}
                            </ul>
                          </div>
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

                <s-stack
                  direction="inline"
                  gap="small-200"
                  justifyContent="flex-end"
                  paddingInline="base"
                  paddingBlock="base"
                >
                  {pageInfo.hasPreviousPage && pageInfo.startCursor && (
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
                  {pageInfo.hasNextPage && pageInfo.endCursor && (
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
            {isPreviewing && (
              <div style={{ marginTop: "var(--s-space-4)" }}>
                <s-text tone="neutral">Generating preview…</s-text>
              </div>
            )}

            {!isPreviewing && preview && preview.products.length > 0 && (
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
                <input type="hidden" name="percentage" value={percentage} />
                <s-button
                  type="submit"
                  loading={isStarting}
                  variant="primary"
                  disabled={!selectionMatchesPreview || isStarting}
                >
                  Start bulk update
                </s-button>
                {!selectionMatchesPreview && (
                  <p
                    style={{
                      color: "var(--s-color-text-subdued)",
                      marginTop: "0.5rem",
                    }}
                  >
                    Rerun the preview after adjusting your selection.
                  </p>
                )}
                {startErrors?.form && (
                  <p
                    style={{
                      color: "var(--s-color-text-critical)",
                      marginTop: "0.5rem",
                    }}
                  >
                    {startErrors.form}
                  </p>
                )}
              </startFetcher.Form>
            )}

            {!isPreviewing && preview && preview.products.length === 0 && (
              <div style={{ marginTop: "var(--s-space-4)" }}>
                <s-text tone="neutral">
                  Selected products have no variants with prices to update.
                </s-text>
              </div>
            )}

            {!isPreviewing && !preview && (
              <div style={{ marginTop: "var(--s-space-4)" }}>
                <s-text tone="neutral">
                  Select products and submit a preview to see before/after
                  pricing.
                </s-text>
              </div>
            )}
          </s-card>
        </s-layout-section>
      </s-layout>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

function parseStatus(value: string | null): ProductStatusFilter {
  if (!value) {
    return "ANY";
  }

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
