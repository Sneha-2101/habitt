-- Backfill Coupon rows into Offer
INSERT INTO "Offer" (
    "id",
    "name",
    "kind",
    "code",
    "active",
    "startsAt",
    "endsAt",
    "minCartPaise",
    "maxUsesTotal",
    "maxUsesPerCustomer",
    "timesUsed",
    "priority",
    "audience",
    "config",
    "legacyCouponId",
    "createdAt",
    "updatedAt"
)
SELECT
    'off_' || c."id",
    'Coupon ' || UPPER(c."code"),
    CASE c."discountType"::text
        WHEN 'PERCENT' THEN 'PERCENT_OFF'::"OfferKind"
        WHEN 'FLAT' THEN 'FLAT_OFF'::"OfferKind"
    END,
    UPPER(c."code"),
    CASE
        WHEN (c."expiresAt" IS NULL OR c."expiresAt" > CURRENT_TIMESTAMP)
         AND (c."usageLimit" IS NULL OR c."timesUsed" < c."usageLimit")
        THEN true
        ELSE false
    END,
    c."createdAt",
    c."expiresAt",
    0,
    c."usageLimit",
    NULL,
    c."timesUsed",
    100,
    CASE
        WHEN UPPER(c."code") LIKE 'WELCOME%' THEN 'FIRST_ORDER'::"OfferAudience"
        WHEN UPPER(c."code") LIKE 'BDAY%' THEN 'BIRTHDAY'::"OfferAudience"
        ELSE 'ALL'::"OfferAudience"
    END,
    CASE c."discountType"::text
        WHEN 'PERCENT' THEN jsonb_build_object('percent', c."value")
        WHEN 'FLAT' THEN jsonb_build_object('amountPaise', c."value")
    END,
    c."id",
    c."createdAt",
    CURRENT_TIMESTAMP
FROM "Coupon" c
ON CONFLICT ("legacyCouponId") DO NOTHING;

-- Backfill OfferRedemption rows from non-cancelled, non-failed orders where coupon was used
INSERT INTO "OfferRedemption" ("id", "offerId", "orderId", "userId", "amountPaise", "createdAt")
SELECT
    'red_' || substr(md5(o."id" || off."id"), 1, 20),
    off."id",
    o."id",
    o."userId",
    COALESCE(o."discountAmount", 0),
    o."createdAt"
FROM "Order" o
JOIN "Offer" off ON UPPER(o."couponCode") = off."code"
WHERE o."couponCode" IS NOT NULL
  AND o."fulfilmentStatus"::text != 'CANCELLED'
  AND o."paymentStatus"::text != 'FAILED'
ON CONFLICT ("offerId", "orderId") DO NOTHING;

-- Guard to verify Coupon and Offer row counts and timesUsed match
DO $$
DECLARE
    coupon_count INTEGER;
    offer_legacy_count INTEGER;
    coupon_usage_sum INTEGER;
    offer_usage_sum INTEGER;
BEGIN
    SELECT count(*), COALESCE(sum("timesUsed"), 0) INTO coupon_count, coupon_usage_sum FROM "Coupon";
    SELECT count(*), COALESCE(sum("timesUsed"), 0) INTO offer_legacy_count, offer_usage_sum FROM "Offer" WHERE "legacyCouponId" IS NOT NULL;

    IF coupon_count <> offer_legacy_count THEN
        RAISE EXCEPTION 'Coupon count (%) does not match backfilled Offer count (%)', coupon_count, offer_legacy_count;
    END IF;

    IF coupon_usage_sum <> offer_usage_sum THEN
        RAISE EXCEPTION 'Coupon timesUsed sum (%) does not match Offer timesUsed sum (%)', coupon_usage_sum, offer_usage_sum;
    END IF;
END $$;
