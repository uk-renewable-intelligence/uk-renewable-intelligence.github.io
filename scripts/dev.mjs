import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist-static");
const port = Number(process.env.PORT || 4173);
const publicFiles = new Set([
  "index.html",
  "404.html",
  "dashboard-summary.json",
  "projects-index.json",
  "project-details.json",
  "favicon.svg",
  "og.png",
]);
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, `http://${request.headers.host || "localhost"}`).pathname;
  const requested = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  const filename = publicFiles.has(requested) ? requested : "404.html";
  try {
    const payload = await readFile(resolve(output, filename));
    response.writeHead(filename === "404.html" && requested !== "404.html" ? 404 : 200, {
      "content-type": contentTypes[extname(filename)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(payload);
  } catch (error) {
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end(String(error));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Local URL: http://127.0.0.1:${port}`);
});
