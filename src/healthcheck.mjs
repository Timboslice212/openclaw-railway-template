const port = Number.parseInt(process.env.PORT || "8080", 10);

try {
  const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
    signal: AbortSignal.timeout(3_000),
  });
  process.exit(response.ok ? 0 : 1);
} catch {
  process.exit(1);
}
