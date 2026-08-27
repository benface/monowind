/**
 * Zero-dependency static file server (used inside the Playwright Docker
 * container, where platform-specific binaries from the host's node_modules
 * can't run). Usage: node serve-static.mjs <dir> <port>
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const [, , dir = ".", portArg = "6007"] = process.argv;
const port = Number(portArg);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

createServer((request, response) => {
  const urlPath = decodeURIComponent(new URL(request.url, "http://x").pathname);
  let filePath = normalize(join(dir, urlPath));
  if (!filePath.startsWith(normalize(dir))) {
    response.writeHead(403).end();
    return;
  }
  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, "index.html");
  }
  if (!existsSync(filePath)) {
    response.writeHead(404).end("not found");
    return;
  }
  response.writeHead(200, {
    "content-type": contentTypes[extname(filePath)] ?? "application/octet-stream",
  });
  createReadStream(filePath).pipe(response);
}).listen(port, () => {
  console.log(`serving ${dir} on http://localhost:${port}`);
});
