import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { dashboardHtml, errorHtml, loginHtml } from "./dashboard.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const redact = (text, secrets = []) => {
  let result = String(text ?? "");
  for (const secret of secrets.filter(Boolean)) result = result.replaceAll(secret, "[REDACTED]");
  return result.slice(0, 60_000);
};

const PROVIDERS = Object.freeze({
  openai: { authChoice: "openai-api-key", envVar: "OPENAI_API_KEY" },
  anthropic: { authChoice: "anthropic-api-key", envVar: "ANTHROPIC_API_KEY" },
  google: { authChoice: "gemini-api-key", envVar: "GEMINI_API_KEY" },
  openrouter: { authChoice: "openrouter-api-key", envVar: "OPENROUTER_API_KEY" },
  xai: { authChoice: "xai-api-key", envVar: "XAI_API_KEY" },
});
const CHANNELS = new Set(["telegram", "discord"]);

export function parsePort(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : fallback;
}

export function safeEqual(left, right) {
  const a = Buffer.from(String(left ?? ""));
  const b = Buffer.from(String(right ?? ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" });
  res.end(JSON.stringify(body));
}

function html(res, status, body) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
  });
  res.end(body);
}

async function readJson(req, maxBytes = 16_384) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function readForm(req, maxBytes = 8_192) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

export function createRuntime(env = process.env) {
  const publicPort = parsePort(env.PORT, 8080);
  const gatewayPort = parsePort(env.OPENCLAW_INTERNAL_GATEWAY_PORT, 18_789);
  const gatewayHost = env.OPENCLAW_INTERNAL_GATEWAY_HOST || "127.0.0.1";
  const stateDir = env.OPENCLAW_STATE_DIR || "/data/.openclaw";
  const workspaceDir = env.OPENCLAW_WORKSPACE_DIR || "/data/workspace";
  const configDir = env.XDG_CONFIG_HOME || "/data/.config";
  const setupPassword = env.SETUP_PASSWORD?.trim() || "";
  const publicOrigin = (env.OPENCLAW_PUBLIC_ORIGIN?.trim() || (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : "")).replace(/\/$/, "");
  const tokenFile = path.join(stateDir, "railway-gateway.token");
  const setupStateFile = path.join(stateDir, "railway-setup.json");

  for (const directory of [stateDir, workspaceDir, path.join(configDir, "openclaw")]) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }

  let gatewayToken = env.OPENCLAW_GATEWAY_TOKEN?.trim() || "";
  if (!gatewayToken) {
    try { gatewayToken = fs.readFileSync(tokenFile, "utf8").trim(); } catch {}
  }
  if (!gatewayToken) {
    gatewayToken = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(tokenFile, `${gatewayToken}\n`, { mode: 0o600 });
  }

  return {
    publicPort, gatewayPort, gatewayHost, stateDir, workspaceDir, configDir, publicOrigin,
    volumeMountPath: env.RAILWAY_VOLUME_MOUNT_PATH?.trim() || "",
    setupStateFile,
    setupPassword, gatewayToken, gateway: null, gatewayStart: null, loginFailures: new Map(),
    setupRun: null, lastGatewayError: null, lastGatewayExit: null, version: null,
  };
}

