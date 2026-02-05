import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useFetcher, useLoaderData } from "react-router";

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
  const { admin } = await authenticate.admin(request);
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
  const fetcher = useFetcher<ActionData>();
  const shopify = useAppBridge();

  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [direction, setDirection] = useState<"increase" | "decrease">(
    "increase",
  );
  const [percentage, setPercentage] = useState("10");

  const isPreviewing =
    fetcher.state === "submitting" &&
    fetcher.formData?.get("_action") === "preview-price-adjustment";

  const preview = fetcher.data?.preview;
  const actionErrors = fetcher.data?.errors;

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) {
      return;
    }

    if (fetcher.data.errors?.form) {
      shopify.toast.show(fetcher.data.errors.form, { isError: true });
    } else if (fetcher.data.preview) {
      shopify.toast.show("Preview ready");
    }
  }, [fetcher.data, fetcher.state, shopify]);

  useEffect(() => {
    setSelectedProductIds([]);
  }, [products.map((product) => product.id).join(",")]);

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
        <fetcher.Form method="post" replace>
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
          {actionErrors?.productIds && (
            <p style={{ color: "var(--s-color-text-critical)" }}>
              {actionErrors.productIds}
            </p>
          )}
          {actionErrors?.percentage && (
            <p style={{ color: "var(--s-color-text-critical)" }}>
              {actionErrors.percentage}
            </p>
          )}
        </fetcher.Form>
      </div>

      <s-layout>
        <s-layout-section>
          <s-card>
            <Form
              method="get"
              style={{
                display: "flex",
                gap: "var(--s-space-4)",
                flexWrap: "wrap",
              }}
            >
              <label
                style={{ display: "flex", flexDirection: "column", gap: 4 }}
              >
                <span>Status</span>
                <select name="status" defaultValue={filters.status}>
                  <option value="ANY">Any</option>
                  <option value="ACTIVE">Active</option>
                  <option value="DRAFT">Draft</option>
                  <option value="ARCHIVED">Archived</option>
                </select>
              </label>

              <label
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  minWidth: 240,
                }}
              >
                <span>Tags (comma-separated)</span>
                <input
                  type="text"
                  name="tags"
                  defaultValue={filters.tagsInput}
                  placeholder="summer, sale"
                />
              </label>

              <div style={{ alignSelf: "flex-end" }}>
                <s-button type="submit" variant="primary">
                  Apply filters
                </s-button>
              </div>
            </Form>

            {availableTags.length > 0 && (
              <s-box style={{ marginTop: "var(--s-space-4)" }}>
                <s-text tone="neutral">
                  Suggested tags: {availableTags.slice(0, 10).join(", ")}
                  {availableTags.length > 10 ? " …" : ""}
                </s-text>
              </s-box>
            )}

            <div style={{ marginTop: "var(--s-space-5)", overflowX: "auto" }}>
              <table className="product-table">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>
                      <input
                        type="checkbox"
                        aria-label="Select all products"
                        checked={allSelected}
                        onChange={toggleSelectAll}
                      />
                    </th>
                    <th>Product</th>
                    <th>Status</th>
                    <th>Tags</th>
                    <th>Variants (price)</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((product: ProductListItem) => {
                    const selected = selectedProductIds.includes(product.id);

                    return (
                      <tr key={product.id}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Select ${product.title}`}
                            checked={selected}
                            onChange={() => toggleProduct(product.id)}
                          />
                        </td>
                        <td>
                          <strong>{product.title}</strong>
                        </td>
                        <td>{product.status.toLowerCase()}</td>
                        <td>
                          {product.tags.length ? product.tags.join(", ") : "—"}
                        </td>
                        <td>
                          <ul
                            style={{ margin: 0, paddingInlineStart: "1.2rem" }}
                          >
                            {product.variants.map((variant) => (
                              <li key={variant.id}>
                                {variant.title} · {variant.price.toFixed(2)}{" "}
                                {variant.currencyCode}
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    );
                  })}
                  {products.length === 0 && (
                    <tr>
                      <td colSpan={5}>
                        <s-text tone="neutral">
                          No products match your filters.
                        </s-text>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginTop: "var(--s-space-5)",
                flexWrap: "wrap",
                gap: "var(--s-space-4)",
              }}
            >
              <div>
                <s-text tone="neutral">
                  Selected products: {selectedProductIds.length}
                </s-text>
              </div>
              <div style={{ display: "flex", gap: "var(--s-space-3)" }}>
                {pageInfo.hasPreviousPage && pageInfo.startCursor && (
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
                      value={pageInfo.startCursor}
                    />
                    <input type="hidden" name="direction" value="backward" />
                    <s-button type="submit" variant="tertiary">
                      Previous
                    </s-button>
                  </Form>
                )}
                {pageInfo.hasNextPage && pageInfo.endCursor && (
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
                      value={pageInfo.endCursor}
                    />
                    <input type="hidden" name="direction" value="forward" />
                    <s-button type="submit" variant="tertiary">
                      Next
                    </s-button>
                  </Form>
                )}
              </div>
            </div>
          </s-card>
        </s-layout-section>

        <s-layout-section variant="oneThird">
          <s-card>
            <s-heading level={2}>Preview</s-heading>
            {isPreviewing && (
              <s-box style={{ marginTop: "var(--s-space-4)" }}>
                <s-text tone="neutral">Generating preview…</s-text>
              </s-box>
            )}

            {!isPreviewing && preview && preview.products.length > 0 && (
              <div
                style={{
                  marginTop: "var(--s-space-4)",
                  display: "grid",
                  gap: "var(--s-space-4)",
                }}
              >
                {preview.products.map((product) => (
                  <s-box
                    key={product.id}
                    padding="base"
                    borderWidth="base"
                    borderRadius="base"
                    background="subdued"
                  >
                    <strong>{product.title}</strong>
                    <ul
                      style={{
                        marginTop: "var(--s-space-3)",
                        paddingInlineStart: "1.2rem",
                      }}
                    >
                      {product.variants.map((variant) => (
                        <li key={variant.id}>
                          {variant.title}: {variant.priceBefore.toFixed(2)} →{" "}
                          <strong>{variant.priceAfter.toFixed(2)}</strong>{" "}
                          {variant.currencyCode}
                        </li>
                      ))}
                    </ul>
                  </s-box>
                ))}
              </div>
            )}

            {!isPreviewing && preview && preview.products.length === 0 && (
              <s-box style={{ marginTop: "var(--s-space-4)" }}>
                <s-text tone="neutral">
                  Selected products have no variants with prices to update.
                </s-text>
              </s-box>
            )}

            {!isPreviewing && !preview && (
              <s-box style={{ marginTop: "var(--s-space-4)" }}>
                <s-text tone="neutral">
                  Select products and submit a preview to see before/after
                  pricing.
                </s-text>
              </s-box>
            )}

            {actionErrors?.form && (
              <s-box style={{ marginTop: "var(--s-space-4)" }}>
                <s-text tone="critical">{actionErrors.form}</s-text>
              </s-box>
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
