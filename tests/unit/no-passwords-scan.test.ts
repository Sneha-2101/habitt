import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("T37: No passwords scan test", () => {
  const dirsToScan = ["app", "lib"];
  const individualFiles = [
    "prisma/schema.prisma",
    "prisma/seed.ts",
    ".env.example",
  ];

  function getFiles(dir: string): string[] {
    const results: string[] = [];
    const list = fs.readdirSync(dir, { withFileTypes: true });
    for (const file of list) {
      const fullPath = path.join(dir, file.name);
      if (file.isDirectory()) {
        results.push(...getFiles(fullPath));
      } else if (/\.(tsx?|jsx?|mjs|cjs|json)$/.test(file.name)) {
        results.push(fullPath);
      }
    }
    return results;
  }

  it("ensures no passwordHash, bcrypt, credentials provider, or SEED_OWNER_PASSWORD in app, lib, prisma schema/seed, and .env.example", () => {
    const filesToScan: string[] = [];

    for (const dir of dirsToScan) {
      const resolved = path.resolve(process.cwd(), dir);
      if (fs.existsSync(resolved)) {
        filesToScan.push(...getFiles(resolved));
      }
    }

    for (const f of individualFiles) {
      const resolved = path.resolve(process.cwd(), f);
      if (fs.existsSync(resolved)) {
        filesToScan.push(resolved);
      }
    }

    const violations: { file: string; line: number; match: string }[] = [];

    const bannedPatterns = [
      /passwordHash/i,
      /bcrypt/i,
      /signIn\(\s*["']credentials["']/i,
      /id:\s*["']credentials["']/i,
      /SEED_OWNER_PASSWORD/i,
    ];

    for (const file of filesToScan) {
      const relPath = path.relative(process.cwd(), file);
      // Skip the test itself
      if (relPath.includes("no-passwords-scan.test.ts")) continue;

      const content = fs.readFileSync(file, "utf8");
      const lines = content.split("\n");

      lines.forEach((line, idx) => {
        for (const pattern of bannedPatterns) {
          if (pattern.test(line)) {
            violations.push({
              file: `${relPath}:${idx + 1}`,
              line: idx + 1,
              match: line.trim(),
            });
          }
        }
      });
    }

    expect(violations).toEqual([]);
  });
});

