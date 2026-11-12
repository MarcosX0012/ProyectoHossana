-- CreateEnum
CREATE TYPE "WeightUnit" AS ENUM ('KG', 'LB');

-- CreateEnum
CREATE TYPE "RouteType" AS ENUM ('LOCAL', 'SHORT', 'MEDIUM', 'LONG');

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "baseAmountCents" INTEGER,
ADD COLUMN     "deliveryCents" INTEGER,
ADD COLUMN     "destDepartmentId" TEXT,
ADD COLUMN     "extraLbsCharged" DECIMAL(5,2),
ADD COLUMN     "extraPerLbCents" INTEGER,
ADD COLUMN     "lbsChargedMin" DECIMAL(5,2),
ADD COLUMN     "originDepartmentId" TEXT,
ADD COLUMN     "routeType" "RouteType",
ADD COLUMN     "shippingRateId" TEXT,
ADD COLUMN     "weightLbs" DECIMAL(5,2),
ADD COLUMN     "weightUnit" "WeightUnit" DEFAULT 'LB',
ADD COLUMN     "weightUsedForCalc" DECIMAL(5,2);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL DEFAULT 'NI',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingRate" (
    "id" TEXT NOT NULL,
    "originDepartmentId" TEXT NOT NULL,
    "destDepartmentId" TEXT NOT NULL,
    "routeType" "RouteType" NOT NULL,
    "baseAmountCents" INTEGER NOT NULL,
    "includedLbs" DECIMAL(4,2) NOT NULL DEFAULT 2.00,
    "extraPerLbCents" INTEGER NOT NULL,
    "deliveryCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'NIO',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailVerificationOtp" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "otpHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailVerificationOtp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Department_code_key" ON "Department"("code");

-- CreateIndex
CREATE INDEX "ShippingRate_originDepartmentId_destDepartmentId_isActive_idx" ON "ShippingRate"("originDepartmentId", "destDepartmentId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ShippingRate_originDepartmentId_destDepartmentId_key" ON "ShippingRate"("originDepartmentId", "destDepartmentId");

-- CreateIndex
CREATE INDEX "EmailVerificationOtp_email_idx" ON "EmailVerificationOtp"("email");

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_originDepartmentId_fkey" FOREIGN KEY ("originDepartmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_destDepartmentId_fkey" FOREIGN KEY ("destDepartmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_shippingRateId_fkey" FOREIGN KEY ("shippingRateId") REFERENCES "ShippingRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingRate" ADD CONSTRAINT "ShippingRate_originDepartmentId_fkey" FOREIGN KEY ("originDepartmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingRate" ADD CONSTRAINT "ShippingRate_destDepartmentId_fkey" FOREIGN KEY ("destDepartmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
