-- AlterTable
ALTER TABLE "Order" DROP COLUMN "status";

-- AlterTable
ALTER TABLE "OrderStatusEvent" DROP COLUMN "status";

-- DropEnum
DROP TYPE "OrderStatus";
