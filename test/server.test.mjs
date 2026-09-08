import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { dashboardHtml } from "../src/dashboard.mjs";
import { createRuntime, parsePort, safeEqual, startServer } from "../src/server.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");

function websocketStatus(port, authorization = "") {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const timer = setTimeout(() => { socket.destroy(); reject(new Error("WebSocket handshake timed out")); }, 5_000);
    let response = "";
    socket.on("connect", () => socket.write([
      "GET /openclaw HTTP/1.1", `Host: 127.0.0.1:${port}`, "Connection: Upgrade", "Upgrade: websocket",
      "Sec-WebSocket-Version: 13", "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==", "Origin: https://example.test",
      ...(authorization ? [`Authorization: ${authorization}`] : []), "", "",
    ].join("\r\n")));
    socket.on("data", (chunk) => {
      response += chunk.toString();
      if (!response.includes("\r\n")) return;
      clearTimeout(timer); socket.destroy(); resolve(Number(response.match(/^HTTP\/1\.1 (\d{3})/)?.[1]));
    });
    socket.on("error", reject);
  });
}

test("port parsing and constant-time credential comparison", () => {
  assert.equal(parsePort("8080", 3000), 8080);
  assert.equal(parsePort("invalid", 3000), 3000);
  assert.equal(safeEqual("secret", "secret"), true);
  assert.equal(safeEqual("secret", "wrong"), false);
});

test("setup page ships valid JavaScript and never falls back to a GET form", () => {
  const page = dashboardHtml();
  const script = page.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, "setup page must include its client script");
  assert.doesNotThrow(() => new vm.Script(script));
  assert.match(page, /<form id="setupForm" method="post" action="\/setup">/);
  assert.doesNotMatch(page, /<form id="setupForm">/);
  assert.match(page, /Configure provider later in OpenClaw/);
});

