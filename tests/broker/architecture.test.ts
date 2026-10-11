import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : path.endsWith(".ts") ? [path] : [];
  });
}

describe("Architecture boundaries", () => {
  it("no Agent → Vault path: the agent runtime cannot import the vault", () => {
    const pkg = JSON.parse(readFileSync(join(root, "services/agent/package.json"), "utf8"));
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain("@contextcaps/vault");
    for (const file of sourceFiles(join(root, "services/agent/src"))) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/@contextcaps\/vault|services\/vault|@contextcaps\/broker/);
    }
  });

  it("policy engine is chain-agnostic and vault-agnostic", () => {
    for (const file of sourceFiles(join(root, "packages/policy/src"))) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/@contextcaps\/(vault|broker|agent|contract-sdk)/);
    }
  });

  it("only the tool gateway resolves tool-bound secrets", () => {
    const callers = sourceFiles(join(root, "services/broker/src")).filter((f) =>
      readFileSync(f, "utf8").includes("resolveToolSecret("),
    );
    expect(callers.map((f) => f.replace(/\\/g, "/").split("services/broker/src/")[1])).toEqual(["tools/toolGateway.ts"]);
  });
});
