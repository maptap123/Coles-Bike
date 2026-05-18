import http from "node:http";
import { readFile } from "node:fs";
import path from "node:path";

const root = process.cwd();
const port = Number(process.env.PORT || 4173);
const host = "127.0.0.1";
const types = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${host}:${port}`);
  const pathname = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname);
  const filePath = path.join(root, pathname);

  if (!filePath.startsWith(root) || url.pathname.startsWith("/api/")) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": types[path.extname(filePath)] || "application/octet-stream",
    });
    response.end(data);
  });
});

server.listen(port, host, () => {
  console.log(`Bike tracker running at http://${host}:${port}`);
});
