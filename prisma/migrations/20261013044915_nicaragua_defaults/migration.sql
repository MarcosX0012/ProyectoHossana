-- AlterTable
ALTER TABLE "addresses" ALTER COLUMN "countryCode" SET DEFAULT 'NI';

-- AlterTable
ALTER TABLE "branches" ALTER COLUMN "countryCode" SET DEFAULT 'NI';

-- AlterTable
ALTER TABLE "shipments" ALTER COLUMN "currency" SET DEFAULT 'NIO';
