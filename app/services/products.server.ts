export type AdminApiClient = {
  graphql(
    query: string,
    options?: {
      variables?: Record<string, unknown>;
    }
  ): Promise<Response>;
};

export type ProductStatusFilter =
  | "ANY"
  | "ACTIVE"
  | "DRAFT"
  | "ARCHIVED";

export type ProductListOptions = {
  status?: ProductStatusFilter;
  tags?: string[];
  cursor?: string | null;
  direction?: "forward" | "backward";
  pageSize?: number;
};

export type ProductListItem = {
  id: string;
  title: string;
  status: string;
  tags: string[];
  cursor: string;
  variants: Array<{
    id: string;
    title: string;
    price: number;
    currencyCode: string;
  }>;
};

export type ProductListResult = {
  products: ProductListItem[];
  pageInfo: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    startCursor: string | null;
    endCursor: string | null;
  };
  availableTags: string[];
};

export type PriceAdjustment = {
  direction: "increase" | "decrease";
  percentage: number;
};

export type PricePreviewVariant = {
  id: string;
  title: string;
  priceBefore: number;
  priceAfter: number;
  currencyCode: string;
};

export type PricePreviewProduct = {
  id: string;
  title: string;
  status: string;
  tags: string[];
  variants: PricePreviewVariant[];
};

export type PricePreviewResult = {
  products: PricePreviewProduct[];
  adjustment: PriceAdjustment;
};

type ProductsQueryResponse = {
  shop?: {
    currencyCode?: string;
  };
  products: {
    edges: Array<{
      cursor: string;
      node: {
        id: string;
        title: string;
        status: string;
        tags: string[];
        variants: {
          nodes: Array<{
            id: string;
            title: string;
            price?: string;
          }>;
        };
      };
    }>;
    pageInfo: {
      hasNextPage: boolean;
      hasPreviousPage: boolean;
      startCursor: string | null;
      endCursor: string | null;
    };
  };
};

type ProductsByIdResponse = {
  shop?: {
    currencyCode?: string;
  };
  nodes: Array<
    | null
    | {
        __typename: string;
        id: string;
        title: string;
        status: string;
        tags: string[];
        variants?: {
          nodes: Array<{
            id: string;
            title: string;
            price?: string;
          }>;
        };
      }
  >;
};

export async function fetchProductList(
  admin: AdminApiClient,
  options: ProductListOptions = {}
): Promise<ProductListResult> {
  const pageSize = options.pageSize ?? 25;
  const queryFilters = buildProductQueryFilter(options.status, options.tags);

  const variables: Record<string, unknown> = {
    query: queryFilters ?? undefined,
    first: options.direction === "backward" ? undefined : pageSize,
    last: options.direction === "backward" ? pageSize : undefined,
    after: options.direction === "backward" ? undefined : options.cursor ?? undefined,
    before: options.direction === "backward" ? options.cursor ?? undefined : undefined,
  };

  const response = await admin.graphql(PRODUCTS_QUERY, {
    variables,
  });

  const json = (await response.json()) as GraphQLResponse<ProductsQueryResponse>;

  if (json.errors?.length) {
    throw new Error(json.errors.map((error) => error.message).join("\n"));
  }

  const currencyCode = json.data?.shop?.currencyCode ?? "";
  const products = json.data?.products.edges ?? [];
  const tagAccumulator = new Set<string>();

  const mappedProducts: ProductListItem[] = products.map(({ cursor, node }) => {
    node.tags.forEach((tag) => tagAccumulator.add(tag));

    return {
      id: node.id,
      title: node.title,
      status: node.status,
      tags: node.tags,
      cursor,
      variants: node.variants.nodes.map((variant) => ({
        id: variant.id,
        title: variant.title,
        price: parseCurrencyAmount(variant.price),
        currencyCode,
      })),
    };
  });

  return {
    products: mappedProducts,
    pageInfo: json.data?.products.pageInfo ?? {
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: null,
      endCursor: null,
    },
    availableTags: Array.from(tagAccumulator).sort((a, b) => a.localeCompare(b)),
  };
}

