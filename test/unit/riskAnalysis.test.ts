import { describe, expect, it } from "vitest";
import { categorizeSize, detectRiskFlags } from "../../src/services/riskAnalysis.js";

describe("detectRiskFlags", () => {
  it("flags auth, migration, and API route paths", () => {
    const flags = detectRiskFlags([
      "src/auth/login.ts",
      "migrations/001_init.sql",
      "src/routes/users.ts",
      "README.md",
    ]);

    expect(flags).toEqual(
      expect.arrayContaining(["touches auth", "touches migration", "touches public API route"]),
    );
    expect(flags).toHaveLength(3);
  });

  it("returns no flags for innocuous file paths", () => {
    expect(detectRiskFlags(["README.md", "docs/guide.md"])).toEqual([]);
  });

  it("flags dependency and CI files", () => {
    const flags = detectRiskFlags(["package.json", ".github/workflows/ci.yml"]);
    expect(flags).toEqual(expect.arrayContaining(["touches dependencies", "touches CI/CD config"]));
  });
});

describe("categorizeSize", () => {
  it("categorizes a tiny change as XS", () => {
    expect(categorizeSize(1, 5, 0)).toBe("XS");
  });

  it("categorizes by whichever signal (files or lines) is larger", () => {
    // Few lines but many files touched should not stay XS.
    expect(categorizeSize(50, 5, 0)).toBe("XL");
  });

  it("categorizes a large line-count single-file change as XL", () => {
    expect(categorizeSize(1, 900, 200)).toBe("XL");
  });

  it("categorizes a mid-size PR as M", () => {
    expect(categorizeSize(4, 120, 15)).toBe("M");
  });
});
