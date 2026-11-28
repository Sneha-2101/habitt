import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { DEFAULT_SITE_SETTINGS } from "@/lib/settings";

describe("DEFAULT_SITE_SETTINGS schema drift guard", () => {
  it("contains every SiteSettings scalar field and no extra fields", () => {
    const schemaFields: string[] = Object.values(Prisma.SiteSettingsScalarFieldEnum).sort();
    const defaultKeys: string[] = Object.keys(DEFAULT_SITE_SETTINGS).sort();

    const missing = schemaFields.filter((f) => !defaultKeys.includes(f));
    const extra = defaultKeys.filter((k) => !schemaFields.includes(k));

    expect(missing, `Missing SiteSettings fields in DEFAULT_SITE_SETTINGS: ${missing.join(", ")}`).toEqual([]);
    expect(extra, `Extra fields in DEFAULT_SITE_SETTINGS: ${extra.join(", ")}`).toEqual([]);
  });
});
