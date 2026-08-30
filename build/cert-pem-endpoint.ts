import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin, ViteDevServer } from "vite";

/**
 * Serves GET /__cert.pem for the Vite HTTPS servers (dev and `vite preview`).
 *
 * The homepage's "Download HTTPS certificate" link points here so a phone on
 * the LAN can install the self-signed cert (iOS 14 in particular). The Go
 * server already implements the route; Vite's default SPA fallback does not,
 * so a click used to download index.html with a .pem filename.
 *
 * @vitejs/plugin-basic-ssl caches a combined PEM (private key + certificate).
 * Only the CERTIFICATE block is served — never the key.
 */
export function certPemEndpoint(): Plugin {
  let pem = "";
  const attach = (server: ViteDevServer | { middlewares: ViteDevServer["middlewares"] }) => {
    server.middlewares.use("/__cert.pem", (req, res) => {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.statusCode = 405;
        res.end();
        return;
      }
      if (!pem) {
        res.statusCode = 404;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("no certificate");
        return;
      }
      res.setHeader("Content-Type", "application/x-pem-file");
      res.setHeader("Content-Disposition", 'attachment; filename="decimen.pem"');
      res.setHeader("Cache-Control", "no-store");
      res.end(req.method === "HEAD" ? undefined : pem);
    });
  };
  return {
    name: "cert-pem-endpoint",
    apply: "serve",
    enforce: "post",
    configResolved(config) {
      pem =
        pemFromHttps(config.preview.https) ||
        pemFromHttps(config.server.https) ||
        pemFromCacheFile(config.cacheDir);
    },
    configureServer: attach,
    configurePreviewServer: attach,
  };
}

function certificateBlocks(raw: string): string {
  const blocks = raw.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
  if (!blocks || blocks.length === 0) return "";
  return blocks.join("\n") + "\n";
}

function pemFromHttps(https: unknown): string {
  if (!https || https === true) return "";
  const cert = (https as { cert?: unknown }).cert;
  const raw = toPemString(cert);
  return raw ? certificateBlocks(raw) : "";
}

function pemFromCacheFile(cacheDir: string): string {
  try {
    return certificateBlocks(readFileSync(resolve(cacheDir, "basic-ssl/_cert.pem"), "utf8"));
  } catch {
    return "";
  }
}

function toPemString(cert: unknown): string {
  if (typeof cert === "string") return cert;
  if (cert instanceof Uint8Array) return Buffer.from(cert).toString("utf8");
  if (Array.isArray(cert) && cert[0] != null) return toPemString(cert[0]);
  return "";
}
