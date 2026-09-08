import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const ROOT = "C:\\Users\\user\\Desktop\\agora\\apps\\web\\dist";
const API = "http://localhost:3000";

const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
};

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    const r = http.request(
      API + req.url,
      { method: req.method, headers: req.headers },
      (b) => {
        res.writeHead(b.statusCode, b.headers);
        b.pipe(res);
      },
    );
    req.pipe(r);
    return;
  }
  let p = decodeURIComponent(req.url.split("?")[0]);
  let fp = path.join(ROOT, p);
  if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    fp = path.join(ROOT, "index.html");
  }
  fs.readFile(fp, (e, data) => {
    if (e) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const ext = path.extname(fp);
    res.writeHead(200, { "content-type": types[ext] || "application/octet-stream" });
    res.end(data);
  });
});

const PORT = Number(process.env.PORT) || 8080;
server.listen(PORT, () => console.log(`local proxy on http://localhost:${PORT}`));
