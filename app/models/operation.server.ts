import type { OperationStatus, OperationType, Prisma } from "@prisma/client";

import prisma from "../db.server";

export type OperationRecord = Prisma.OperationGetPayload<{
  select: {
    id: true;
    shop: true;
    type: true;
    status: true;
    payload: true;
    inversePayload: true;
    bulkOperationId: true;
    resultUrl: true;
    errorMessage: true;
    createdAt: true;
    updatedAt: true;
    completedAt: true;
  };
}>;

export type CreateOperationInput = {
  shop: string;
  type: OperationType;
  payload: Prisma.JsonValue;
  inversePayload?: Prisma.JsonValue | null;
  bulkOperationId?: string | null;
};

export type UpdateOperationInput = {
  id: string;
  status?: OperationStatus;
  bulkOperationId?: string | null;
  resultUrl?: string | null;
  errorMessage?: string | null;
  completedAt?: Date | null;
};

export async function createOperation(
  data: CreateOperationInput
): Promise<OperationRecord> {
  return prisma.operation.create({
    data: {
      shop: data.shop,
      type: data.type,
      payload: data.payload,
      inversePayload: data.inversePayload ?? null,
      bulkOperationId: data.bulkOperationId ?? null,
    },
    select: operationSelect,
  });
}

export async function findOperationById(
  id: string
): Promise<OperationRecord | null> {
  return prisma.operation.findUnique({
    where: { id },
    select: operationSelect,
  });
}

export async function findActiveOperationForShop(
  shop: string
): Promise<OperationRecord | null> {
  return prisma.operation.findFirst({
    where: {
      shop,
      status: {
        in: ["CREATED", "RUNNING"],
      },
    },
    orderBy: { createdAt: "desc" },
    select: operationSelect,
  });
}

export async function listOperationsForShop(
  shop: string,
  limit = 20
): Promise<OperationRecord[]> {
  return prisma.operation.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: operationSelect,
  });
}

export async function updateOperation(
  data: UpdateOperationInput
): Promise<OperationRecord> {
  const { id, ...updates } = data;

  return prisma.operation.update({
    where: { id },
    data: {
      ...updates,
    },
    select: operationSelect,
  });
}

export async function updateOperationStatus(
  id: string,
  status: OperationStatus,
  extras?: Omit<UpdateOperationInput, "id" | "status">
): Promise<OperationRecord> {
  return updateOperation({
    id,
    status,
    ...extras,
  });
}

const operationSelect = {
  id: true,
  shop: true,
  type: true,
  status: true,
  payload: true,
  inversePayload: true,
  bulkOperationId: true,
  resultUrl: true,
  errorMessage: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
} satisfies Prisma.OperationSelect;
