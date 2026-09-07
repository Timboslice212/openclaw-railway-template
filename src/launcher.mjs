import fs from "node:fs";

const stateDir = process.env.OPENCLAW_STATE_DIR || "/data/.openclaw";
const workspaceDir = process.env.OPENCLAW_WORKSPACE_DIR || "/data/workspace";
const configDir = `${process.env.XDG_CONFIG_HOME || "/data/.config"}/openclaw`;

if (process.getuid?.() === 0) {
  for (const directory of [stateDir, workspaceDir, configDir]) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.chownSync(directory, 1000, 1000);
    fs.chmodSync(directory, 0o700);
  }

  // Railway volumes are mounted as root. Drop every root credential before
  // importing the HTTP server or spawning the OpenClaw Gateway.
  process.setgroups([]);
  process.setgid(1000);
  process.setuid(1000);
}

const { createRuntime, startServer } = await import("./server.mjs");
const runtime = createRuntime();
const app = await startServer(runtime);

const shutdown = async () => {
  await app.close();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
