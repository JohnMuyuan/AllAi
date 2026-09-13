/**
 * AllAi 远程控制中继。部署在你自己的服务器上。
 *
 * 它只做两件事：
 *   1. 提供手机网页（public/ 里的静态文件）；
 *   2. 把手机和电脑之间的消息原样转发。
 *
 * 它**看不到内容**：手机和电脑之间是端到端加密的，这里只经手密文。
 * 也**不存任何东西**：不写数据库、不写文件、不打印消息内容。重启即清空。
 *
 * 电脑来登记时必须带 RELAY_TOKEN，陌生人没法把这里当成自己的中继用。
 * 手机不需要 token —— 它只能找已经在线的电脑，而且没配对过的手机，
 * 电脑那边一条消息都解不开，也不会理。
 */
import { timingSafeEqual } from "crypto";
import fs from "fs";
import http from "http";
import path from "path";
import { WebSocket, WebSocketServer, type RawData } from "ws";

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";
const TOKEN = process.env.RELAY_TOKEN || "";
const PUBLIC_DIR = path.join(__dirname, "public");

/** 单帧上限。图片按块传，一块远小于这个数。 */
const MAX_FRAME = 8 * 1024 * 1024;
/** 一台电脑最多同时连几台手机。 */
const MAX_DEVICES = 32;
/** 一条连接 10 秒内最多多少帧，超了直接断开 —— 防止被人拿来刷流量。 */
const RATE_WINDOW_MS = 10_000;
const RATE_LIMIT = 2_000;
/** 连上来 10 秒内不报身份就踢掉。 */
const HELLO_TIMEOUT_MS = 10_000;

if (TOKEN.length < 16) {
  console.error("[relay] 请设置环境变量 RELAY_TOKEN（至少 16 个字符，建议 32 位随机串）");
  process.exit(1);
}

function sameToken(given: unknown) {
  if (typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ---------------- 静态文件 ---------------- */

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const SECURITY_HEADERS: Record<string, string> = {
  // 只允许加载自己域名下的脚本和样式；图片放行 blob:/data:（电脑传来的图在本地解密成 blob）。
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  // 相机只给自己用：手机网页里的「扫码配对」要开摄像头。
  "Permissions-Policy": "camera=(self), microphone=(), geolocation=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url || "/", "http://relay.local");
  if (url.pathname.endsWith("/healthz")) {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }
  // 支持部署在子路径下（反代到 /allai/ 之类）：只取最后一段文件名。
  let name = path.posix.basename(url.pathname) || "index.html";
  if (!path.extname(name)) name = "index.html";
  const file = path.join(PUBLIC_DIR, name);
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file)) {
    res.writeHead(404, SECURITY_HEADERS);
    res.end("not found");
    return;
  }
  // 页面和版本号一律不许缓存：iPhone 主屏幕 App 对 no-cache 也会用旧的，
  // 只有 no-store 才老实去服务器拿。app.js / app.css 的地址带 ?v=编号，换版本就是新地址。
  const noStore = name === "index.html" || name === "version.json" || name === "manifest.webmanifest";
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
    "Cache-Control": noStore ? "no-store, must-revalidate" : "no-cache",
  });
  fs.createReadStream(file).pipe(res);
}

/* ---------------- 转发 ---------------- */

type Peer = WebSocket & {
  role?: "desktop" | "device";
  desktopId?: string;
  deviceId?: string;
  alive?: boolean;
  frames?: number;
  windowStart?: number;
};

const desktops = new Map<string, Peer>();
const devices = new Map<string, Map<string, Peer>>();

function send(peer: Peer | undefined, payload: Record<string, unknown>) {
  if (!peer || peer.readyState !== WebSocket.OPEN) return;
  peer.send(JSON.stringify(payload));
}

function devicesOf(desktopId: string) {
  let map = devices.get(desktopId);
  if (!map) {
    map = new Map();
    devices.set(desktopId, map);
  }
  return map;
}

function isId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{16,64}$/.test(value);
}

