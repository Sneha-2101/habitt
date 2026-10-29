import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("no-hardcoded-details unit test", () => {
  const dirsToScan = ["app", "components", "lib"];
  const domainPattern = /habitt\.in/i;
  const indianMobilePattern = /(?:\+91[\s-]?)?[6-9]\d{9}/;

  function getFiles(dir: string): string[] {
    const results: string[] = [];
    const list = fs.readdirSync(dir, { withFileTypes: true });
    for (const file of list) {
      const fullPath = path.join(dir, file.name);
      if (file.isDirectory()) {
        results.push(...getFiles(fullPath));
      } else if (/\.(tsx?|jsx?|mjs|cjs)$/.test(file.name)) {
        results.push(fullPath);
      }
    }
    return results;
  }

  it("ensures no habitt.in domain or hardcoded Indian mobile numbers in app, components, lib", () => {
    const violations: { file: string; match: string; type: string }[] = [];

    for (const dir of dirsToScan) {
      const resolvedDir = path.resolve(process.cwd(), dir);
      if (!fs.existsSync(resolvedDir)) continue;

      const files = getFiles(resolvedDir);
      for (const file of files) {
        const content = fs.readFileSync(file, "utf8");
        const lines = content.split("\n");

        lines.forEach((line, index) => {
          if (domainPattern.test(line)) {
            violations.push({
              file: `${path.relative(process.cwd(), file)}:${index + 1}`,
              match: line.trim(),
              type: "DOMAIN",
            });
          }
          const phoneMatch = line.match(indianMobilePattern);
          if (phoneMatch) {
            violations.push({
              file: `${path.relative(process.cwd(), file)}:${index + 1}`,
              match: line.trim(),
              type: "PHONE",
            });
          }
        });
      }
    }

    expect(violations).toEqual([]);
  });
});

