import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createRuntime, parsePort, safeEqual, startServer } from "../src/server.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");

test("port parsing and constant-time credential comparison", () => {
  assert.equal(parsePort("8080", 3000), 8080);
  assert.equal(parsePort("invalid", 3000), 3000);
  assert.equal(safeEqual("secret", "secret"), true);
  assert.equal(safeEqual("secret", "wrong"), false);
});

test("control center starts, protects setup, and proxies to gateway", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-railway-test-"));
  const original = { ...process.env };
  process.env.OPENCLAW_NODE = process.execPath;
  process.env.OPENCLAW_ENTRY = path.join(projectRoot, "fixtures", "mock-openclaw.mjs");
  process.env.PORT = "0";
  process.env.OPENCLAW_INTERNAL_GATEWAY_PORT = String(20_000 + Math.floor(Math.random() * 10_000));
  process.env.OPENCLAW_STATE_DIR = path.join(root, "state");
  process.env.OPENCLAW_WORKSPACE_DIR = path.join(root, "workspace");
  process.env.XDG_CONFIG_HOME = path.join(root, "config");
  process.env.SETUP_PASSWORD = "test-password";
  process.env.OPENCLAW_GATEWAY_TOKEN = "test-gateway-token";

  const runtime = createRuntime(process.env);
  runtime.publicPort = 0;
  const app = await startServer(runtime);
  const port = app.server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    const health = await fetch(`${base}/healthz`);
    assert.equal(health.status, 200);

    const denied = await fetch(`${base}/setup`, { redirect: "manual" });
    assert.equal(denied.status, 401);

    const auth = `Basic ${Buffer.from("admin:test-password").toString("base64")}`;
    const setup = await fetch(`${base}/setup`, { headers: { authorization: auth } });
    assert.equal(setup.status, 200);
    assert.match(await setup.text(), /OpenClaw is under control/);

    let proxied;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      proxied = await fetch(`${base}/openclaw`, { headers: { authorization: auth } });
      if (proxied.status === 200) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(proxied.status, 200);
    assert.equal(await proxied.text(), "mock gateway");
  } finally {
    await app.close();
    process.env = original;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
