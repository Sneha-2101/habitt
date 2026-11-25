import { describe, it, expect } from "vitest";
import { sanitizeCsvCell } from "@/lib/csv";
import {
  parseProductsCsv,
  STANDARD_HEADERS,
  OWNER_HEADERS,
  MAX_CSV_SIZE_BYTES,
} from "@/lib/admin/csv-products";

describe("csv-products unit tests", () => {
  it("rejects CSV with missing required headers", () => {
    const invalidCsv = "productSlug,name,category\nslug-1,Test,Shirts";
    expect(() => parseProductsCsv(invalidCsv)).toThrow("Invalid CSV headers");
  });

  it("tolerates UTF-8 BOM prefix", () => {
    const validHeader = STANDARD_HEADERS.join(",");
    const bomCsv = "\uFEFF" + validHeader + "\ntee,Tee,Tops,999,,ACTIVE,,61091000,Cotton,Regular,Black,M,SKU-1,10";
    const res = parseProductsCsv(bomCsv);
    expect(res.errors).toEqual([]);
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].productSlug).toBe("tee");
  });

  it("enforces max row limits", () => {
    const validHeader = STANDARD_HEADERS.join(",");
    const rows = Array.from({ length: 5001 }, (_, i) => `tee-${i},Tee,Tops,999,,ACTIVE,,61091000,Cotton,Regular,Black,M,SKU-${i},10`);
    const massiveCsv = validHeader + "\n" + rows.join("\n");
    expect(() => parseProductsCsv(massiveCsv)).toThrow("CSV file exceeds maximum of 5000 data rows");
  });

  it("enforces max file size limit (2MB)", () => {
    const validHeader = STANDARD_HEADERS.join(",");
    const padding = "A".repeat(MAX_CSV_SIZE_BYTES + 10);
    const oversizedCsv = validHeader + "\n" + padding;
    expect(() => parseProductsCsv(oversizedCsv)).toThrow("CSV file exceeds maximum size of 2 MB");
  });

  it("handles sanitized formula injection single quotes on import", () => {
    const validHeader = STANDARD_HEADERS.join(",");
    // Cell exported with formula protection has leading single quote: '=formula
    const injectionRow = `${validHeader}\ntee,'=cmdFormula,Tops,999,,ACTIVE,,61091000,Cotton,Regular,Black,M,SKU-INJ,10`;
    const res = parseProductsCsv(injectionRow);
    expect(res.errors).toEqual([]);
    expect(res.rows[0].name).toBe("=cmdFormula");
  });

  it("restricts costPrice column parsing to OWNER role", () => {
    const ownerCsv = `${OWNER_HEADERS.join(",")}\ntee,Tee,Tops,999,,ACTIVE,,61091000,Cotton,Regular,Black,M,SKU-1,10,450`;

    // STAFF parsing owner CSV
    const staffRes = parseProductsCsv(ownerCsv, "STAFF");
    expect(staffRes.rows[0].costPrice).toBeNull();

    // OWNER parsing owner CSV
    const ownerRes = parseProductsCsv(ownerCsv, "OWNER");
    expect(ownerRes.rows[0].costPrice).toBe(450);
  });

  it("preserves real apostrophes (Men's Shirt, name ending in ', size 5')", () => {
    const validHeader = STANDARD_HEADERS.map(sanitizeCsvCell).join(",");
    const row = [
      "mens-shirt",
      "Men's Shirt'",
      "Tops",
      "999.00",
      "",
      "ACTIVE",
      "",
      "61091000",
      "Cotton",
      "Regular",
      "Navy",
      "5'",
      "SKU-MENS-5",
      "12",
    ].map(sanitizeCsvCell).join(",");

    const res = parseProductsCsv(`${validHeader}\n${row}`);
    expect(res.errors).toEqual([]);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].name).toBe("Men's Shirt'");
    expect(res.rows[0].size).toBe("5'");
  });

  it("handles quoted commas, escaped quotes, embedded newlines, CRLF, trailing newline, blank lines, and unterminated quotes", () => {
    const validHeader = STANDARD_HEADERS.join(",");
    const csv =
      `${validHeader}\r\n` +
      `\r\n` +
      `tee-1,"Shirt, ""Deluxe""\nLine2",Tops,999,,ACTIVE,,61091000,Cotton,Regular,Black,M,SKU-1,10\r\n` +
      `   \r\n` +
      `tee-2,"Pants\r\nMultiLine",Bottoms,1299,,ACTIVE,,62034200,Linen,Slim,Olive,L,SKU-2,5\r\n\r\n`;

    const res = parseProductsCsv(csv);
    expect(res.errors).toEqual([]);
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0].name).toBe('Shirt, "Deluxe"\nLine2');
    expect(res.rows[0].rowNumber).toBe(2);
    expect(res.rows[1].name).toBe("Pants\r\nMultiLine");
    expect(res.rows[1].rowNumber).toBe(3);

    const unterminated = `${validHeader}\ntee-1,"Unterminated,Tops,999,,ACTIVE,,61091000,Cotton,Regular,Black,M,SKU-1,10`;
    expect(() => parseProductsCsv(unterminated)).toThrow("Unterminated quoted field in CSV");
  });

  it("round-trips formula-prefix cells through sanitizeCsvCell export and parseProductsCsv", () => {
    const validHeader = STANDARD_HEADERS.map(sanitizeCsvCell).join(",");
    const originals = ["=SUM(A1:A2)", "+1-800-HABITT", "-discount", "@mention", "\tTabbed", "\rCarriage"];
    const rows = originals.map((val, idx) =>
      [
        `slug-${idx}`,
        val,
        "Tops",
        "999.00",
        "",
        "ACTIVE",
        "",
        "",
        "",
        "",
        "Black",
        "M",
        `SKU-F-${idx}`,
        "5",
      ].map(sanitizeCsvCell).join(",")
    );

    const csv = [validHeader, ...rows].join("\n");
    const res = parseProductsCsv(csv);
    expect(res.errors).toEqual([]);
    expect(res.rows.map((r) => r.name)).toEqual(originals);
  });

  it("keeps costPrice 0 for OWNER and ignores costPrice for STAFF with owner header", () => {
    const ownerHeader = OWNER_HEADERS.join(",");
    const csv = `${ownerHeader}\ntee-zero,Zero Cost Tee,Tops,999,,ACTIVE,,61091000,Cotton,Regular,Black,M,SKU-ZERO,10,0`;

    const ownerRes = parseProductsCsv(csv, "OWNER");
    expect(ownerRes.errors).toEqual([]);
    expect(ownerRes.rows[0].costPrice).toBe(0);

    const staffRes = parseProductsCsv(csv, "STAFF");
    expect(staffRes.errors).toEqual([]);
    expect(staffRes.rows[0].costPrice).toBeNull();
  });
});
