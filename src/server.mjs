import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { dashboardHtml, errorHtml } from "./dashboard.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const redact = (text, secrets = []) => {
  let result = String(text ?? "");
  for (const secret of secrets.filter(Boolean)) result = result.replaceAll(secret, "[REDACTED]");
  return result.slice(0, 60_000);
};

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
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
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

export function createRuntime(env = process.env) {
  const publicPort = parsePort(env.PORT, 8080);
  const gatewayPort = parsePort(env.OPENCLAW_INTERNAL_GATEWAY_PORT, 18_789);
  const gatewayHost = env.OPENCLAW_INTERNAL_GATEWAY_HOST || "127.0.0.1";
  const stateDir = env.OPENCLAW_STATE_DIR || "/data/.openclaw";
  const workspaceDir = env.OPENCLAW_WORKSPACE_DIR || "/data/workspace";
  const configDir = env.XDG_CONFIG_HOME || "/data/.config";
  const setupPassword = env.SETUP_PASSWORD?.trim() || "";
  const tokenFile = path.join(stateDir, "railway-gateway.token");

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
    publicPort, gatewayPort, gatewayHost, stateDir, workspaceDir, configDir,
    setupPassword, gatewayToken, gateway: null, gatewayStart: null,
    lastGatewayError: null, lastGatewayExit: null, version: null,
  };
}

function command(runtime, args, { timeoutMs = 120_000 } = {}) {
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
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const collect = (chunk) => { output += chunk.toString(); };
    child.stdout.on("data", collect); child.stderr.on("data", collect);
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.on("error", (error) => { clearTimeout(timer); resolve({ code: -1, output: String(error) }); });
    child.on("exit", (code, signal) => { clearTimeout(timer); resolve({ code: code ?? -1, signal, output: redact(output, [runtime.gatewayToken]) }); });
  });
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

function authorized(req, runtime) {
  if (!runtime.setupPassword) return false;
  const [scheme, encoded] = String(req.headers.authorization || "").split(" ");
  if (scheme !== "Basic" || !encoded) return false;
  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const colon = decoded.indexOf(":");
    return safeEqual(colon >= 0 ? decoded.slice(colon + 1) : "", runtime.setupPassword);
  } catch { return false; }
}

function challenge(res) {
  res.writeHead(401, { "www-authenticate": 'Basic realm="OpenClaw Railway"', "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
  res.end("Authentication required\n");
}

function proxyHeaders(req, runtime) {
  const headers = { ...req.headers, host: `${runtime.gatewayHost}:${runtime.gatewayPort}` };
  for (const name of ["authorization", "proxy-authorization", "connection", "forwarded", "x-forwarded-for", "x-real-ip"]) {
    delete headers[name];
  }

  // The wrapper is the Gateway's only trusted proxy. Rebuild attribution from
  // the TCP peer instead of forwarding client-controlled proxy headers.
  const peer = String(req.socket.remoteAddress || "").replace(/^::ffff:/, "");
  headers["x-forwarded-for"] = peer && peer !== "127.0.0.1" && peer !== "::1" ? peer : "192.0.2.1";
  headers["x-forwarded-host"] = String(req.headers.host || "");
  headers["x-forwarded-proto"] = "https";
  if (headers.origin) headers.origin = `http://${runtime.gatewayHost}:${runtime.gatewayPort}`;
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
    if (url.pathname === "/healthz") {
      return json(res, 200, { ok: true, wrapper: "ready", gateway: await gatewayReady(runtime), version: runtime.version });
    }
    if (url.pathname === "/readyz") {
      const ready = await gatewayReady(runtime);
      return json(res, ready ? 200 : 503, { ok: ready, gateway: ready });
    }
    if (url.pathname === "/") {
      res.writeHead(302, { location: "/setup", "cache-control": "no-store" }); return res.end();
    }
    if (url.pathname.startsWith("/setup")) {
      if (!runtime.setupPassword) return html(res, 503, errorHtml("SETUP_PASSWORD is required", "Add SETUP_PASSWORD as a Railway service variable, then redeploy. The control center is intentionally locked until this secret exists."));
      if (!authorized(req, runtime)) return challenge(res);
      if (req.method === "GET" && url.pathname === "/setup") return html(res, 200, dashboardHtml());
      if (req.method === "GET" && url.pathname === "/setup/api/token") return json(res, 200, { ok: true, token: runtime.gatewayToken });
      if (req.method === "GET" && url.pathname === "/setup/api/status") {
        if (!runtime.version) {
          const result = await command(runtime, ["--version"], { timeoutMs: 15_000 });
          runtime.version = result.code === 0 ? result.output.trim() : "Unavailable";
        }
        let storageWritable = true;
        try { fs.accessSync(runtime.stateDir, fs.constants.W_OK); fs.accessSync(runtime.workspaceDir, fs.constants.W_OK); } catch { storageWritable = false; }
        return json(res, 200, { ok: true, version: runtime.version, storageWritable, gateway: { ready: await gatewayReady(runtime), lastError: runtime.lastGatewayError, lastExit: runtime.lastGatewayExit } });
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
    if (!authorized(req, runtime)) return challenge(res);
    if (!(await gatewayReady(runtime))) {
      try { await startGateway(runtime); } catch {}
    }
    if (!(await gatewayReady(runtime))) return html(res, 503, errorHtml("OpenClaw Gateway is not ready", `${runtime.lastGatewayError || "The gateway has not passed its startup probe."}\n\nOpen /setup to run Doctor and inspect status.`));
    return proxyHttp(req, res, runtime);
  });

  server.on("upgrade", async (req, socket, head) => {
    if (!authorized(req, runtime)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm="OpenClaw Railway"\r\nConnection: close\r\n\r\n');
      return socket.destroy();
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
