import { z } from "zod";

function parseOptionalNumber(
  val: unknown,
  opts: { min: number; minExclusive?: boolean; max: number; name: string }
): number | null | undefined {
  if (val === undefined) return undefined;
  if (val === null) return null;
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed === "") return null;
    const num = Number(trimmed);
    if (isNaN(num)) {
      throw new Error(`${opts.name} must be a valid number`);
    }
    val = num;
  }
  if (typeof val === "number") {
    if (isNaN(val)) throw new Error(`${opts.name} must be a valid number`);
    if (opts.minExclusive ? val <= opts.min : val < opts.min) {
      throw new Error(
        opts.minExclusive
          ? `${opts.name} must be greater than ${opts.min}`
          : `${opts.name} must be at least ${opts.min}`
      );
    }
    if (val > opts.max) {
      throw new Error(`${opts.name} cannot exceed ${opts.max}`);
    }
    return val;
  }
  throw new Error(`${opts.name} must be a valid number`);
}

const optionalNumberSchema = (opts: { min: number; minExclusive?: boolean; max: number; name: string }) =>
  z.preprocess(
    (val) => {
      if (val === undefined) return undefined;
      if (val === null) return null;
      if (typeof val === "string" && val.trim() === "") return null;
      return val;
    },
    z
      .union([z.number(), z.string(), z.null(), z.undefined()])
      .transform((val) => parseOptionalNumber(val, opts))
  );

const optionalTrimmedString = (maxLen?: number, fieldName?: string) =>
  z.preprocess(
    (val) => {
      if (val === undefined) return undefined;
      if (val === null) return null;
      if (typeof val === "string") {
        const trimmed = val.trim();
        return trimmed === "" ? null : trimmed;
      }
      return val;
    },
    z
      .string()
      .nullable()
      .optional()
      .refine(
        (val) => val === null || val === undefined || maxLen === undefined || val.length <= maxLen,
        {
          message: `${fieldName ?? "Field"} must not exceed ${maxLen} characters`,
        }
      )
  );

const hsnSchema = z.preprocess(
  (val) => {
    if (val === undefined) return undefined;
    if (val === null) return null;
    if (typeof val === "string") {
      const trimmed = val.trim();
      return trimmed === "" ? null : trimmed;
    }
    return val;
  },
  z
    .string()
    .nullable()
    .optional()
    .refine((val) => val === null || val === undefined || /^(\d{4}|\d{6}|\d{8})$/.test(val), {
      message: "HSN code must be 4, 6, or 8 digits",
    })
);

const sizeChartUrlSchema = z.preprocess(
  (val) => {
    if (val === undefined) return undefined;
    if (val === null) return null;
    if (typeof val === "string") {
      const trimmed = val.trim();
      return trimmed === "" ? null : trimmed;
    }
    return val;
  },
  z
    .string()
    .nullable()
    .optional()
    .refine(
      (val) => {
        if (val === null || val === undefined) return true;
        if (val.length > 500) return false;
        if (/\s/.test(val)) return false;
        if (val.startsWith("https://")) return true;
        if (val.startsWith("/") && !val.startsWith("//")) return true;
        return false;
      },
      {
        message: "Size chart URL must start with https:// or a single '/', have no spaces, and not exceed 500 characters",
      }
    )
);

export const productMerchandiseFields = {
  compareAtRupees: optionalNumberSchema({
    min: 0,
    minExclusive: true,
    max: 10_000_000,
    name: "Compare-at price",
  }),
  costRupees: optionalNumberSchema({
    min: 0,
    minExclusive: false,
    max: 10_000_000,
    name: "Cost price",
  }),
  hsn: hsnSchema,
  fabric: optionalTrimmedString(120, "Fabric"),
  fit: optionalTrimmedString(120, "Fit"),
  care: optionalTrimmedString(1000, "Care instructions"),
  sizeChartUrl: sizeChartUrlSchema,
  seoTitle: optionalTrimmedString(70, "SEO title"),
  seoDescription: optionalTrimmedString(160, "SEO description"),
};

export const productFieldsSchema = z
  .object({
    price: z.union([z.number(), z.string(), z.null(), z.undefined()]).optional(),
    priceRupees: z.union([z.number(), z.string(), z.null(), z.undefined()]).optional(),
    ...productMerchandiseFields,
  })
  .superRefine((data, ctx) => {
    const rawPrice = data.priceRupees ?? data.price;
    let priceNum: number | null = null;
    if (typeof rawPrice === "number" && !isNaN(rawPrice)) {
      priceNum = rawPrice;
    } else if (typeof rawPrice === "string" && rawPrice.trim() !== "") {
      const parsed = Number(rawPrice.trim());
      if (!isNaN(parsed)) priceNum = parsed;
    }

    if (
      data.compareAtRupees !== null &&
      data.compareAtRupees !== undefined &&
      priceNum !== null &&
      data.compareAtRupees <= priceNum
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["compareAtRupees"],
        message: "Compare-at price must be greater than price",
      });
    }
  });

export type ProductFieldsInput = z.infer<typeof productFieldsSchema>;

export interface ProductFieldData {
  compareAtPrice?: number | null;
  costPrice?: number | null;
  hsn?: string | null;
  fabric?: string | null;
  fit?: string | null;
  care?: string | null;
  sizeChartUrl?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
}

export function toProductFieldData(
  values: {
    compareAtRupees?: number | null;
    costRupees?: number | null;
    hsn?: string | null;
    fabric?: string | null;
    fit?: string | null;
    care?: string | null;
    sizeChartUrl?: string | null;
    seoTitle?: string | null;
    seoDescription?: string | null;
  },
  options?: { includeCost?: boolean }
): ProductFieldData {
  const data: ProductFieldData = {};

  if (values.compareAtRupees !== undefined) {
    data.compareAtPrice =
      values.compareAtRupees !== null ? Math.round(values.compareAtRupees * 100) : null;
  }
  if (values.hsn !== undefined) {
    data.hsn = values.hsn?.trim() || null;
  }
  if (values.fabric !== undefined) {
    data.fabric = values.fabric?.trim() || null;
  }
  if (values.fit !== undefined) {
    data.fit = values.fit?.trim() || null;
  }
  if (values.care !== undefined) {
    data.care = values.care?.trim() || null;
  }
  if (values.sizeChartUrl !== undefined) {
    data.sizeChartUrl = values.sizeChartUrl?.trim() || null;
  }
  if (values.seoTitle !== undefined) {
    data.seoTitle = values.seoTitle?.trim() || null;
  }
  if (values.seoDescription !== undefined) {
    data.seoDescription = values.seoDescription?.trim() || null;
  }

  if (options?.includeCost !== false && values.costRupees !== undefined) {
    data.costPrice =
      values.costRupees !== null ? Math.round(values.costRupees * 100) : null;
  }

  return data;
}

export function validateCompareAtAgainstPrice(
  pricePaise: number,
  compareAtPaise: number | null | undefined
): boolean {
  if (compareAtPaise === null || compareAtPaise === undefined) return true;
  return compareAtPaise > pricePaise;
}
