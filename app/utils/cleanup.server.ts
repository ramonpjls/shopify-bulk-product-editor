import { PrismaClient, OperationStatus } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Cleanup stuck bulk operations
 * - Marks operations stuck in RUNNING/CREATED >1 hour as EXPIRED
 * - Deletes operations older than 30 days that are completed/failed/expired/cancelled
 */
export async function cleanupStuckOperations() {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  console.log("🧹 Starting cleanup of stuck operations...");

  // 1. Show current state
  const beforeStats = await prisma.operation.groupBy({
    by: ['status'],
    _count: { status: true }
  });
  console.log("Before cleanup:", beforeStats);

  // 2. Mark stuck operations as EXPIRED
  const expiredOps = await prisma.operation.updateMany({
    where: {
      status: { in: [OperationStatus.RUNNING, OperationStatus.CREATED] },
      createdAt: { lt: oneHourAgo }
    },
    data: {
      status: OperationStatus.EXPIRED,
      completedAt: new Date(),
      errorMessage: 'Auto-expired: bulk operation not found in Shopify or timed out (>1 hour)'
    }
  });
  console.log(`⏰ Marked ${expiredOps.count} stuck operations as EXPIRED`);

  // 3. Delete very old operations
  const deletedOps = await prisma.operation.deleteMany({
    where: {
      createdAt: { lt: thirtyDaysAgo },
      status: { in: [OperationStatus.COMPLETED, OperationStatus.FAILED, OperationStatus.EXPIRED, OperationStatus.CANCELLED] }
    }
  });
  console.log(`🗑️ Deleted ${deletedOps.count} old operations`);

  // 4. Show final state
  const afterStats = await prisma.operation.groupBy({
    by: ['status'],
    _count: { status: true }
  });
  console.log("After cleanup:", afterStats);

  // 5. Show recent active operations
  const recentOps = await prisma.operation.findMany({
    where: {
      status: { in: [OperationStatus.RUNNING, OperationStatus.CREATED, OperationStatus.COMPLETED] },
      createdAt: { gt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    },
    select: {
      id: true,
      status: true,
      bulkOperationId: true,
      createdAt: true,
      errorMessage: true
    },
    orderBy: { createdAt: 'desc' },
    take: 10
  });
  console.log("Recent operations:", recentOps);

  return {
    expiredCount: expiredOps.count,
    deletedCount: deletedOps.count,
    beforeStats,
    afterStats,
    recentOps
  };
}

// Run if called directly
if (require.main === module) {
  cleanupStuckOperations()
    .then(() => console.log("✅ Cleanup completed"))
    .catch(console.error)
    .finally(() => prisma.$disconnect());
}
