// Minimal static server for the landing page (no dependencies).
//   npm run dev:landing            -> http://localhost:4400
//   LANDING_PORT=8080 npm run dev:landing
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)));
const PORT = Number(process.env.LANDING_PORT ?? 4400);
const HOST = process.env.LANDING_HOST ?? "127.0.0.1";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    let path = normalize(join(ROOT, decodeURIComponent(url.pathname)));
    // Never serve anything outside the landing folder.
    if (path !== ROOT && !path.startsWith(ROOT + sep)) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    if ((await stat(path).catch(() => null))?.isDirectory()) path = join(path, "index.html");
    const body = await readFile(path);
    res.writeHead(200, {
      "content-type": TYPES[extname(path).toLowerCase()] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`ContextCaps landing page: http://localhost:${PORT}`);
});