function onHello(peer: Peer, msg: Record<string, unknown>) {
  if (msg.t === "desktop") {
    if (!isId(msg.id) || !sameToken(msg.token)) {
      peer.close(4401, "unauthorized");
      return;
    }
    const id = msg.id;
    desktops.get(id)?.close(4409, "replaced");
    peer.role = "desktop";
    peer.desktopId = id;
    desktops.set(id, peer);
    const online = [...devicesOf(id).keys()];
    send(peer, { t: "ready", devices: online });
    for (const device of devicesOf(id).values()) send(device, { t: "online" });
    console.log(`[relay] desktop online (${desktops.size} desktops)`);
    return;
  }
  if (msg.t === "device") {
    if (!isId(msg.desktop) || !isId(msg.id)) {
      peer.close(4400, "bad hello");
      return;
    }
    const map = devicesOf(msg.desktop);
    if (!map.has(msg.id) && map.size >= MAX_DEVICES) {
      peer.close(4429, "too many devices");
      return;
    }
    map.get(msg.id)?.close(4409, "replaced");
    peer.role = "device";
    peer.desktopId = msg.desktop;
    peer.deviceId = msg.id;
    map.set(msg.id, peer);
    const desktop = desktops.get(msg.desktop);
    send(peer, { t: "ready", online: Boolean(desktop) });
    send(desktop, { t: "open", from: msg.id });
    return;
  }
  peer.close(4400, "bad hello");
}

function onMessage(peer: Peer, raw: RawData) {
  const now = Date.now();
  if (!peer.windowStart || now - peer.windowStart > RATE_WINDOW_MS) {
    peer.windowStart = now;
    peer.frames = 0;
  }
  peer.frames = (peer.frames ?? 0) + 1;
  if (peer.frames > RATE_LIMIT) {
    peer.close(4429, "rate limited");
    return;
  }

  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(raw.toString()) as Record<string, unknown>;
  } catch {
    peer.close(4400, "bad frame");
    return;
  }
  if (!peer.role) {
    onHello(peer, msg);
    return;
  }
  // 应用层心跳：浏览器和 Node 的 WebSocket 都拿不到 ping/pong 帧，只能自己回。
  if (msg.t === "ping") {
    send(peer, { t: "pong" });
    return;
  }

  if (peer.role === "desktop") {
    const map = devicesOf(peer.desktopId!);
    if (msg.t === "send" && typeof msg.to === "string" && typeof msg.d === "string") {
      send(map.get(msg.to), { t: "msg", d: msg.d });
    } else if (msg.t === "kick" && typeof msg.to === "string") {
      map.get(msg.to)?.close(4403, "revoked");
    }
    return;
  }

  if (msg.t === "send" && typeof msg.d === "string") {
    const desktop = desktops.get(peer.desktopId!);
    if (!desktop) {
      send(peer, { t: "offline" });
      return;
    }
    send(desktop, { t: "msg", from: peer.deviceId, d: msg.d });
  }
}

function onClose(peer: Peer) {
  if (peer.role === "desktop" && peer.desktopId && desktops.get(peer.desktopId) === peer) {
    desktops.delete(peer.desktopId);
    for (const device of devicesOf(peer.desktopId).values()) send(device, { t: "offline" });
    console.log(`[relay] desktop offline (${desktops.size} desktops)`);
  }
  if (peer.role === "device" && peer.desktopId && peer.deviceId) {
    const map = devicesOf(peer.desktopId);
    if (map.get(peer.deviceId) === peer) {
      map.delete(peer.deviceId);
      send(desktops.get(peer.desktopId), { t: "close", from: peer.deviceId });
    }
    if (!map.size && !desktops.has(peer.desktopId)) devices.delete(peer.desktopId);
  }
}

const server = http.createServer(serveStatic);
const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "/", "http://relay.local");
  if (!url.pathname.endsWith("/ws")) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

wss.on("connection", (ws: Peer) => {
  ws.alive = true;
  ws.on("pong", () => {
    ws.alive = true;
  });
  const helloTimer = setTimeout(() => {
    if (!ws.role) ws.close(4408, "hello timeout");
  }, HELLO_TIMEOUT_MS);
  ws.on("message", (raw) => onMessage(ws, raw));
  ws.on("close", () => {
    clearTimeout(helloTimer);
    onClose(ws);
  });
  ws.on("error", () => ws.terminate());
});

// 每 25 秒探一次活。1Panel/Nginx 反代默认 60 秒空闲就断，心跳要比它勤。
const heartbeat = setInterval(() => {
  for (const ws of wss.clients as Set<Peer>) {
    if (!ws.alive) {
      ws.terminate();
      continue;
    }
    ws.alive = false;
    ws.ping();
  }
}, 25_000);

server.listen(PORT, HOST, () => {
  console.log(`[relay] listening on ${HOST}:${PORT}`);
});

function shutdown() {
  clearInterval(heartbeat);
  for (const ws of wss.clients) ws.close(1001, "server shutdown");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
