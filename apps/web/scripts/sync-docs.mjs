// Copies the compiled technical documentation into public/ so the landing
// page's "Read Docs" buttons can download it. docs/techdoc stays the single
// source of truth; the copy is gitignored and refreshed before dev and build.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../../../docs/techdoc/contextcaps-techdoc.pdf", import.meta.url));
const targetDir = fileURLToPath(new URL("../public/docs/", import.meta.url));
const target = `${targetDir}ContextCaps-Technical-Documentation.pdf`;

if (!existsSync(source)) {
  console.warn("[sync-docs] docs/techdoc/contextcaps-techdoc.pdf not found; Read Docs will not download.");
} else {
  mkdirSync(targetDir, { recursive: true });
  copyFileSync(source, target);
  console.log("[sync-docs] copied technical documentation to public/docs/");
}
