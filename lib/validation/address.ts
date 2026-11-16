import { z } from "zod";

export const INDIAN_STATES = [
  "Andaman and Nicobar Islands",
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chandigarh",
  "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jammu and Kashmir",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Ladakh",
  "Lakshadweep",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Puducherry",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
] as const;

export const phoneSchema = z
  .string()
  .transform((val) => {
    let clean = (val || "").replace(/\s+/g, "").replace(/-/g, "");
    if (clean.startsWith("+91")) clean = clean.substring(3);
    else if (clean.startsWith("91") && clean.length === 12) clean = clean.substring(2);
    else if (clean.startsWith("0") && clean.length === 11) clean = clean.substring(1);
    return clean;
  })
  .pipe(z.string().regex(/^\d{10}$/, "Please enter a valid 10-digit Indian mobile number"));

export const addressSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "Full name must be at least 2 characters")
    .max(80, "Full name cannot exceed 80 characters"),
  phone: phoneSchema,
  line1: z
    .string()
    .trim()
    .min(5, "Address line 1 must be at least 5 characters")
    .max(120, "Address line 1 cannot exceed 120 characters"),
  line2: z
    .string()
    .trim()
    .max(120, "Address line 2 cannot exceed 120 characters")
    .optional()
    .nullable()
    .transform((val) => (val && val.length > 0 ? val : null)),
  city: z
    .string()
    .trim()
    .min(2, "City must be at least 2 characters")
    .max(60, "City cannot exceed 60 characters"),
  state: z.enum(INDIAN_STATES, {
    errorMap: () => ({ message: "Please select a valid Indian state or union territory" }),
  }),
  pincode: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Pincode must be exactly 6 digits"),
  label: z.enum(["Home", "Work", "Other"]).default("Home"),
  isDefault: z.boolean().optional().default(false),
});

export type AddressInput = z.infer<typeof addressSchema>;
