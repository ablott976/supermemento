import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { loadConfig } from "./config.js";

const originalEnvironment = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) delete process.env[key];
  }
  Object.assign(process.env, originalEnvironment);
});

function baseEnvironment(): void {
  Object.assign(process.env, {
    NEO4J_URI: "bolt://neo4j:7687",
    NEO4J_USER: "neo4j",
    NEO4J_PASSWORD: "password",
    OPENAI_API_KEY: "embedding-key"
  });
}

describe("LLM environment configuration", () => {
  it("keeps Anthropic as the backwards-compatible default", () => {
    baseEnvironment();
    process.env.ANTHROPIC_API_KEY = "anthropic-key";
    process.env.OPENAI_CODEX_RELAY_KEY_FILE = "/does/not/exist";
    delete process.env.LLM_PROVIDER;
    const config = loadConfig();
    assert.equal(config.LLM_PROVIDER, "anthropic");
    assert.equal(config.ANTHROPIC_MODEL, "claude-haiku-4-5-20251001");
    assert.equal(config.LLM_REQUEST_TIMEOUT_MS, 180000);
  });

  it("treats a blank optional Codex URL as absent for Anthropic", () => {
    baseEnvironment();
    process.env.ANTHROPIC_API_KEY = "anthropic-key";
    process.env.OPENAI_CODEX_BASE_URL = "   ";
    delete process.env.LLM_PROVIDER;

    const config = loadConfig();

    assert.equal(config.LLM_PROVIDER, "anthropic");
    assert.equal(config.OPENAI_CODEX_BASE_URL, undefined);
  });

  it("accepts a private Codex relay without requiring Anthropic", () => {
    baseEnvironment();
    process.env.LLM_PROVIDER = "openai-codex";
    process.env.OPENAI_CODEX_BASE_URL = "http://100.104.0.187:8646/v1";
    process.env.OPENAI_CODEX_RELAY_KEY = "x".repeat(48);
    delete process.env.ANTHROPIC_API_KEY;
    const config = loadConfig();
    assert.equal(config.OPENAI_CODEX_MODEL, "gpt-5.6-luna");
  });

  it("accepts an internal Docker service DNS name", () => {
    baseEnvironment();
    process.env.LLM_PROVIDER = "openai-codex";
    process.env.OPENAI_CODEX_BASE_URL = "http://codex-oauth-bridge:18646/v1";
    process.env.OPENAI_CODEX_RELAY_KEY = "x".repeat(48);
    const config = loadConfig();
    assert.equal(config.OPENAI_CODEX_BASE_URL, "http://codex-oauth-bridge:18646/v1");
  });

  it("accepts numeric loopback hosts but rejects DNS names beginning with 127", () => {
    baseEnvironment();
    process.env.LLM_PROVIDER = "openai-codex";
    process.env.OPENAI_CODEX_RELAY_KEY = "x".repeat(48);
    process.env.OPENAI_CODEX_BASE_URL = "http://127.0.0.2:8646/v1";
    assert.equal(loadConfig().OPENAI_CODEX_BASE_URL, "http://127.0.0.2:8646/v1");

    process.env.OPENAI_CODEX_BASE_URL = "http://[::1]:8646/v1";
    assert.equal(loadConfig().OPENAI_CODEX_BASE_URL, "http://[::1]:8646/v1");

    process.env.OPENAI_CODEX_BASE_URL = "http://127.evil.example:8646/v1";
    assert.throws(() => loadConfig(), /internal bridge or a private\/loopback address/);

    process.env.OPENAI_CODEX_BASE_URL = "http://127.0.0.1e2:8646/v1";
    assert.throws(() => loadConfig(), /internal bridge or a private\/loopback address/);

    process.env.OPENAI_CODEX_BASE_URL = "http://010.0.0.1:8646/v1";
    assert.throws(() => loadConfig(), /internal bridge or a private\/loopback address/);

    for (const coercedHost of ["0x7f.0.0.1", "127.1", "127.000.000.001"]) {
      process.env.OPENAI_CODEX_BASE_URL = `http://${coercedHost}:8646/v1`;
      assert.throws(() => loadConfig(), /internal bridge or a private\/loopback address/);
    }
  });

  it("loads the relay bearer from a Docker secret file", () => {
    const directory = mkdtempSync(join(tmpdir(), "supermemento-codex-secret-"));
    const secretPath = join(directory, "relay-key");
    try {
      writeFileSync(secretPath, "s".repeat(48), { mode: 0o600 });
      baseEnvironment();
      process.env.LLM_PROVIDER = "openai-codex";
      process.env.OPENAI_CODEX_BASE_URL = "http://codex-oauth-bridge:18646/v1";
      process.env.OPENAI_CODEX_RELAY_KEY_FILE = secretPath;
      delete process.env.OPENAI_CODEX_RELAY_KEY;
      const config = loadConfig();
      assert.equal(config.OPENAI_CODEX_RELAY_KEY?.length, 48);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects public relay hosts over HTTP and HTTPS", () => {
    baseEnvironment();
    process.env.LLM_PROVIDER = "openai-codex";
    process.env.OPENAI_CODEX_RELAY_KEY = "x".repeat(48);
    for (const url of [
      "http://203.0.113.10:8646/v1",
      "https://relay.example.com/v1"
    ]) {
      process.env.OPENAI_CODEX_BASE_URL = url;
      assert.throws(() => loadConfig(), /internal bridge or a private\/loopback address/);
    }
  });
});
