-- Sincroniza el esquema que ya existia en la base de desarrollo (columnas
-- de courier/usuarios y catalogo de productos) y agrega el pago manual por
-- transferencia bancaria con revision administrativa.

-- CreateEnum
CREATE TYPE "PaymentSubmissionStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'BANK_TRANSFER';

-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'PENDING_REVIEW';
ALTER TYPE "PaymentStatus" ADD VALUE 'REJECTED';

-- AlterTable
ALTER TABLE "shipment_events" ADD COLUMN     "idempotencykey" TEXT;

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "amountUsdCents" INTEGER,
ADD COLUMN     "assignedcourierid" UUID,
ADD COLUMN     "exchangeRateNioPerUsd" DECIMAL(10,4),
ADD COLUMN     "paymentCurrency" TEXT NOT NULL DEFAULT 'NIO';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "agencyid" UUID,
ADD COLUMN     "courieravailability" TEXT DEFAULT 'AVAILABLE',
ADD COLUMN     "employeeid" TEXT,
ADD COLUMN     "employeenumber" TEXT,
ADD COLUMN     "hiredate" TIMESTAMP(6),
ADD COLUMN     "isactive" BOOLEAN DEFAULT true,
ADD COLUMN     "phone" TEXT;

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" UUID NOT NULL,
    "currency" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "accountType" TEXT NOT NULL DEFAULT 'CUENTA_CORRIENTE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_submissions" (
    "id" UUID NOT NULL,
    "shipmentId" UUID NOT NULL,
    "bankAccountId" UUID NOT NULL,
    "submittedById" UUID NOT NULL,
    "reviewedById" UUID,
    "status" "PaymentSubmissionStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "currency" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "amountNioCents" INTEGER NOT NULL,
    "exchangeRateNioPerUsd" DECIMAL(10,4),
    "reference" TEXT,
    "senderName" TEXT,
    "note" TEXT,
    "proofPath" TEXT NOT NULL,
    "proofMimeType" TEXT NOT NULL,
    "proofOriginalName" TEXT,
    "proofSizeBytes" INTEGER NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_catalog" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "active" BOOLEAN DEFAULT true,
    "sortorder" INTEGER DEFAULT 0,
    "createdat" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedat" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_catalog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_accounts_currency_isActive_idx" ON "bank_accounts"("currency", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_currency_accountNumber_key" ON "bank_accounts"("currency", "accountNumber");

-- CreateIndex
CREATE INDEX "payment_submissions_shipmentId_createdAt_idx" ON "payment_submissions"("shipmentId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "payment_submissions_status_createdAt_idx" ON "payment_submissions"("status", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "product_catalog_code_key" ON "product_catalog"("code");

-- CreateIndex
CREATE UNIQUE INDEX "users_employeenumber_key" ON "users"("employeenumber");

-- CreateIndex
CREATE UNIQUE INDEX "users_employeeid_key" ON "users"("employeeid");

-- CreateIndex
CREATE INDEX "idx_users_courieravail" ON "users"("courieravailability");

-- CreateIndex
CREATE INDEX "idx_users_employeenumber" ON "users"("employeenumber");

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "fk_shipments_assigned_courier" FOREIGN KEY ("assignedcourierid") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "payment_submissions" ADD CONSTRAINT "payment_submissions_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_submissions" ADD CONSTRAINT "payment_submissions_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_submissions" ADD CONSTRAINT "payment_submissions_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_submissions" ADD CONSTRAINT "payment_submissions_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