function command(runtime, args, { timeoutMs = 120_000, env = {}, secrets = [] } = {}) {
  const executable = process.env.OPENCLAW_NODE || "node";
  const entry = process.env.OPENCLAW_ENTRY || "/app/openclaw.mjs";
  return new Promise((resolve) => {
    const child = spawn(executable, [entry, ...args], {
      env: {
        ...process.env,
        OPENCLAW_STATE_DIR: runtime.stateDir,
        OPENCLAW_WORKSPACE_DIR: runtime.workspaceDir,
        OPENCLAW_GATEWAY_TOKEN: runtime.gatewayToken,
        XDG_CONFIG_HOME: runtime.configDir,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const collect = (chunk) => { output += chunk.toString(); };
    child.stdout.on("data", collect); child.stderr.on("data", collect);
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.on("error", (error) => { clearTimeout(timer); resolve({ code: -1, output: String(error) }); });
    child.on("exit", (code, signal) => { clearTimeout(timer); resolve({ code: code ?? -1, signal, output: redact(output, [runtime.gatewayToken, ...secrets]) }); });
  });
}

function readSetupState(runtime) {
  try { return JSON.parse(fs.readFileSync(runtime.setupStateFile, "utf8")); }
  catch { return { status: "new", step: "preflight" }; }
}

function writeSetupState(runtime, patch) {
  const next = { ...readSetupState(runtime), ...patch, updatedAt: new Date().toISOString() };
  const temporary = `${runtime.setupStateFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, runtime.setupStateFile);
  return next;
}

function storageStatus(runtime) {
  let writable = true;
  try { fs.accessSync(runtime.stateDir, fs.constants.W_OK); fs.accessSync(runtime.workspaceDir, fs.constants.W_OK); }
  catch { writable = false; }
  const persistent = runtime.volumeMountPath === "/data";
  return { writable, persistent, mountPath: runtime.volumeMountPath || null };
}

function parseJsonOutput(output) {
  const text = String(output || "").trim();
  try { return JSON.parse(text); } catch {}
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
  throw new Error("OpenClaw did not return valid JSON");
}

async function gatewayReady(runtime) {
  try {
    const response = await fetch(`http://${runtime.gatewayHost}:${runtime.gatewayPort}/startupz`, { signal: AbortSignal.timeout(1_500) });
    return response.ok;
  } catch { return false; }
}

async function configureGateway(runtime) {
  const settings = [
    ["gateway.trustedProxies", '["127.0.0.1"]', "--strict-json"],
    ["gateway.controlUi.basePath", "/openclaw"],
  ];
  if (runtime.publicOrigin) {
    settings.push(["gateway.controlUi.allowedOrigins", JSON.stringify([runtime.publicOrigin]), "--strict-json"]);
    settings.push(["gateway.publicOrigin", runtime.publicOrigin]);
  }
  for (const args of settings) {
    const result = await command(runtime, ["config", "set", ...args], { timeoutMs: 30_000 });
    if (result.code !== 0) throw new Error(`Could not configure ${args[0]}: ${result.output}`);
  }
}

async function startGateway(runtime) {
  if (runtime.gateway && runtime.gateway.exitCode === null) return;
  if (runtime.gatewayStart) return runtime.gatewayStart;
  runtime.gatewayStart = (async () => {
    runtime.lastGatewayError = null;
    await configureGateway(runtime);
    const executable = process.env.OPENCLAW_NODE || "node";
    const entry = process.env.OPENCLAW_ENTRY || "/app/openclaw.mjs";
    const args = [entry, "gateway", "run", "--allow-unconfigured", "--bind", "loopback", "--port", String(runtime.gatewayPort), "--auth", "token", "--token", runtime.gatewayToken];
    const child = spawn(executable, args, {
      env: {
        ...process.env,
        OPENCLAW_STATE_DIR: runtime.stateDir,
        OPENCLAW_WORKSPACE_DIR: runtime.workspaceDir,
        OPENCLAW_GATEWAY_TOKEN: runtime.gatewayToken,
        XDG_CONFIG_HOME: runtime.configDir,
      },
      stdio: "inherit",
    });
    runtime.gateway = child;
    child.on("error", (error) => { runtime.lastGatewayError = String(error); });
    child.on("exit", (code, signal) => {
      runtime.lastGatewayExit = { code, signal, at: new Date().toISOString() };
      runtime.gateway = null;
    });
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      if (await gatewayReady(runtime)) return;
      if (!runtime.gateway) break;
      await sleep(300);
    }
    throw new Error("OpenClaw Gateway did not pass /startupz within 45 seconds");
  })().catch((error) => {
    runtime.lastGatewayError = String(error);
    throw error;
  }).finally(() => { runtime.gatewayStart = null; });
  return runtime.gatewayStart;
}

async function restartGateway(runtime) {
  if (runtime.gateway) {
    runtime.gateway.kill("SIGTERM");
    const deadline = Date.now() + 8_000;
    while (runtime.gateway && Date.now() < deadline) await sleep(100);
    if (runtime.gateway) runtime.gateway.kill("SIGKILL");
  }
  return startGateway(runtime);
}

async function stopGateway(runtime) {
  if (!runtime.gateway) return;
  runtime.gateway.kill("SIGTERM");
  const deadline = Date.now() + 10_000;
  while (runtime.gateway && Date.now() < deadline) await sleep(100);
  if (runtime.gateway) runtime.gateway.kill("SIGKILL");
  while (runtime.gateway && Date.now() < deadline + 2_000) await sleep(100);
}

async function runFirstSetup(runtime, input) {
  if (runtime.setupRun) throw new Error("Setup is already running");
  if (readSetupState(runtime).status === "complete") throw new Error("First-run setup is already complete; use the OpenClaw dashboard to change providers or channels");
  const provider = String(input.provider || "").toLowerCase();
  const providerConfig = PROVIDERS[provider];
  const apiKey = String(input.apiKey || "").trim();
  const model = String(input.model || "").trim();
  const channel = String(input.channel || "none").toLowerCase();
  const channelToken = String(input.channelToken || "").trim();
  if (!providerConfig) throw new Error("Choose a supported AI provider");
  if (apiKey.length < 8 || apiKey.length > 16_384) throw new Error("Enter a valid provider API key");
  if (model && (!/^[A-Za-z0-9._:/+-]{2,240}$/.test(model) || !model.startsWith(`${provider}/`))) {
    throw new Error(`Model must use the ${provider}/model-id format`);
  }
  if (channel !== "none" && !CHANNELS.has(channel)) throw new Error("Choose a supported channel");
  if (channel !== "none" && (channelToken.length < 8 || channelToken.length > 4_096)) throw new Error(`Enter a valid ${channel} bot token`);
  const storage = storageStatus(runtime);
  if (!storage.persistent || !storage.writable) throw new Error("A writable Railway volume mounted at /data is required before setup can continue");
  if (!runtime.publicOrigin) throw new Error("A Railway public domain is required before setup can continue");

  runtime.setupRun = (async () => {
    writeSetupState(runtime, { status: "running", step: "provider", error: null });
    await stopGateway(runtime);
    const onboarding = await command(runtime, [
      "onboard", "--non-interactive", "--accept-risk",
      "--auth-choice", providerConfig.authChoice,
      "--secret-input-mode", "plaintext",
      "--workspace", runtime.workspaceDir,
      "--gateway-bind", "loopback",
      "--gateway-port", String(runtime.gatewayPort),
      "--gateway-auth", "token",
      "--gateway-token", runtime.gatewayToken,
      "--no-install-daemon", "--skip-channels", "--skip-skills", "--skip-search",
      "--skip-health", "--skip-ui", "--suppress-gateway-token-output", "--json",
    ], { timeoutMs: 180_000, env: { [providerConfig.envVar]: apiKey }, secrets: [apiKey] });
    if (onboarding.code !== 0) throw new Error(`Provider setup failed: ${onboarding.output || `exit ${onboarding.code}`}`);

    if (model) {
      writeSetupState(runtime, { step: "model" });
      const selected = await command(runtime, ["models", "set", model], { timeoutMs: 60_000 });
      if (selected.code !== 0) throw new Error(`Model selection failed: ${selected.output}`);
    }

    if (channel !== "none") {
      writeSetupState(runtime, { step: "channel" });
      const added = await command(runtime, ["channels", "add", "--channel", channel, "--token", channelToken], { timeoutMs: 90_000, secrets: [channelToken] });
      if (added.code !== 0) throw new Error(`${channel} setup failed: ${added.output}`);
    }

    writeSetupState(runtime, { step: "validation" });
    const validation = await command(runtime, ["config", "validate", "--json"], { timeoutMs: 60_000 });
    if (validation.code !== 0) throw new Error(`OpenClaw configuration is invalid: ${validation.output}`);
    const modelStatus = await command(runtime, [
      "models", "status", "--probe", "--check", "--probe-provider", provider,
      "--probe-timeout", "30000", "--probe-max-tokens", "8", "--json",
    ], { timeoutMs: 60_000 });
    if (modelStatus.code !== 0) throw new Error(`Model readiness check failed: ${modelStatus.output}`);

    writeSetupState(runtime, { step: "gateway" });
    await startGateway(runtime);
    if (channel !== "none") {
      const channelStatus = await command(runtime, ["channels", "status", "--channel", channel, "--probe", "--timeout", "15000", "--json"], { timeoutMs: 30_000 });
      if (channelStatus.code !== 0) throw new Error(`${channel} validation failed: ${channelStatus.output}`);
    }
    return writeSetupState(runtime, {
      status: "complete", step: "complete", completedAt: new Date().toISOString(),
      provider, model: model || null, channel: channel === "none" ? null : channel,
    });
  })().catch((error) => {
    writeSetupState(runtime, { status: "failed", error: redact(String(error), [apiKey, channelToken]) });
    throw error;
  }).finally(() => { runtime.setupRun = null; });
  return runtime.setupRun;
}

async function createBrowserHandoff(runtime) {
  await startGateway(runtime);
  const result = await command(runtime, ["dashboard", "--json", "--no-open"], { timeoutMs: 30_000 });
  if (result.code !== 0) throw new Error(result.output || "OpenClaw could not create a browser handoff");
  const handoff = parseJsonOutput(result.output);
  if (!handoff.ok && handoff.reason) throw new Error(String(handoff.reason));
  if (!handoff.browserUrl) throw new Error("OpenClaw did not return a browser handoff URL");
  const source = new URL(handoff.browserUrl);
  const target = new URL("/openclaw/", `${runtime.publicOrigin}/`);
  const fragment = new URLSearchParams(source.hash.slice(1));
  const gatewayUrl = new URL("/openclaw", `${runtime.publicOrigin}/`);
  gatewayUrl.protocol = gatewayUrl.protocol === "https:" ? "wss:" : "ws:";
  fragment.set("gatewayUrl", gatewayUrl.toString());
  target.hash = fragment.toString();
  return { url: target.toString(), expiresAtMs: handoff.browserBootstrapExpiresAtMs || null };
}

function requestOriginAllowed(req, runtime) {
  const origin = String(req.headers.origin || "");
  if (!origin) return true;
  const expected = runtime.publicOrigin || `http://${req.headers.host || "localhost"}`;
  return origin === expected;
}

function authorized(req, runtime) {
  if (!runtime.setupPassword) return false;
  const cookies = Object.fromEntries(String(req.headers.cookie || "").split(";").map((part) => part.trim().split(/=(.*)/s).slice(0, 2)).filter(([name]) => name));
  const expectedSession = crypto.createHmac("sha256", runtime.setupPassword).update("openclaw-railway-session-v1").digest("hex");
  if (cookies["__Host-oc_setup_session"] && safeEqual(cookies["__Host-oc_setup_session"], expectedSession)) return true;
  const [scheme, encoded] = String(req.headers.authorization || "").split(" ");
  if (scheme !== "Basic" || !encoded) return false;
  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const colon = decoded.indexOf(":");
    return safeEqual(colon >= 0 ? decoded.slice(colon + 1) : "", runtime.setupPassword);
  } catch { return false; }
}

