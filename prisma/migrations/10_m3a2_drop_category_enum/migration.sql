-- AlterTable: drop category enum column
ALTER TABLE "Product" DROP COLUMN "category";

-- DropEnum
DROP TYPE "Category_old";

-- DropEnum
DROP TYPE "Size";