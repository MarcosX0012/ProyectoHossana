-- Retira la pasarela Stripe y las columnas legadas que ya no usa la API.
-- Los envios ONLINE existentes se normalizan a cobro contra entrega antes
-- de eliminar el valor del enum.

UPDATE "shipments" SET "paymentMethod" = 'ON_DELIVERY' WHERE "paymentMethod" = 'ONLINE';

ALTER TYPE "PaymentMethod" RENAME TO "PaymentMethod_old";
CREATE TYPE "PaymentMethod" AS ENUM ('ON_DELIVERY', 'BANK_TRANSFER');
ALTER TABLE "shipments" ALTER COLUMN "paymentMethod" DROP DEFAULT;
ALTER TABLE "shipments"
  ALTER COLUMN "paymentMethod" TYPE "PaymentMethod"
  USING ("paymentMethod"::text::"PaymentMethod");
ALTER TABLE "shipments" ALTER COLUMN "paymentMethod" SET DEFAULT 'ON_DELIVERY';
DROP TYPE "PaymentMethod_old";

ALTER TABLE "shipments" DROP COLUMN IF EXISTS "stripePaymentIntentId";
ALTER TABLE "shipment_events" DROP COLUMN IF EXISTS "idempotencykey";
