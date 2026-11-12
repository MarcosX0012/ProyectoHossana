-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "readAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "notificationEmail" TEXT;

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_idx" ON "notifications"("userId", "readAt");
