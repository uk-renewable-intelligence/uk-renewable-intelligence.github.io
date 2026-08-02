import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist-static");
const port = Number(process.env.PORT || 4173);
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, `http://${request.headers.host || "localhost"}`).pathname;
  const requested = decodeURIComponent(pathname.slice(1));
  const candidate = resolve(output, requested || "index.html");
  let filename = candidate;
  let status = 200;
  try {
    if (candidate !== output && !candidate.startsWith(`${output}/`)) throw new Error("Invalid path");
    const fileInfo = await stat(candidate);
    if (fileInfo.isDirectory()) filename = resolve(candidate, "index.html");
    const payload = await readFile(filename);
    response.writeHead(status, {
      "content-type": contentTypes[extname(filename)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(payload);
  } catch (error) {
    try {
      filename = resolve(output, "404.html");
      status = 404;
      const payload = await readFile(filename);
      response.writeHead(status, { "content-type": contentTypes[extname(filename)], "cache-control": "no-store" });
      response.end(payload);
    } catch (fallbackError) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(String(fallbackError));
    }
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Local URL: http://127.0.0.1:${port}`);
});
