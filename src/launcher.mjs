import fs from "node:fs";

const stateDir = process.env.OPENCLAW_STATE_DIR || "/data/.openclaw";
const workspaceDir = process.env.OPENCLAW_WORKSPACE_DIR || "/data/workspace";
const configRoot = process.env.XDG_CONFIG_HOME || "/data/.config";
const configDir = `${configRoot}/openclaw`;
const cacheRoot = process.env.XDG_CACHE_HOME || "/data/.cache";
const volumeRoot = process.env.OPENCLAW_VOLUME_ROOT || "/data";

const describe = (directory) => {
  try {
    const stat = fs.statSync(directory);
    return `${directory} uid=${stat.uid} gid=${stat.gid} mode=${(stat.mode & 0o777).toString(8)}`;
  } catch (error) {
    return `${directory} unavailable (${error.code || error.message})`;
  }
};

console.log(`[launcher] starting uid=${process.getuid?.()} gid=${process.getgid?.()}`);

if (process.getuid?.() === 0) {
  // Railway mounts the volume root as root-only on a fresh deployment. The
  // non-root runtime must be able to traverse it before any child path works.
  fs.mkdirSync(volumeRoot, { recursive: true, mode: 0o700 });
  fs.chownSync(volumeRoot, 1000, 1000);
  fs.chmodSync(volumeRoot, 0o700);

  for (const directory of [stateDir, workspaceDir, configRoot, configDir, cacheRoot]) {
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

process.env.HOME = process.env.OPENCLAW_RUNTIME_HOME || "/home/node";
process.env.XDG_CACHE_HOME = cacheRoot;

console.log(`[launcher] runtime uid=${process.getuid?.()} gid=${process.getgid?.()}`);
for (const directory of [volumeRoot, stateDir, workspaceDir, configRoot, configDir, cacheRoot]) {
  console.log(`[launcher] ${describe(directory)}`);
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
