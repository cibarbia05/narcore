// Tiny OpenAI-embeddings sanitizing proxy (zero deps).
//
// Why this exists: the Redis Agent Memory Server embeds via LiteLLM, which sends
// `"encoding_format": null` on the OpenAI /v1/embeddings call. The llama.cpp server
// that serves nomic-embed-text rejects a null where it expects a string
// ("[json.exception.type_error.302] type must be string, but is null"). This proxy
// sits between them and strips null-valued top-level fields from the JSON body, so
// the memory server can use the same local nomic embedder the app uses — one
// embedding family, one box, no external embedding key.
//
// Standalone CommonJS Node script run in a node:20-alpine container (`node
// server.js`) — not part of the Next/TS app, hence require() over import.
/* eslint-disable @typescript-eslint/no-require-imports */
const http = require("node:http");

const UPSTREAM = process.env.UPSTREAM_URL || "http://embedding:8080";
const PORT = Number(process.env.PORT || 8090);
const upstream = new URL(UPSTREAM);

function stripNulls(value) {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      if (value[key] === null) delete value[key];
      else value[key] = stripNulls(value[key]);
    }
  }
  return value;
}

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    let body = Buffer.concat(chunks);
    const contentType = req.headers["content-type"] || "";
    if (contentType.includes("application/json") && body.length) {
      try {
        body = Buffer.from(JSON.stringify(stripNulls(JSON.parse(body.toString("utf8")))));
      } catch {
        /* not JSON we can parse — forward unchanged */
      }
    }
    const options = {
      hostname: upstream.hostname,
      port: upstream.port || 80,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: upstream.host, "content-length": Buffer.byteLength(body) },
    };
    const proxied = http.request(options, (pres) => {
      res.writeHead(pres.statusCode || 502, pres.headers);
      pres.pipe(res);
    });
    proxied.on("error", (err) => {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: String(err), type: "proxy_error" } }));
    });
    proxied.end(body);
  });
});

server.listen(PORT, () => {
  console.log(`[embed-proxy] listening on :${PORT} -> ${UPSTREAM} (stripping null JSON fields)`);
});