function challenge(req, res) {
  if (String(req.url || "").startsWith("/setup/api/")) return json(res, 401, { ok: false, error: "Setup session expired" });
  res.writeHead(302, { location: `/login?next=${encodeURIComponent(String(req.url || "/setup"))}`, "cache-control": "no-store" });
  res.end();
}

function proxyHeaders(req, runtime) {
  const headers = { ...req.headers, host: `${runtime.gatewayHost}:${runtime.gatewayPort}` };
  for (const name of ["authorization", "proxy-authorization", "cookie", "connection", "forwarded", "x-forwarded-for", "x-real-ip"]) {
    delete headers[name];
  }

  // The wrapper is the Gateway's only trusted proxy. Rebuild attribution from
  // the TCP peer instead of forwarding client-controlled proxy headers.
  const peer = String(req.socket.remoteAddress || "").replace(/^::ffff:/, "");
  headers["x-forwarded-for"] = peer && peer !== "127.0.0.1" && peer !== "::1" ? peer : "192.0.2.1";
  headers["x-forwarded-host"] = String(req.headers.host || "");
  headers["x-forwarded-proto"] = "https";
  return headers;
}

function proxyHttp(req, res, runtime) {
  const headers = proxyHeaders(req, runtime);
  const upstream = http.request({ hostname: runtime.gatewayHost, port: runtime.gatewayPort, path: req.url, method: req.method, headers }, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
    upstreamRes.pipe(res);
  });
  upstream.on("error", (error) => html(res, 503, errorHtml("OpenClaw Gateway unavailable", `${error.message}\n\nOpen /setup to run diagnostics.`)));
  req.pipe(upstream);
}

