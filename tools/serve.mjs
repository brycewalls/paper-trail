// A small static server for local work: serves the repo root so public/index.html?fake=1 can load
// tools/fake/fake-backend.js. http://localhost:5178/public/index.html?fake=1
//   node tools/serve.mjs [port]
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, resolve, dirname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.argv[2] || process.env.PORT || 5178);
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".pdf": "application/pdf", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".onnx": "application/octet-stream", ".txt": "text/plain; charset=utf-8", ".wasm": "application/wasm" };
createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (path === "/") { res.writeHead(302, { Location: "/public/index.html?fake=1" }); res.end(); return; }
  let file = join(root, path);
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file)) { res.writeHead(404); res.end("not found"); return; }
  res.writeHead(200, { "content-type": MIME[extname(file).toLowerCase()] || "application/octet-stream", "cache-control": "no-store" });
  res.end(readFileSync(file));
}).listen(port, "127.0.0.1", () => console.log(`Paper Trail on http://localhost:${port}/public/index.html?fake=1`));
