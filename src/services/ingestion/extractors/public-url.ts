import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 30_000;

export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  const parsed = ipaddr.process(address);
  return parsed.range() === "unicast";
}

export function publicUrl(value: string): URL {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port) {
    throw new Error("Only public HTTP(S) URLs on standard ports without credentials are allowed");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname) && !isPublicAddress(hostname)) {
    throw new Error("Non-public URL address is not allowed");
  }
  return url;
}

export type ResolveHost = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

export async function resolvePublicAddress(url: URL, resolve: ResolveHost = (host) => dns.lookup(host, { all: true })) {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await resolve(hostname);
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error("URL must resolve exclusively to public IP addresses");
  }
  return addresses[0]!;
}

/** Pin the validated address to the connection; validate every redirect independently. */
export async function fetchPublicUrl(value: string): Promise<Buffer> {
  let url = publicUrl(value);
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const aborted = new Promise<never>((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const address = await Promise.race([resolvePublicAddress(url), aborted]);
    signal.throwIfAborted();
    const response = await new Promise<{ body: Buffer; location?: string }>((resolve, reject) => {
      const request = url.protocol === "https:" ? https.request : http.request;
      const req = request(url, {
        agent: false,
        signal,
        lookup: (_hostname, options, callback) => {
          if (options.all) callback(null, [address]);
          else callback(null, address.address, address.family);
        },
        headers: { "user-agent": "Supermemento/2.0", "accept-encoding": "identity" }
      }, (res) => {
        res.on("error", reject);
        if ([301, 302, 303, 307, 308].includes(res.statusCode ?? 0)) {
          const location = res.headers.location;
          res.destroy();
          if (!location) reject(new Error("Redirect is missing its location"));
          else resolve({ body: Buffer.alloc(0), location });
          return;
        }
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          res.destroy();
          reject(new Error(`Failed to fetch URL (${res.statusCode})`));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            res.destroy(new Error("URL response exceeds 10 MiB"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve({ body: Buffer.concat(chunks) }));
      });
      req.on("error", reject);
      req.end();
    });
    if (!response.location) return response.body;
    url = publicUrl(new URL(response.location, url).href);
  }
  throw new Error("Too many URL redirects");
}
