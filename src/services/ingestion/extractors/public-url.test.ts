import assert from "node:assert/strict";
import { describe, it } from "node:test";
import dns from "node:dns/promises";
import http from "node:http";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { fetchPublicUrl, isPublicAddress, publicUrl, resolvePublicAddress } from "./public-url.js";

describe("Public URL safety", () => {
  it("rejects private, reserved, local and IPv4-mapped internal addresses", () => {
    for (const address of ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "224.0.0.1", "192.0.2.1", "::1", "::", "fc00::1", "fe80::1", "2001:db8::1", "::ffff:127.0.0.1"]) {
      assert.equal(isPublicAddress(address), false, address);
    }
    for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) {
      assert.equal(isPublicAddress(address), true, address);
    }
  });

  it("rejects alternate schemes, credentials, internal literal encodings and nonstandard ports", () => {
    for (const url of ["file:///etc/passwd", "ftp://example.com/a", "https://u:p@example.com", "http://example.com:8080", "http://2130706433", "http://0x7f000001", "http://127.1", "http://[::ffff:127.0.0.1]"]) {
      assert.throws(() => publicUrl(url), undefined, url);
    }
    assert.equal(publicUrl("https://example.com/a").hostname, "example.com");
  });

  it("rejects mixed public/private DNS results and empty DNS answers", async () => {
    for (const addresses of [[], [{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 }]]) {
      await assert.rejects(resolvePublicAddress(publicUrl("https://example.com"), async () => addresses), /public IP/);
    }
    const result = await resolvePublicAddress(publicUrl("https://example.com"), async () => [{ address: "8.8.8.8", family: 4 }]);
    assert.equal(result.address, "8.8.8.8");
  });

  it("rejects private destinations without opening a connection", async () => {
    await assert.rejects(fetchPublicUrl("http://127.0.0.1/"), /Non-public/);
  });

  it("pins validated DNS answers and rejects redirect rebinding before a second request", async (t) => {
    let resolutions = 0;
    let requests = 0;
    t.mock.method(dns, "lookup", async () => [{ address: ++resolutions === 1 ? "8.8.8.8" : "127.0.0.1", family: 4 }]);
    t.mock.method(http, "request", (_url: URL, options: http.RequestOptions, callback: (res: unknown) => void) => {
      requests += 1;
      assert.equal(options.agent, false);
      assert.ok(options.signal);
      options.lookup!("example.com", { all: false }, (err: unknown, address: unknown) => {
        assert.equal(err, null);
        assert.equal(address, "8.8.8.8");
      });
      const req = Object.assign(new EventEmitter(), { end: () => {
        const res = Object.assign(Readable.from([]), { statusCode: 302, headers: { location: "/redirect" } });
        queueMicrotask(() => callback(res));
      } });
      return req;
    });
    await assert.rejects(fetchPublicUrl("http://example.com"), /public IP/);
    assert.equal(resolutions, 2);
    assert.equal(requests, 1);
  });

  it("bounds response bytes and redirect loops", async (t) => {
    t.mock.method(dns, "lookup", async () => [{ address: "8.8.8.8", family: 4 }]);
    let redirect = false;
    let requests = 0;
    t.mock.method(http, "request", (_url: URL, _options: unknown, callback: (res: unknown) => void) => {
      requests += 1;
      return Object.assign(new EventEmitter(), { end: () => {
        const res = Object.assign(Readable.from(redirect ? [] : [Buffer.alloc(10 * 1024 * 1024 + 1)]), {
          statusCode: redirect ? 302 : 200, headers: redirect ? { location: "/again" } : {}
        });
        queueMicrotask(() => callback(res));
      } });
    });
    await assert.rejects(fetchPublicUrl("http://example.com"), /exceeds 10 MiB/);
    redirect = true;
    requests = 0;
    await assert.rejects(fetchPublicUrl("http://example.com"), /Too many URL redirects/);
    assert.equal(requests, 6);
  });
});