export async function buildPriceAdjustmentPreview(
  admin: AdminApiClient,
  productIds: string[],
  adjustment: PriceAdjustment
): Promise<PricePreviewResult> {
  if (!productIds.length) {
    return {
      products: [],
      adjustment,
    };
  }

  const response = await admin.graphql(PRODUCTS_BY_ID_QUERY, {
    variables: { ids: productIds },
  });

  const json = (await response.json()) as GraphQLResponse<ProductsByIdResponse>;

  if (json.errors?.length) {
    throw new Error(json.errors.map((error) => error.message).join("\n"));
  }

  const multiplier = calculateMultiplier(adjustment);
  const currencyCode = json.data?.shop?.currencyCode ?? "";

  const products = (json.data?.nodes ?? [])
    .filter((node): node is NonNullable<ProductsByIdResponse["nodes"][number]> => {
      return Boolean(node && node.__typename === "Product");
    })
    .map((node) => ({
      id: node.id,
      title: node.title,
      status: node.status,
      tags: node.tags,
      variants: (node.variants?.nodes ?? [])
        .map((variant) => {
          const priceBefore = parseCurrencyAmount(variant.price);

          if (Number.isNaN(priceBefore)) {
            return null;
          }

          const priceAfter = clampPrice(priceBefore * multiplier);

          return {
            id: variant.id,
            title: variant.title,
            priceBefore,
            priceAfter,
            currencyCode,
          } satisfies PricePreviewVariant;
        })
        .filter(Boolean) as PricePreviewVariant[],
    }))
    .filter((product) => product.variants.length > 0);

  return {
    products,
    adjustment,
  };
}

function calculateMultiplier(adjustment: PriceAdjustment): number {
  const percentageDelta = adjustment.percentage / 100;
  const base = adjustment.direction === "increase" ? 1 + percentageDelta : 1 - percentageDelta;

  return base < 0 ? 0 : base;
}

function clampPrice(amount: number): number {
  return Number(Math.max(amount, 0).toFixed(2));
}

function buildProductQueryFilter(
  status: ProductListOptions["status"],
  tags: string[] | undefined
): string | null {
  const filters: string[] = [];

  if (status && status !== "ANY") {
    filters.push(`status:${status.toLowerCase()}`);
  }

  if (tags?.length) {
    for (const tag of tags) {
      if (tag.trim()) {
        filters.push(`tag:'${escapeTag(tag.trim())}'`);
      }
    }
  }

  if (!filters.length) {
    return null;
  }

  return filters.join(" AND ");
}

function escapeTag(tag: string): string {
  return tag.replace(/'/g, "\\'");
}

function parseCurrencyAmount(amount?: string): number {
  if (!amount) {
    return 0;
  }

  const parsed = parseFloat(amount);
  return Number.isNaN(parsed) ? 0 : parsed;
}

type GraphQLResponse<T> = {
  data?: T;
  errors?: Array<{
    message: string;
  }>;
};

const PRODUCTS_QUERY = `#graphql
  query ProductListing(
    $query: String
    $first: Int
    $last: Int
    $after: String
    $before: String
  ) {
    shop {
      currencyCode
    }
    products(query: $query, first: $first, last: $last, after: $after, before: $before) {
      edges {
        cursor
        node {
          id
          title
          status
          tags
          variants(first: 25) {
            nodes {
              id
              title
              price
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
    }
  }
`;

const PRODUCTS_BY_ID_QUERY = `#graphql
  query ProductsById($ids: [ID!]!) {
    shop {
      currencyCode
    }
    nodes(ids: $ids) {
      __typename
      ... on Product {
        id
        title
        status
        tags
        variants(first: 50) {
          nodes {
            id
            title
            price
          }
        }
      }
    }
  }
`;
