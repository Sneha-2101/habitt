-- Migration 15: Drop Coupon table and DiscountType enum after verifying backfill to Offer

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Coupon") THEN
    IF EXISTS (
      SELECT 1 FROM "Coupon" c
      LEFT JOIN "Offer" o ON o."legacyCouponId" = c.id
      WHERE o.id IS NULL
    ) THEN
      RAISE EXCEPTION 'Cannot drop table Coupon: one or more coupons have not been migrated to Offer';
    END IF;
  END IF;
END $$;

DROP TABLE IF EXISTS "Coupon";
DROP TYPE IF EXISTS "DiscountType";
