const fs = require("fs");
const http = require("http");
const path = require("path");

const port = Number(process.argv[2] || process.env.PORT || 22082);
const host = process.argv[3] || process.env.HOST || "127.0.0.1";
const root = path.resolve(process.cwd());

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function resolveRequestPath(reqUrl) {
  const url = new URL(reqUrl, `http://${host}:${port}`);
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (pathname === "/") pathname = "/index.html";

  const filePath = path.resolve(root, `.${pathname}`);
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
    return null;
  }
  return filePath;
}

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return send(res, 405, "Method Not Allowed", { Allow: "GET, HEAD" });
  }

  const filePath = resolveRequestPath(req.url);
  if (!filePath) return send(res, 400, "Bad Request");

  fs.stat(filePath, (statErr, stat) => {
    const finalPath = !statErr && stat.isDirectory()
      ? path.join(filePath, "index.html")
      : filePath;

    fs.readFile(finalPath, (readErr, data) => {
      if (readErr) return send(res, 404, "Not Found");

      const type = contentTypes[path.extname(finalPath).toLowerCase()]
        || "application/octet-stream";
      res.writeHead(200, {
        "Content-Length": data.length,
        "Content-Type": type,
      });
      if (req.method === "HEAD") return res.end();
      res.end(data);
    });
  });
});

server.listen(port, host, () => {
  console.log(`[smallphone-frontend-beta] serving ${root} at http://${host}:${port}`);
});
