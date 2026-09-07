import { defineRailway, github, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const data = volume("openclaw-data", {
    region: "us-east4",
    sizeMB: 1024,
  });

  const openclaw = service("openclaw", {
    source: github("Timboslice212/openclaw-railway-template", { branch: "main" }),
    healthcheck: "/healthz",
    healthcheckTimeout: 300,
    volumeMounts: {
      "/data": data,
    },
    env: {
      SETUP_PASSWORD: preserve(),
      OPENCLAW_STATE_DIR: "/data/.openclaw",
      OPENCLAW_WORKSPACE_DIR: "/data/workspace",
      OPENCLAW_INTERNAL_GATEWAY_HOST: "127.0.0.1",
      OPENCLAW_INTERNAL_GATEWAY_PORT: "18789",
      OPENCLAW_VOLUME_ROOT: "/data",
      XDG_CONFIG_HOME: "/data/.config",
      XDG_CACHE_HOME: "/data/.cache",
    },
  });

  return project("openclaw", {
    resources: [openclaw, data],
  });
});