function proxyUpgrade(req, socket, head, runtime) {
  const headers = proxyHeaders(req, runtime);
  headers.connection = "Upgrade";
  headers.upgrade = "websocket";
  const upstream = http.request({ hostname: runtime.gatewayHost, port: runtime.gatewayPort, path: req.url, method: req.method, headers });
  upstream.on("upgrade", (response, upstreamSocket, upstreamHead) => {
    let raw = `HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n`;
    for (const [name, value] of Object.entries(response.headers)) raw += `${name}: ${Array.isArray(value) ? value.join(", ") : value}\r\n`;
    socket.write(`${raw}\r\n`);
    if (head.length) upstreamSocket.write(head);
    if (upstreamHead.length) socket.write(upstreamHead);
    socket.pipe(upstreamSocket).pipe(socket);
  });
  upstream.on("response", (response) => { socket.write(`HTTP/1.1 ${response.statusCode || 502} Bad Gateway\r\nConnection: close\r\n\r\n`); socket.destroy(); });
  upstream.on("error", () => socket.destroy());
  upstream.end();
}

export async function startServer(runtime = createRuntime()) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname === "/login" && req.method === "GET") {
      if (authorized(req, runtime)) { res.writeHead(302, { location: "/setup", "cache-control": "no-store" }); return res.end(); }
      return html(res, 200, loginHtml());
    }
    if (url.pathname === "/login" && req.method === "POST") {
      try {
        const peer = String(req.socket.remoteAddress || "unknown");
        const recent = (runtime.loginFailures.get(peer) || []).filter((time) => Date.now() - time < 600_000);
        if (recent.length >= 5) return html(res, 429, loginHtml("Too many attempts. Wait ten minutes and try again."));
        const form = await readForm(req);
        if (!safeEqual(form.get("password") || "", runtime.setupPassword)) {
          runtime.loginFailures.set(peer, [...recent, Date.now()]);
          return html(res, 401, loginHtml("Incorrect setup password."));
        }
        runtime.loginFailures.delete(peer);
        const session = crypto.createHmac("sha256", runtime.setupPassword).update("openclaw-railway-session-v1").digest("hex");
        res.writeHead(302, { location: "/setup", "set-cookie": `__Host-oc_setup_session=${session}; Path=/; Max-Age=43200; HttpOnly; Secure; SameSite=Strict`, "cache-control": "no-store" });
        return res.end();
      } catch (error) { return html(res, 400, loginHtml(String(error))); }
    }
    if (url.pathname === "/logout") {
      res.writeHead(302, { location: "/login", "set-cookie": "__Host-oc_setup_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict", "cache-control": "no-store" });
      return res.end();
    }
    if (url.pathname === "/healthz") {
      return json(res, 200, { ok: true, wrapper: "ready", gateway: await gatewayReady(runtime), version: runtime.version });
    }
    if (url.pathname === "/readyz") {
      const ready = await gatewayReady(runtime);
      return json(res, ready ? 200 : 503, { ok: ready, gateway: ready });
    }
    if (url.pathname === "/") {
      const destination = readSetupState(runtime).status === "complete" ? "/openclaw/" : "/setup";
      res.writeHead(302, { location: destination, "cache-control": "no-store" }); return res.end();
    }
    if (url.pathname.startsWith("/setup")) {
      if (!runtime.setupPassword) return html(res, 503, errorHtml("SETUP_PASSWORD is required", "Add SETUP_PASSWORD as a Railway service variable, then redeploy. The control center is intentionally locked until this secret exists."));
      if (runtime.setupPassword.length < 12) return html(res, 503, errorHtml("SETUP_PASSWORD is too short", "Choose at least 12 characters in the Railway service variable, then redeploy."));
      if (!authorized(req, runtime)) return challenge(req, res);
      if (req.method === "POST" && !requestOriginAllowed(req, runtime)) return json(res, 403, { ok: false, error: "Invalid request origin" });
      if (req.method === "GET" && url.pathname === "/setup") return html(res, 200, dashboardHtml());
      if (req.method === "GET" && url.pathname === "/setup/api/status") {
        if (!runtime.version) {
          const result = await command(runtime, ["--version"], { timeoutMs: 15_000 });
          runtime.version = result.code === 0 ? result.output.trim() : "Unavailable";
        }
        return json(res, 200, {
          ok: true, version: runtime.version, storage: storageStatus(runtime), publicOrigin: runtime.publicOrigin || null,
          setup: readSetupState(runtime), providers: Object.keys(PROVIDERS), channels: [...CHANNELS],
          gateway: { ready: await gatewayReady(runtime), lastError: runtime.lastGatewayError, lastExit: runtime.lastGatewayExit },
        });
      }
      if (req.method === "POST" && url.pathname === "/setup/api/install") {
        try { const state = await runFirstSetup(runtime, await readJson(req, 32_768)); return json(res, 200, { ok: true, setup: state }); }
        catch (error) { return json(res, 400, { ok: false, error: redact(String(error), []) }); }
      }
      if (req.method === "POST" && url.pathname === "/setup/api/handoff") {
        try { return json(res, 200, { ok: true, ...(await createBrowserHandoff(runtime)) }); }
        catch (error) { return json(res, 500, { ok: false, error: String(error) }); }
      }
      if (req.method === "GET" && url.pathname === "/setup/api/devices") {
        const result = await command(runtime, ["devices", "list", "--json"]);
        if (result.code !== 0) return json(res, 500, { ok: false, error: result.output || "Could not list devices" });
        try {
          const list = JSON.parse(result.output);
          const pending = Array.isArray(list.pending) ? list.pending.map((device) => ({
            requestId: String(device.requestId || ""),
            deviceId: String(device.deviceId || ""),
            remoteIp: device.remoteIp ? String(device.remoteIp) : null,
          })).filter((device) => /^[A-Za-z0-9_-]{4,200}$/.test(device.requestId)) : [];
          return json(res, 200, { ok: true, pending });
        } catch { return json(res, 500, { ok: false, error: "OpenClaw returned invalid device data" }); }
      }
      if (req.method === "POST" && url.pathname === "/setup/api/action") {
        try {
          const { action } = await readJson(req);
          if (action === "restart") { await restartGateway(runtime); return json(res, 200, { ok: true, output: "Gateway restarted and passed /startupz." }); }
          const actions = { version: ["--version"], doctor: ["doctor", "--json"], status: ["gateway", "status"], devices: ["devices", "list"] };
          if (!actions[action]) return json(res, 400, { ok: false, error: "Action is not allowed" });
          const result = await command(runtime, actions[action]);
          return json(res, result.code === 0 ? 200 : 500, { ok: result.code === 0, output: result.output || `Command exited with code ${result.code}` });
        } catch (error) { return json(res, 500, { ok: false, error: String(error) }); }
      }
      if (req.method === "POST" && url.pathname === "/setup/api/devices/approve") {
        try {
          const { requestId } = await readJson(req);
          if (!/^[A-Za-z0-9_-]{4,200}$/.test(String(requestId || ""))) return json(res, 400, { ok: false, error: "Invalid device request ID" });
          const result = await command(runtime, ["devices", "approve", String(requestId)]);
          return json(res, result.code === 0 ? 200 : 500, { ok: result.code === 0, output: result.output });
        } catch (error) { return json(res, 500, { ok: false, error: String(error) }); }
      }
      return json(res, 404, { ok: false, error: "Not found" });
    }
    if (readSetupState(runtime).status !== "complete") {
      res.writeHead(302, { location: "/setup", "cache-control": "no-store" });
      return res.end();
    }
    if (!(await gatewayReady(runtime))) {
      try { await startGateway(runtime); } catch {}
    }
    if (!(await gatewayReady(runtime))) return html(res, 503, errorHtml("OpenClaw Gateway is not ready", `${runtime.lastGatewayError || "The gateway has not passed its startup probe."}\n\nOpen /setup to run Doctor and inspect status.`));
    return proxyHttp(req, res, runtime);
  });

  server.on("upgrade", async (req, socket, head) => {
    if (readSetupState(runtime).status !== "complete") {
      return socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    }
    if (!(await gatewayReady(runtime))) { try { await startGateway(runtime); } catch {} }
    if (!(await gatewayReady(runtime))) return socket.destroy();
    proxyUpgrade(req, socket, head, runtime);
  });

  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(runtime.publicPort, "0.0.0.0", resolve); });
  console.log(`[railway] control center listening on 0.0.0.0:${runtime.publicPort}`);
  console.log(`[railway] OpenClaw gateway target ${runtime.gatewayHost}:${runtime.gatewayPort}`);
  startGateway(runtime).catch((error) => console.error(`[railway] gateway startup failed: ${redact(error, [runtime.gatewayToken])}`));

  const close = async () => {
    if (runtime.gateway) runtime.gateway.kill("SIGTERM");
    await new Promise((resolve) => server.close(resolve));
  };
  return { server, close };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const runtime = createRuntime();
  const app = await startServer(runtime);
  const shutdown = async () => { await app.close(); process.exit(0); };
  process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
}