test("provider setup can be deferred without an API key", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-railway-deferred-"));
  const original = { ...process.env };
  process.env.OPENCLAW_NODE = process.execPath;
  process.env.OPENCLAW_ENTRY = path.join(projectRoot, "fixtures", "mock-openclaw.mjs");
  process.env.PORT = "0";
  process.env.OPENCLAW_INTERNAL_GATEWAY_PORT = String(30_000 + Math.floor(Math.random() * 10_000));
  process.env.OPENCLAW_STATE_DIR = path.join(root, "state");
  process.env.OPENCLAW_WORKSPACE_DIR = path.join(root, "workspace");
  process.env.XDG_CONFIG_HOME = path.join(root, "config");
  process.env.SETUP_PASSWORD = "test-password";
  process.env.OPENCLAW_GATEWAY_TOKEN = "test-gateway-token";
  process.env.RAILWAY_PUBLIC_DOMAIN = "example.test";
  process.env.RAILWAY_VOLUME_MOUNT_PATH = "/data";
  process.env.MOCK_COMMAND_LOG = path.join(root, "commands.log");

  const runtime = createRuntime(process.env);
  runtime.publicPort = 0;
  const app = await startServer(runtime);
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const login = await fetch(`${base}/login`, {
      method: "POST", redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ password: "test-password" }),
    });
    const cookie = login.headers.get("set-cookie").split(";", 1)[0];
    const installed = await fetch(`${base}/setup/api/install`, {
      method: "POST",
      headers: { cookie, origin: "https://example.test", "content-type": "application/json" },
      body: JSON.stringify({ provider: "none", channel: "none" }),
    });
    assert.equal(installed.status, 200, await installed.text());
    const status = await fetch(`${base}/setup/api/status`, { headers: { cookie } });
    const state = (await status.json()).setup;
    assert.equal(state.status, "complete");
    assert.equal(state.providerDeferred, true);
    const commands = fs.readFileSync(process.env.MOCK_COMMAND_LOG, "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(commands.some((args) => args.includes("onboard")), false);
    assert.equal(commands.some((args) => args.includes("gateway")), true);
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
  }
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
  process.env.RAILWAY_PUBLIC_DOMAIN = "example.test";
  process.env.RAILWAY_VOLUME_MOUNT_PATH = "/data";
  process.env.MOCK_COMMAND_LOG = path.join(root, "commands.log");

  const runtime = createRuntime(process.env);
  runtime.publicPort = 0;
  const app = await startServer(runtime);
  const port = app.server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    const health = await fetch(`${base}/healthz`);
    assert.equal(health.status, 200);

    const denied = await fetch(`${base}/setup`, { redirect: "manual" });
    assert.equal(denied.status, 302);
    assert.match(denied.headers.get("location"), /^\/login/);

    const login = await fetch(`${base}/login`, {
      method: "POST", redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ password: "test-password" }),
    });
    assert.equal(login.status, 302);
    const sessionCookie = login.headers.get("set-cookie").split(";", 1)[0];
    const cookieSetup = await fetch(`${base}/setup`, { headers: { cookie: sessionCookie } });
    assert.equal(cookieSetup.status, 200);

    const auth = `Basic ${Buffer.from("admin:test-password").toString("base64")}`;
    const setup = await fetch(`${base}/setup`, { headers: { authorization: auth }, redirect: "manual" });
    assert.equal(setup.status, 302);

    const status = await fetch(`${base}/setup/api/status`, { headers: { cookie: sessionCookie } });
    assert.equal(status.status, 200);
    assert.equal((await status.json()).storage.persistent, true);
    assert.equal(await websocketStatus(port), 403);

    const tokenLeak = await fetch(`${base}/setup/api/token`, { headers: { cookie: sessionCookie } });
    assert.equal(tokenLeak.status, 404);

    const csrf = await fetch(`${base}/setup/api/install`, {
      method: "POST",
      headers: { cookie: sessionCookie, origin: "https://attacker.example", "content-type": "application/json" },
      body: JSON.stringify({ provider: "openai", apiKey: "sk-test-provider-key", channel: "none" }),
    });
    assert.equal(csrf.status, 403);

    runtime.volumeMountPath = "";
    const ephemeral = await fetch(`${base}/setup/api/install`, {
      method: "POST",
      headers: { cookie: sessionCookie, origin: "https://example.test", "content-type": "application/json" },
      body: JSON.stringify({ provider: "openai", apiKey: "sk-test-provider-key", channel: "none" }),
    });
    assert.equal(ephemeral.status, 400);
    assert.match((await ephemeral.json()).error, /volume mounted at \/data/i);
    runtime.volumeMountPath = "/data";

    const installed = await fetch(`${base}/setup/api/install`, {
      method: "POST",
      headers: { cookie: sessionCookie, origin: "https://example.test", "content-type": "application/json" },
      body: JSON.stringify({ provider: "openai", apiKey: "sk-test-provider-key", model: "openai/mock-model", channel: "none" }),
    });
    const installedText = await installed.text();
    assert.equal(installed.status, 200, installedText);

    const commandLines = fs.readFileSync(process.env.MOCK_COMMAND_LOG, "utf8").trim().split("\n").map(JSON.parse);
    const onboarding = commandLines.find((args) => args.includes("onboard"));
    assert.ok(onboarding, "provider setup must run OpenClaw onboarding");
    assert.equal(onboarding[onboarding.indexOf("--secret-input-mode") + 1], "plaintext");
    assert.equal(commandLines.some((args) => args.includes("secrets")), false, "first-run setup must not run SecretRef migration or audit commands");

    const handoffResponse = await fetch(`${base}/setup/api/handoff`, {
      method: "POST", headers: { cookie: sessionCookie, origin: "https://example.test", "content-type": "application/json" }, body: "{}",
    });
    const handoffText = await handoffResponse.text();
    assert.equal(handoffResponse.status, 200, handoffText);
    const handoff = JSON.parse(handoffText);
    const handoffUrl = new URL(handoff.url);
    assert.equal(handoffUrl.origin, "https://example.test");
    assert.equal(handoffUrl.pathname, "/openclaw/");
    assert.equal(new URLSearchParams(handoffUrl.hash.slice(1)).get("gatewayUrl"), "wss://example.test/openclaw");

    const devices = await fetch(`${base}/setup/api/devices`, { headers: { cookie: sessionCookie } });
    assert.equal(devices.status, 200);
    assert.deepEqual((await devices.json()).pending, [{ requestId: "test-request", deviceId: "test-device", remoteIp: "192.0.2.10" }]);

    let proxied;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      proxied = await fetch(`${base}/openclaw`);
      if (proxied.status === 200) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(proxied.status, 200);
    assert.equal(await proxied.text(), "mock gateway");

    const bearer = "Bearer durable-device-credential";
    const authCheck = await fetch(`${base}/auth-check`, { headers: { authorization: bearer } });
    assert.equal((await authCheck.json()).authorization, bearer);
    const basicCheck = await fetch(`${base}/auth-check`, { headers: { authorization: auth } });
    assert.equal((await basicCheck.json()).authorization, null);

    const doctor = await fetch(`${base}/setup/api/action`, {
      method: "POST", headers: { cookie: sessionCookie, origin: "https://example.test", "content-type": "application/json" }, body: JSON.stringify({ action: "doctor" }),
    });
    assert.equal(doctor.status, 200);
    const doctorBody = await doctor.json();
    assert.equal(doctorBody.kind, "doctor");
    assert.equal(doctorBody.ok, false);

    const containerStatus = await fetch(`${base}/setup/api/action`, {
      method: "POST", headers: { cookie: sessionCookie, origin: "https://example.test", "content-type": "application/json" }, body: JSON.stringify({ action: "status" }),
    });
    assert.equal(containerStatus.status, 200);
    assert.equal((await containerStatus.json()).kind, "container-status");

    const commandLog = fs.readFileSync(process.env.MOCK_COMMAND_LOG, "utf8");
    assert.match(commandLog, /plugins\.entries\.device-pair\.config\.publicUrl/);
    assert.doesNotMatch(commandLog, /\["secrets"/);

    assert.equal(await websocketStatus(port), 101);
    assert.equal(await websocketStatus(port, bearer), 101);
  } finally {
    await app.close();
    process.env = original;
    fs.rmSync(root, { recursive: true, force: true });
  }
});