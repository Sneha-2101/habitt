import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("T56: Account enumeration phrase scan", () => {
  const dirsToScan = ["app", "lib", "components"];

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

  it("ensures no account-revealing enumeration phrases exist in app, lib, and components", () => {
    const filesToScan: string[] = [];

    for (const dir of dirsToScan) {
      const resolved = path.resolve(process.cwd(), dir);
      if (fs.existsSync(resolved)) {
        filesToScan.push(...getFiles(resolved));
      }
    }

    const bannedPhrases = [
      "already linked",
      "already exists",
      "already registered",
      "already in use",
      "already associated",
    ];

    const violations: { file: string; line: number; match: string; text: string }[] = [];

    for (const file of filesToScan) {
      const relPath = path.relative(process.cwd(), file);
      const content = fs.readFileSync(file, "utf8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Explicitly exclude coupon text ("already used this coupon") as specified in the requirements
        if (/coupon/i.test(line)) {
          continue;
        }

        for (const phrase of bannedPhrases) {
          if (line.toLowerCase().includes(phrase.toLowerCase())) {
            violations.push({
              file: relPath,
              line: i + 1,
              match: phrase,
              text: line.trim(),
            });
          }
        }
      }
    }

    expect(
      violations,
      `Found ${violations.length} account enumeration phrases: ${JSON.stringify(violations, null, 2)}`
    ).toHaveLength(0);
  });
});

