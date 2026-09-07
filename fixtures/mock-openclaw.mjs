import http from "node:http";

if (process.argv.includes("--version")) {
  console.log("OpenClaw 2026.9.2");
  process.exit(0);
}

if (process.argv.includes("doctor")) {
  console.log(JSON.stringify({ ok: true, mock: true }));
  process.exit(0);
}

if (process.argv.includes("config")) {
  console.log("mock config updated");
  process.exit(0);
}

if (process.argv.includes("devices") && process.argv.includes("list") && process.argv.includes("--json")) {
  console.log(JSON.stringify({ pending: [{ requestId: "test-request", deviceId: "test-device", remoteIp: "192.0.2.10" }], paired: [] }));
  process.exit(0);
}

if (process.argv.includes("status") || process.argv.includes("list") || process.argv.includes("approve")) {
  console.log("mock command ok");
  process.exit(0);
}

const index = process.argv.indexOf("--port");
const port = Number.parseInt(process.argv[index + 1], 10);
const server = http.createServer((req, res) => {
  if (["/startupz", "/healthz", "/readyz"].includes(req.url)) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end('{"ok":true}');
  }
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("mock gateway");
});
server.on("upgrade", (_req, socket) => {
  socket.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n");
});
server.listen(port, "127.0.0.1");
