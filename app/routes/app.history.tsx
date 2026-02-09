/**
 * History Page - Operation History with Undo
 *
 * Displays all past bulk operations with:
 * - Status badges
 * - Results summary
 * - Undo functionality
 * - Filtering and pagination
 */

import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Grid,
  IndexTable,
  InlineGrid,
  Layout,
  Modal,
  Page,
  Select,
  Text,
} from "@shopify/polaris";
import { useCallback, useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigate,
  useNavigation,
  useSubmit,
} from "react-router";
import {
  findOperationsByShop,
  getOperationStats,
  type OperationRecord,
} from "../models/operation.server";
import {
  undoOperation,
  type PriceAdjustmentPayload,
} from "../services/bulk-operations.server";
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
      console.error("Undo failed:", error);
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
    return Response.json({ success: true } satisfies ActionData);
  }

  return Response.json({ error: "Unknown action" } satisfies ActionData, {
    status: 400,
  });
}

export default function History() {
  const { operations, stats, filters, pagination } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();
  const submit = useSubmit();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const [selectedOperation, setSelectedOperation] = useState<string | null>(
    null,
  );

  const [status, setStatus] = useState(filters.status || "");
  const [type, setType] = useState(filters.type || "");

  // Sync state with URL params when they change
  useEffect(() => {
    setStatus(filters.status || "");
  }, [filters.status]);

  useEffect(() => {
    setType(filters.type || "");
  }, [filters.type]);

  const handleStatusChange = useCallback(
    (value: string) => setStatus(value),
    [],
  );
  const handleTypeChange = useCallback((value: string) => setType(value), []);

  const isUndoing =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "undo";

  const [undoModalOpen, setUndoModalOpen] = useState(false);
  const [operationToUndo, setOperationToUndo] = useState<string | null>(null);

  const handleUndoClick = useCallback((operationId: string) => {
    setOperationToUndo(operationId);
    setUndoModalOpen(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setUndoModalOpen(false);
    setOperationToUndo(null);
  }, []);

  const handleConfirmUndo = useCallback(() => {
    if (operationToUndo) {
      setSelectedOperation(operationToUndo);
      const formData = new FormData();
      formData.append("intent", "undo");
      formData.append("operationId", operationToUndo);
      submit(formData, { method: "post" });
      setUndoModalOpen(false);
      setOperationToUndo(null);
    }
  }, [operationToUndo, submit]);

  return (
    <Page title="History">
      <Layout>
        <Layout.Section>
          {actionData?.error && (
            <Banner tone="critical" title="Error">
              <p>{actionData.error}</p>
            </Banner>
          )}
          {/* Stats Cards */}
          <Grid>
            <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
              <Card>
                <BlockStack gap="200">
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <s-icon type="check-circle-filled" />
                    <Text as="h3" variant="headingSm" fontWeight="medium">
                      Total Operations
                    </Text>
                  </div>
                  <Text as="p" variant="bodyMd">
                    {stats.total}
                  </Text>
                </BlockStack>
              </Card>
            </Grid.Cell>
            <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
              <Card>
                <BlockStack gap="200">
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <s-icon type="circle-dashed" />
                    <Text as="h3" variant="headingSm" fontWeight="medium">
                      Running
                    </Text>
                  </div>
                  <Text as="p" variant="bodyMd">
                    {stats.running}
                  </Text>
                </BlockStack>
              </Card>
            </Grid.Cell>
            <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
              <Card>
                <BlockStack gap="200">
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <s-icon type="check-circle" />
                    <Text as="h3" variant="headingSm" fontWeight="medium">
                      Completed
                    </Text>
                  </div>
                  <Text as="p" variant="bodyMd">
                    {stats.completed}
                  </Text>
                </BlockStack>
              </Card>
            </Grid.Cell>
            <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
              <Card>
                <BlockStack gap="200">
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <s-icon type="x-circle" />
                    <Text as="h3" variant="headingSm" fontWeight="medium">
                      Failed
                    </Text>
                  </div>
                  <Text as="p" variant="bodyMd">
                    {stats.failed}
                  </Text>
                </BlockStack>
              </Card>
            </Grid.Cell>
          </Grid>

          <Box paddingBlockStart="400">
            {/* Filters */}
            <Card>
              <Form method="get">
                <InlineGrid columns={3} gap="400" alignItems="end">
                  <Select
                    label="Status"
                    name="status"
                    value={status}
                    options={[
                      { label: "All Statuses", value: "" },
                      { label: "Completed", value: "COMPLETED" },
                      { label: "Running", value: "RUNNING" },
                      { label: "Failed", value: "FAILED" },
                    ]}
                    onChange={handleStatusChange}
                  />
                  <Select
                    label="Type"
                    name="type"
                    value={type}
                    options={[
                      { label: "All Types", value: "" },
                      { label: "Price Adjustment", value: "PRICE_ADJUSTMENT" },
                      { label: "Tag Update", value: "TAG_UPDATE" },
                      { label: "Status Change", value: "STATUS_CHANGE" },
                    ]}
                    onChange={handleTypeChange}
                  />
                  <Button submit variant="primary">
                    Apply Filters
                  </Button>
                </InlineGrid>
              </Form>
            </Card>
          </Box>

          <Box paddingBlockStart="400">
            {/* Operations Table */}
            <Card padding="0">
              <IndexTable
                resourceName={{ singular: "operation", plural: "operations" }}
                itemCount={operations.length}
                selectable={false}
                headings={[
                  { title: "Date" },
                  { title: "Description" },
                  { title: "Status" },
                  { title: "Products" },
                  { title: "Results" },
                  { title: "Actions" },
                ]}
                pagination={{
                  hasNext: pagination.page < pagination.totalPages,
                  hasPrevious: pagination.page > 1,
                  onNext: () => {
                    const params = new URLSearchParams(window.location.search);
                    params.set("page", (pagination.page + 1).toString());
                    navigate(`?${params.toString()}`);
                  },
                  onPrevious: () => {
                    const params = new URLSearchParams(window.location.search);
                    params.set("page", (pagination.page - 1).toString());
                    navigate(`?${params.toString()}`);
                  },
                }}
              >
                {operations.map((operation, index) => (
                  <IndexTable.Row
                    id={operation.id}
                    key={operation.id}
                    position={index}
                  >
                    <IndexTable.Cell>
                      <BlockStack gap="200">
                        <Text as="span" variant="bodyMd" fontWeight="semibold">
                          {formatDate(operation.createdAt)}
                        </Text>
                        {operation.completedAt && (
                          <Text tone="subdued" variant="bodySm" as="span">
                            Completed: {formatDate(operation.completedAt)}
                          </Text>
                        )}
                      </BlockStack>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <BlockStack gap="100">
                        <Text as="span" variant="bodyMd" fontWeight="semibold">
                          {formatOperationType(operation.type)}
                        </Text>
                        <Text tone="subdued" variant="bodySm" as="span">
                          {getOperationDescription(operation)}
                        </Text>
                      </BlockStack>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <StatusBadge
                        status={operation.status}
                        undone={operation.undone}
                      />
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <ProductDetails operation={operation} />
                    </IndexTable.Cell>

                    <IndexTable.Cell>
                      {operation.results ? (
                        <BlockStack gap="050">
                          <Text tone="success" variant="bodySm" as="span">
                            ✓ {operation.results.successful} successful
                          </Text>
                          {operation.results.failed > 0 && (
                            <Text tone="critical" variant="bodySm" as="span">
                              ✗ {operation.results.failed} failed
                            </Text>
                          )}
                        </BlockStack>
                      ) : operation.status === "RUNNING" ? (
                        <Text tone="subdued" variant="bodySm" as="span">
                          In progress...
                        </Text>
                      ) : operation.errorMessage ? (
                        <Text tone="critical" variant="bodySm" as="span">
                          {operation.errorMessage}
                        </Text>
                      ) : (
                        <Text tone="subdued" variant="bodySm" as="span">
                          No results
                        </Text>
                      )}
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {operation.status === "COMPLETED" &&
                        !operation.undone &&
                        operation.inversePayload && (
                          <Button
                            variant="tertiary"
                            size="slim"
                            onClick={() => handleUndoClick(operation.id)}
                            disabled={
                              isUndoing && selectedOperation === operation.id
                            }
                          >
                            {isUndoing && selectedOperation === operation.id
                              ? "Undoing..."
                              : "Undo"}
                          </Button>
                        )}
                      {operation.undone && (
                        <Text tone="subdued" variant="bodySm" as="span">
                          Undone
                        </Text>
                      )}
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            </Card>
          </Box>
        </Layout.Section>
      </Layout>
      <Modal
        open={undoModalOpen}
        onClose={handleCloseModal}
        title="Undo Operation"
        primaryAction={{
          content: "Undo",
          onAction: handleConfirmUndo,
          destructive: true,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: handleCloseModal,
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p">Are you sure you want to undo this operation?</Text>
            <Text as="p">
              This will create a new bulk operation to revert the changes.
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

function StatusBadge({ status, undone }: { status: string; undone?: boolean }) {
  if (undone) {
    return <Badge>Undone</Badge>;
  }

  switch (status) {
    case "COMPLETED":
      return <Badge tone="success">Completed</Badge>;
    case "RUNNING":
      return <Badge tone="info">Running</Badge>;
    case "FAILED":
      return <Badge tone="critical">Failed</Badge>;
    case "CANCELED":
      return <Badge>Canceled</Badge>;
    default:
      return <Badge>{status}</Badge>;
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

function getOperationDescription(operation: OperationRecord): string {
  if (operation.type === "PRICE_ADJUSTMENT") {
    const payload = operation.payload as PriceAdjustmentPayload;
    if (payload?.adjustment) {
      const { direction, percentage } = payload.adjustment;
      return `Price ${direction === "increase" ? "+" : "-"}${percentage}%`;
    }
  } else if (operation.type === "TAG_UPDATE") {
    const payload = operation.payload as any;
    if (payload?.update) {
      const { action, tags } = payload.update;
      return `${action === "add" ? "Add" : action === "remove" ? "Remove" : "Replace"} tags: ${tags.join(", ")}`;
    }
  }
  return "";
}

function ProductDetails({ operation }: { operation: OperationRecord }) {
  const payload = operation.payload as any;
  const products = payload?.products || [];
  const count = products.length;

  if (count === 0)
    return (
      <Text tone="subdued" as="span">
        No products
      </Text>
    );

  const firstProduct = products[0];
  const firstTitle = firstProduct?.title;

  if (firstTitle) {
    return (
      <BlockStack gap="050">
        <Text as="span" variant="bodyMd" fontWeight="semibold" truncate>
          {firstTitle}
        </Text>
        {count > 1 && (
          <Text tone="subdued" variant="bodySm" as="span">
            + {count - 1} other{count > 2 ? "s" : ""}
          </Text>
        )}
      </BlockStack>
    );
  }

  // Fallback for old records without titles
  return (
    <Text as="span">
      {count} product{count !== 1 ? "s" : ""}
    </Text>
  );
}
