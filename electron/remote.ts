/**
 * 远程控制（电脑这一端）。跑在 Electron 主进程里。
 *
 * 手机 ⇄ 你的中继服务器 ⇄ 这里 ⇄ 界面（渲染进程）
 *
 * - 和中继之间：一条 WebSocket，登记时带中继口令。
 * - 和每台手机之间：端到端加密（见 remote-protocol.ts），中继只转发密文。
 * - 聊天/Agent 的请求大多转给界面去执行，界面把当前状态推回来，这里按消息 id 做差量
 *   再加密发给手机。所以手机上发的消息，电脑屏幕上也看得到。
 * - Agent 打开是例外：每台手机自己盯一条工作的会话文件，不改电脑当前选中的那条。
 * - 创作走本机 HTTP（生成本来就在本机服务里跑），不经过界面。
 *
 * 本机服务（127.0.0.1 上的 Next）没有任何鉴权，**绝不能**让手机直接打到它：
 * 这里只转发白名单里的几个接口，路径参数都做了校验。
 */
import { app, ipcMain, safeStorage, type BrowserWindow } from "electron";
import fs from "fs";
import os from "os";
import path from "path";
import { scanHistory, type AgentMessage, type AgentWork } from "./history";
import { mergeWorks, scanLive } from "./live";
import { startWorkWatch } from "./watch";
import {
  PAIR_TTL_MS,
  SecureChannel,
  fromB64,
  importBaseKey,
  inviteLink,
  openOnce,
  pairingKey,
  randomBytes,
  randomId,
  sealOnce,
  toB64,
  toB64Url,
  type RpcRequest,
} from "./remote-protocol";

/* ---------------- 配置 ---------------- */

export type RemoteCaps = {
  /** 远程发给 Agent 的请求沿用电脑上设的权限模式。关掉则「全部放行」一律降成较安全的档。 */
  followPermission: boolean;
  /** 远程请求可以用管理员身份跑本机 CLI。默认关：等于远程绕过了 UAC 那一下确认。 */
  allowAdmin: boolean;
};

type DeviceRecord = {
  id: string;
  name: string;
  /** 这台手机的长期密钥（包过一层系统加密） */
  key: string;
  createdAt: number;
  lastSeen?: number;
};

type RemoteConfig = {
  enabled: boolean;
  relayUrl: string;
  /** 中继口令（包过一层系统加密） */
  token: string;
  desktopId: string;
  desktopName: string;
  caps: RemoteCaps;
  devices: DeviceRecord[];
};

export type RemoteStatus = {
  state: "off" | "connecting" | "online" | "error";
  error?: string;
  /** 已经握手成功、正在连着的手机 */
  sessions: { id: string; name: string }[];
};

export type RemotePublicConfig = {
  enabled: boolean;
  relayUrl: string;
  hasToken: boolean;
  desktopName: string;
  caps: RemoteCaps;
  devices: { id: string; name: string; createdAt: number; lastSeen?: number }[];
};

function dataDir() {
  return process.env.ALLAI_DATA_DIR || path.join(os.homedir(), ".allai");
}

function configPath() {
  return path.join(dataDir(), "remote.json");
}

/** 密钥和口令落盘前用系统的凭据加密包一层（Windows 上是 DPAPI，换个用户/换台电脑解不开）。 */
function wrapSecret(text: string) {
  if (!text) return "";
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return `enc:${safeStorage.encryptString(text).toString("base64")}`;
    }
  } catch {
    // 退回明文存储（仍然只在本机用户目录里）
  }
  return `raw:${text}`;
}

function unwrapSecret(stored: string) {
  if (!stored) return "";
  if (stored.startsWith("enc:")) {
    return safeStorage.decryptString(Buffer.from(stored.slice(4), "base64"));
  }
  if (stored.startsWith("raw:")) return stored.slice(4);
  return stored;
}

function defaultConfig(): RemoteConfig {
  return {
    enabled: false,
    relayUrl: "",
    token: "",
    desktopId: randomId(16),
    desktopName: os.hostname() || "我的电脑",
    caps: { followPermission: true, allowAdmin: false },
    devices: [],
  };
}

let config: RemoteConfig = defaultConfig();

function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), "utf8")) as Partial<RemoteConfig>;
    const base = defaultConfig();
    config = {
      ...base,
      ...raw,
      caps: { ...base.caps, ...(raw.caps ?? {}) },
      devices: Array.isArray(raw.devices) ? raw.devices : [],
    };
    if (!/^[0-9a-f]{32}$/.test(config.desktopId)) config.desktopId = base.desktopId;
  } catch {
    config = defaultConfig();
    saveConfig();
  }
}

function saveConfig() {
  fs.mkdirSync(dataDir(), { recursive: true });
  const file = configPath();
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
  fs.renameSync(tmp, file);
}

function publicConfig(): RemotePublicConfig {
  return {
    enabled: config.enabled,
    relayUrl: config.relayUrl,
    hasToken: Boolean(config.token),
    desktopName: config.desktopName,
    caps: config.caps,
    devices: config.devices.map(({ id, name, createdAt, lastSeen }) => ({ id, name, createdAt, lastSeen })),
  };
}

/* ---------------- 审计日志 ---------------- */

type AuditEntry = { at: number; device: string; action: string };
const audit: AuditEntry[] = [];

/** 只记「谁、什么时候、做了哪类操作」，**不记内容**。 */
function record(device: string, action: string) {
  audit.unshift({ at: Date.now(), device, action });
  if (audit.length > 200) audit.length = 200;
  try {
    const file = path.join(dataDir(), "remote.log");
    // 审计日志一条操作一行、只增不删。超过 1MB 就留一份上一轮的重新开始，
    // 不然用得久了它会一直长下去。
    try {
      if (fs.statSync(file).size > 1024 * 1024) fs.renameSync(file, `${file}.1`);
    } catch {
      // 还没有这个文件
    }
    fs.appendFileSync(file, `${new Date().toISOString()}\t${device}\t${action}\n`);
  } catch {
    // 日志写不进去不影响功能
  }
}

/* ---------------- 与界面的桥 ---------------- */

let getWindow: () => BrowserWindow | null = () => null;
let getLocalUrl: () => string | null = () => null;

const rendererCalls = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
>();

/** 让界面执行一个操作（切换对话、发送……），等它回话。 */
function callRenderer(op: string, args: unknown, timeoutMs = 60_000) {
  const win = getWindow();
  if (!win || win.isDestroyed()) return Promise.reject(new Error("电脑上的 AllAi 窗口没有打开"));
  const id = randomId(8);
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      rendererCalls.delete(id);
      reject(new Error("电脑端没有响应"));
    }, timeoutMs);
    rendererCalls.set(id, { resolve, reject, timer });
    win.webContents.send("remote:command", { id, op, args });
  });
}

/** 界面推过来的最新状态。threads 是当前打开的聊天和 Agent 工作的消息。 */
type Snapshot = {
  threads?: Record<string, { id: string | null; messages: { id: string }[] }>;
  [key: string]: unknown;
};
let snapshot: Snapshot | null = null;

/* ---------------- 与中继的连接 ---------------- */

type RelaySocket = {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: (() => void) | null;
};

// Electron 44 的 Node 自带标准 WebSocket，不用额外打包 ws。
const WebSocketImpl = (globalThis as unknown as { WebSocket: new (url: string) => RelaySocket }).WebSocket;

let socket: RelaySocket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let retryDelay = 1000;
let lastPong = 0;
let pingTimer: NodeJS.Timeout | null = null;
let status: RemoteStatus = { state: "off", sessions: [] };

type ThreadBaseline = { id: string | null; map: Map<string, string>; order: string };

type Session = {
  deviceId: string;
  channel: SecureChannel;
  verified: boolean;
  meta?: string;
  sent: Record<string, ThreadBaseline | undefined>;
  uploads: Map<string, { name: string; mime: string; chunks: string[]; size: number }>;
  /** 这台手机自己打开的 Agent 工作，不跟电脑当前选中的那条走。 */
  agentWorkId?: string;
  agentWatch?: { close: () => void };
  agentRunning?: boolean;
  /** 这条工作自己的窗口占用（盯文件时 CLI 报的），不是电脑选中那条的。 */
  agentContext?: { tokens: number; window?: number };
};

const sessions = new Map<string, Session>();

function forgetSession(id: string) {
  const session = sessions.get(id);
  if (session) dropSessionAgent(session);
  return sessions.delete(id);
}

/**
 * 清空所有会话。**必须走这里，不要直接 `sessions.clear()`** —— 每台手机打开的
 * Agent 工作都挂着一个 fs.watch（目录 + 若干会话文件）和一个会重新解析整份会话的
 * 回调。直接 clear 掉 Map 只是丢了引用，watcher 还在，而且每次掉线重连都再漏一份：
 * 手机切后台就会重连，漏到后来每写一次会话文件就有一堆解析同时跑。
 */
function clearSessions() {
  for (const session of sessions.values()) dropSessionAgent(session);
  sessions.clear();
}

type Invite = { pairId: string; key: CryptoKey; expiresAt: number };
let invite: Invite | null = null;

function deviceName(id: string) {
  return config.devices.find((item) => item.id === id)?.name || "未知设备";
}

function pushStatus(patch?: Partial<RemoteStatus>) {
  status = {
    ...status,
    ...patch,
    sessions: [...sessions.values()]
      .filter((item) => item.verified)
      .map((item) => ({ id: item.deviceId, name: deviceName(item.deviceId) })),
  };
  const win = getWindow();
  if (win && !win.isDestroyed()) win.webContents.send("remote:status", status);
}

function wsUrl(relayUrl: string) {
  const url = new URL(relayUrl);
  url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/ws`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function relaySend(payload: Record<string, unknown>) {
  if (socket && socket.readyState === 1) socket.send(JSON.stringify(payload));
}

function sendPlain(deviceId: string, message: Record<string, unknown>) {
  relaySend({ t: "send", to: deviceId, d: JSON.stringify({ p: message }) });
}

async function sendSecure(session: Session, payload: unknown) {
  const text = await session.channel.seal(payload);
  // 这台手机中途重新握手了：旧通道的消息发过去它也解不开，丢掉。
  if (sessions.get(session.deviceId) !== session) return;
  relaySend({ t: "send", to: session.deviceId, d: JSON.stringify({ s: text }) });
}

function disconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (pingTimer) clearInterval(pingTimer);
  reconnectTimer = null;
  pingTimer = null;
  const old = socket;
  socket = null;
  old?.close(1000, "bye");
  clearSessions();
}

function scheduleReconnect(delay = retryDelay) {
  if (reconnectTimer || !config.enabled) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
  retryDelay = Math.min(retryDelay * 2, 30_000);
}

function connect() {
  disconnect();
  if (!config.enabled) {
    pushStatus({ state: "off", error: undefined });
    return;
  }
  if (!config.relayUrl || !config.token) {
    pushStatus({ state: "error", error: "还没有填中继地址或口令" });
    return;
  }
  let url: string;
  try {
    url = wsUrl(config.relayUrl);
  } catch {
    pushStatus({ state: "error", error: "中继地址格式不对" });
    return;
  }
  pushStatus({ state: "connecting", error: undefined });
  const ws = new WebSocketImpl(url);
  socket = ws;
  ws.onopen = () => {
    if (socket !== ws) return;
    let token = "";
    try {
      token = unwrapSecret(config.token);
    } catch {
      pushStatus({ state: "error", error: "读不出保存的口令，请重新填写" });
      ws.close();
      return;
    }
    ws.send(JSON.stringify({ t: "desktop", id: config.desktopId, token }));
  };
  ws.onmessage = (event) => {
    if (socket !== ws) return;
    void onRelay(String(event.data));
  };
  ws.onerror = () => undefined;
  ws.onclose = (event) => {
    if (socket !== ws) return;
    socket = null;
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = null;
    clearSessions();
    if (event.code === 4401) {
      pushStatus({ state: "error", error: "中继口令不对（和服务器上的 RELAY_TOKEN 不一致）" });
      scheduleReconnect(60_000);
      return;
    }
    if (event.code === 4409) {
      pushStatus({ state: "error", error: "另一个 AllAi 用同一个身份连上了中继" });
      scheduleReconnect(30_000);
      return;
    }
    pushStatus({ state: "connecting", error: "和中继的连接断了，正在重连…" });
    scheduleReconnect();
  };
}

async function onRelay(raw: string) {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return;
  }
  if (msg.t === "ready") {
    retryDelay = 1000;
    lastPong = Date.now();
    if (pingTimer) clearInterval(pingTimer);
    // 连接假死（中间某个路由器把它丢了但两头都不知道）时靠这个发现：75 秒收不到回音就重连。
    pingTimer = setInterval(() => {
      if (Date.now() - lastPong > 75_000) {
        socket?.close(4000, "ping timeout");
        return;
      }
      relaySend({ t: "ping" });
    }, 25_000);
    pushStatus({ state: "online", error: undefined });
    return;
  }
  if (msg.t === "pong") {
    lastPong = Date.now();
    return;
  }
  if (msg.t === "close" && typeof msg.from === "string") {
    if (forgetSession(msg.from)) pushStatus();
    return;
  }
  if (msg.t !== "msg" || typeof msg.from !== "string" || typeof msg.d !== "string") return;
  const from = msg.from;
  let envelope: { p?: Record<string, unknown>; s?: string };
  try {
    envelope = JSON.parse(msg.d) as typeof envelope;
  } catch {
    return;
  }
  if (typeof envelope.s === "string") {
    const session = sessions.get(from);
    if (!session) {
      sendPlain(from, { op: "reset" });
      return;
    }
    // 这里前面不能有 await：解密计数器依赖收到的顺序。
    const opening = session.channel.open(envelope.s);
    let request: RpcRequest;
    try {
      request = (await opening) as RpcRequest;
    } catch {
      // 解不开：不是配过对的那台手机，或者被重放/篡改了。整条会话作废，让它重新握手。
      forgetSession(from);
      pushStatus();
      sendPlain(from, { op: "reset" });
      return;
    }
    if (!session.verified) {
      session.verified = true;
      const device = config.devices.find((item) => item.id === from);
      if (device) {
        device.lastSeen = Date.now();
        saveConfig();
      }
      record(deviceName(from), "连上了");
      pushStatus();
    }
    void handleRpc(session, request);
    return;
  }
  const plain = envelope.p;
  if (!plain) return;
  if (plain.op === "pair") await onPair(from, plain);
  if (plain.op === "hello") await onHello(from, plain);
}

async function onPair(from: string, message: Record<string, unknown>) {
  const current = invite;
  if (!current || message.p !== current.pairId || typeof message.d !== "string") {
    sendPlain(from, { op: "pair-failed", reason: "二维码已经失效，请在电脑上重新生成" });
    return;
  }
  if (Date.now() > current.expiresAt) {
    invite = null;
    sendPlain(from, { op: "pair-failed", reason: "二维码过期了，请在电脑上重新生成" });
    return;
  }
  let request: { name?: unknown };
  try {
    request = (await openOnce(current.key, message.d)) as { name?: unknown };
  } catch {
    sendPlain(from, { op: "pair-failed", reason: "配对信息校验失败" });
    return;
  }
  if (!/^[0-9a-f]{32}$/.test(from)) return;
  // 一次性：用过就作废，被人拍到二维码也配不了第二台。
  invite = null;
  const deviceKey = randomBytes(32);
  const name = (typeof request.name === "string" ? request.name.trim() : "").slice(0, 40) || "手机";
  config.devices = config.devices.filter((item) => item.id !== from);
  config.devices.push({ id: from, name, key: wrapSecret(toB64(deviceKey)), createdAt: Date.now() });
  saveConfig();
  record(name, "完成配对");
  sendPlain(from, {
    op: "paired",
    d: await sealOnce(current.key, {
      key: toB64(deviceKey),
      desktopId: config.desktopId,
      desktopName: config.desktopName,
    }),
  });
  const win = getWindow();
  if (win && !win.isDestroyed()) win.webContents.send("remote:paired", { id: from, name });
}

async function onHello(from: string, message: Record<string, unknown>) {
  const device = config.devices.find((item) => item.id === from);
  if (!device) {
    sendPlain(from, { op: "denied" });
    return;
  }
  if (typeof message.n !== "string") return;
  let deviceNonce: Uint8Array;
  let base: CryptoKey;
  try {
    deviceNonce = fromB64(message.n);
    if (deviceNonce.length !== 16) return;
    base = await importBaseKey(fromB64(unwrapSecret(device.key)));
  } catch {
    return;
  }
  const desktopNonce = randomBytes(16);
  const channel = await SecureChannel.create(base, deviceNonce, desktopNonce, "desktop");
  // 这台手机之前盯着哪条 Agent 工作。手机切后台再回来就是一次重新握手，
  // 不接上的话它还停在那条工作的界面上，却再也收不到新消息（要退回列表重点一次才行）。
  const watching = sessions.get(from)?.agentWorkId;
  forgetSession(from);
  const session: Session = { deviceId: from, channel, verified: false, sent: {}, uploads: new Map() };
  sessions.set(from, session);
  sendPlain(from, { op: "welcome", n: toB64(desktopNonce) });
  if (!watching) return;
  // 重新盯上，但别拖住握手：扫会话文件要花几十毫秒。
  const work = await findWork(watching);
  if (work && sessions.get(from) === session) watchSessionAgent(session, work);
}

/* ---------------- 状态同步 ---------------- */

/**
 * 把「当前这条 Agent 工作」相关的字段换成**这台手机自己打开的那条**。
 *
 * 手机和电脑各看各的（约定 51：只有 agent.open 在主进程按手机分开处理），
 * 所以凡是跟着「当前工作」走的东西都得在这儿替换。**漏一个就会露馅**：
 * 电脑上一换对话，手机上那一格跟着变，可手机的消息还停在原来那条。
 * 已经踩过的两个：`context`（右上角进度条跟着电脑跑）和 `modelKey`
 * （显示成电脑那条的型号，在手机上换模型还会改到电脑那条）——0.16.34 修的。
 */
function metaOf(snap: Snapshot, session?: Session) {
  const { threads: _threads, ...meta } = snap;
  void _threads;
  const agent = meta.agent;
  if (!session?.agentWorkId || !agent || typeof agent !== "object") return meta;
  const current = agent as {
    activeId?: string | null;
    streaming?: boolean;
    modelKey?: string;
    list?: { id: string; running?: boolean; modelKey?: string; contextLimit?: number }[];
  };
  const watching = session.agentWorkId;
  const list = Array.isArray(current.list)
    ? current.list.map((item) =>
        item.id === watching ? { ...item, running: Boolean(session.agentRunning) } : item,
      )
    : current.list;
  const mine = Array.isArray(list) ? list.find((item) => item.id === watching) : undefined;
  // 占用取盯文件时 CLI 自己报的那个数；窗口大小它没报就用这条工作型号的表值。
  const used = session.agentContext?.tokens;
  const limit = session.agentContext?.window || mine?.contextLimit || 0;
  return {
    ...meta,
    agent: {
      ...current,
      activeId: watching,
      streaming: watching === current.activeId ? Boolean(current.streaming) : Boolean(session.agentRunning),
      modelKey: mine?.modelKey ?? current.modelKey,
      context: typeof used === "number" && limit ? { used, limit } : undefined,
      list,
    },
  };
}

/** 回答 Agent 提问时带的标记，和 lib/agent-answer.ts 的 ANSWER_MARK 一致（这边引不到 lib/）。 */
const ANSWER_MARK = "〔AllAi：回答提问〕";
/** 生成交接摘要那一轮的标记，和 lib/agent-handoff.ts 的 HANDOFF_MARK 一致。 */
const HANDOFF_MARK = "〔AllAi：生成交接摘要〕";

function packAgentMessages(messages: AgentMessage[]) {
  // 回答提问、生成交接摘要这两条都不是用户打的字，手机上也不显示成用户消息。
  const visible = messages.filter((message) => {
    if (message.role !== "user") return true;
    const head = message.content.trimStart();
    return !head.startsWith(ANSWER_MARK) && !head.startsWith(HANDOFF_MARK);
  });
  return visible.slice(-120).map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    // 改文件的差异可能很大，手机上不显示，别跟着发过去。
    trace: (message.trace ?? [])
      .slice(-80)
      // 改文件的差异不发（约定 55），但 ask 必须留着 —— 手机要靠它画提问卡片。
      .map((item) =>
        item.type === "tool"
          ? { type: "tool" as const, name: item.name, detail: item.detail, ask: item.ask }
          : item,
      ),
    createdAt: message.createdAt,
  }));
}

function pushAgentThread(session: Session, workId: string, messages: AgentMessage[], reset: boolean) {
  const packed = packAgentMessages(messages);
  const order = packed.map((item) => item.id);
  const next = new Map(packed.map((item) => [item.id, JSON.stringify(item)]));
  const previous = reset ? new Map<string, string>() : session.sent.agent?.map ?? new Map();
  const upsert = packed.filter((item) => previous.get(item.id) !== next.get(item.id));
  const orderKey = order.join(",");
  if (!reset && !upsert.length && session.sent.agent?.order === orderKey && session.sent.agent.id === workId) {
    return;
  }
  session.sent.agent = { id: workId, map: next, order: orderKey };
  void sendSecure(session, {
    ev: "thread",
    data: { area: "agent", id: workId, reset, order, upsert },
  });
}

function watchSessionAgent(session: Session, work: AgentWork) {
  session.agentWatch?.close();
  session.agentWorkId = work.id;
  session.agentRunning = work.running;
  // 换一条工作：上一条的占用先清掉，别让旧数字停在进度条上。
  session.agentContext = undefined;
  let first = true;
  const started = startWorkWatch(work, (payload) => {
    session.agentRunning = payload.running;
    session.agentContext = payload.context;
    pushAgentThread(session, work.id, payload.messages, first);
    first = false;
    session.meta = undefined;
    pushUpdates(session);
  });
  if ("error" in started) {
    pushAgentThread(session, work.id, [], true);
    session.agentWatch = undefined;
    return;
  }
  session.agentWatch = started;
}

function dropSessionAgent(session: Session) {
  session.agentWatch?.close();
  session.agentWatch = undefined;
  session.agentWorkId = undefined;
  session.agentRunning = undefined;
  session.agentContext = undefined;
}

async function findWork(id: string) {
  const live = await scanLive();
  return mergeWorks(scanHistory(), live).find((item) => item.id === id) ?? null;
}

/** 按消息 id 做差量：只发变了的那几条，外加顺序。流式输出时通常只有最后一条在变。 */
function threadPatch(session: Session, area: string) {
  const thread = snapshot?.threads?.[area];
  if (!thread) return null;
  const base = session.sent[area];
  const reset = !base || base.id !== thread.id;
  const previous = reset ? new Map<string, string>() : base.map;
  const next = new Map<string, string>();
  const upsert: unknown[] = [];
  for (const message of thread.messages) {
    const json = JSON.stringify(message);
    next.set(message.id, json);
    if (previous.get(message.id) !== json) upsert.push(message);
  }
  const order = thread.messages.map((item) => item.id);
  const orderKey = order.join(",");
  if (!reset && !upsert.length && orderKey === base.order) return null;
  session.sent[area] = { id: thread.id, map: next, order: orderKey };
  return { area, id: thread.id, reset, order, upsert };
}

function pushUpdates(session: Session) {
  if (!snapshot || !session.verified) return;
  const meta = metaOf(snapshot, session);
  const json = JSON.stringify(meta);
  if (json !== session.meta) {
    session.meta = json;
    void sendSecure(session, { ev: "state", data: meta });
  }
  for (const area of Object.keys(snapshot.threads ?? {})) {
    if (area === "agent" && session.agentWorkId) continue;
    const patch = threadPatch(session, area);
    if (patch) void sendSecure(session, { ev: "thread", data: patch });
  }
}

function broadcast(ev: string, data: unknown) {
  for (const session of sessions.values()) {
    if (session.verified) void sendSecure(session, { ev, data });
  }
}

/* ---------------- 手机发来的操作 ---------------- */

const RENDERER_OPS = new Set([
  "chat.open",
  "chat.new",
  "chat.send",
  "chat.stop",
  "chat.model",
  "chat.rename",
  "chat.delete",
  "agent.new",
  "agent.send",
  "agent.stop",
  "agent.model",
  "agent.rename",
  "agent.delete",
  "prefs.patch",
  "view",
]);

const OP_LABEL: Record<string, string> = {
  "chat.send": "发送聊天消息",
  "chat.new": "新建聊天",
  "chat.stop": "停止聊天",
  "chat.delete": "删除聊天",
  "agent.send": "给 Agent 发送任务",
  "agent.new": "新建 Agent 工作",
  "agent.stop": "停止 Agent",
  "agent.delete": "删除 Agent 工作",
  "studio.generate": "开始创作",
  "studio.delete": "删除创作",
};

const UPLOAD_ID = /^[A-Za-z0-9_-]{1,80}$/;
const FILE_CHUNK = 256 * 1024;
const MAX_UPLOAD = 30 * 1024 * 1024;
const fileCache = new Map<string, { data: Buffer; mime: string }>();

function localUrl(pathname: string) {
  const base = getLocalUrl();
  if (!base) throw new Error("电脑上的 AllAi 还没启动好");
  return `${base.replace(/\/+$/, "")}${pathname}`;
}

async function localJson(pathname: string, init?: RequestInit) {
  const response = await fetch(localUrl(pathname), init);
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : `请求失败（${response.status}）`);
  return data;
}

async function readUpload(id: string) {
  const cached = fileCache.get(id);
  if (cached) return cached;
  const response = await fetch(localUrl(`/api/uploads/${id}`));
  if (!response.ok) throw new Error("文件不存在");
  const entry = {
    data: Buffer.from(await response.arrayBuffer()),
    mime: response.headers.get("content-type") || "application/octet-stream",
  };
  fileCache.set(id, entry);
  // 只留最近几个，手机一张张翻图时不用反复读盘，也不会把内存撑大。
  while (fileCache.size > 6) fileCache.delete(fileCache.keys().next().value as string);
  return entry;
}

async function dispatch(session: Session, op: string, args: Record<string, unknown>) {
  const name = deviceName(session.deviceId);
  if (OP_LABEL[op]) record(name, OP_LABEL[op]);

  if (op === "sync") {
    session.meta = undefined;
    session.sent = {};
    // 回完这一条再推全量，手机那边先拿到身份信息再收状态。
    setTimeout(() => pushUpdates(session), 0);
    if (!snapshot) void callRenderer("publish", {}, 10_000).catch(() => undefined);
    return {
      desktop: { id: config.desktopId, name: config.desktopName, version: app.getVersion() },
      caps: config.caps,
    };
  }

  if (op === "agent.open") {
    const id = String(args.threadId ?? "");
    if (!id) throw new Error("缺少工作编号");
    const work = await findWork(id);
    if (!work) throw new Error("这条工作不存在了");
    watchSessionAgent(session, work);
    session.meta = undefined;
    pushUpdates(session);
    return { ok: true };
  }

  if (RENDERER_OPS.has(op)) {
    if (op === "agent.delete" && session.agentWorkId && session.agentWorkId === String(args.threadId ?? "")) {
      dropSessionAgent(session);
    }
    const payload = op === "agent.send" ? { ...args, caps: config.caps } : args;
    return callRenderer(op, payload);
  }

  if (op === "file.get") {
    const id = String(args.id ?? "");
    if (!UPLOAD_ID.test(id)) throw new Error("文件编号不对");
    const offset = Math.max(0, Number(args.offset) || 0);
    const file = await readUpload(id);
    const slice = file.data.subarray(offset, offset + FILE_CHUNK);
    return { mime: file.mime, total: file.data.length, offset, data: slice.toString("base64") };
  }

  if (op === "file.put") {
    const tx = String(args.tx ?? "");
    if (!/^[0-9a-f]{8,64}$/.test(tx)) throw new Error("上传编号不对");
    let upload = session.uploads.get(tx);
    if (!upload) {
      upload = {
        name: String(args.name ?? "file").slice(0, 120),
        mime: String(args.mime ?? "application/octet-stream").slice(0, 100),
        chunks: [],
        size: 0,
      };
      session.uploads.set(tx, upload);
    }
    const chunk = String(args.data ?? "");
    upload.chunks.push(chunk);
    upload.size += Math.floor((chunk.length * 3) / 4);
    if (upload.size > MAX_UPLOAD) {
      session.uploads.delete(tx);
      throw new Error("文件太大了（最多 30MB）");
    }
    if (!args.done) return { received: upload.size };
    session.uploads.delete(tx);
    const data = await localJson("/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // 每块都是 3 字节整数倍切的，base64 直接拼起来就是整个文件。
      body: JSON.stringify({ name: upload.name, mime: upload.mime, data: upload.chunks.join("") }),
    });
    return data.file;
  }

  if (op === "studio.list") {
    return localJson("/api/studio/conversations");
  }

  if (op === "studio.thread") {
    const id = String(args.id ?? "");
    if (!UPLOAD_ID.test(id)) throw new Error("创作编号不对");
    return localJson(`/api/studio/conversations/${id}`);
  }

  if (op === "studio.rename") {
    const id = String(args.id ?? "");
    if (!UPLOAD_ID.test(id)) throw new Error("创作编号不对");
    const title = String(args.title ?? "").trim().slice(0, 60);
    if (!title) throw new Error("请填写名称");
    return localJson(`/api/studio/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
  }

  if (op === "studio.delete") {
    const id = String(args.id ?? "");
    if (!UPLOAD_ID.test(id)) throw new Error("创作编号不对");
    return localJson(`/api/studio/conversations/${id}`, { method: "DELETE" });
  }

  if (op === "studio.generate") {
    const imageIds = Array.isArray(args.imageIds)
      ? args.imageIds.filter((item): item is string => typeof item === "string" && UPLOAD_ID.test(item))
      : [];
    const conversationId =
      typeof args.conversationId === "string" && UPLOAD_ID.test(args.conversationId)
        ? args.conversationId
        : undefined;
    const body = {
      scope: "studio",
      mode: args.mode === "video" ? "video" : "image",
      prompt: String(args.prompt ?? "").slice(0, 8000),
      aspectRatio: typeof args.aspectRatio === "string" ? args.aspectRatio : "auto",
      characterIds: [],
      imageIds,
      modelKey: typeof args.modelKey === "string" ? args.modelKey : undefined,
      conversationId,
    };
    if (!body.prompt.trim()) throw new Error("请填写提示词");
    // 生成要几十秒到几分钟，不能让手机一直等着这一条请求：先回话，生成完再广播。
    const startedAt = Date.now();
    const settle = (error?: string) => {
      broadcast("studio", { conversationId: conversationId ?? null, error, startedAt });
      void callRenderer("studio.refresh", { conversationId }, 10_000).catch(() => undefined);
    };
    void fetch(localUrl("/api/imagine"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        settle(response.ok ? undefined : data.error || "生成失败");
      })
      .catch((error: unknown) => settle(error instanceof Error ? error.message : "生成失败"));
    // 刚发出去时新创作已经落库了，让界面也刷一下。
    setTimeout(() => void callRenderer("studio.refresh", { conversationId }, 10_000).catch(() => undefined), 800);
    return { started: true, startedAt };
  }

  throw new Error(`不支持的操作：${op}`);
}

async function handleRpc(session: Session, request: RpcRequest) {
  if (!request || typeof request.id !== "string" || typeof request.op !== "string") return;
  const args = (request.args && typeof request.args === "object" ? request.args : {}) as Record<string, unknown>;
  try {
    const result = await dispatch(session, request.op, args);
    await sendSecure(session, { id: request.id, ok: true, result });
  } catch (error) {
    await sendSecure(session, {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/* ---------------- 对外 ---------------- */

/**
 * 只给 scripts/test-remote-sessions.cjs 用的后门：不起中继、不开窗口也能驱动这里的
 * 会话生命周期。主进程模块，不经 IPC 暴露给界面。
 */
export const __testHooks = {
  setRelaySender(sink: (payload: Record<string, unknown>) => void) {
    socket = {
      readyState: 1,
      send: (data: string) => sink(JSON.parse(data) as Record<string, unknown>),
      close: () => undefined,
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
    };
  },
  addTestDevice(device: { id: string; name: string; keyB64: string }) {
    config.devices.push({
      id: device.id,
      name: device.name,
      key: `raw:${device.keyB64}`,
      createdAt: Date.now(),
    });
  },
  deliverPlain(from: string, message: Record<string, unknown>) {
    return onRelay(JSON.stringify({ t: "msg", from, d: JSON.stringify({ p: message }) }));
  },
  deliverSecure(from: string, sealed: string) {
    return onRelay(JSON.stringify({ t: "msg", from, d: JSON.stringify({ s: sealed }) }));
  },
  dropAllSessions() {
    clearSessions();
  },
  /** 冒充界面推一份快照（正常是 IPC remote:publish 来的）。 */
  publish(next: Snapshot) {
    snapshot = next;
  },
  /** 把当前快照推给所有会话。 */
  pushAll() {
    for (const session of sessions.values()) pushUpdates(session);
  },
};

export function remoteStatus() {
  return status;
}

export function stopRemote() {
  config.enabled = false;
  disconnect();
}

export function initRemote(opts: {
  getWindow: () => BrowserWindow | null;
  getLocalUrl: () => string | null;
}) {
  getWindow = opts.getWindow;
  getLocalUrl = opts.getLocalUrl;
  loadConfig();

  ipcMain.handle("remote:config", () => publicConfig());
  ipcMain.handle("remote:status", () => status);
  ipcMain.handle("remote:log", () => audit.slice(0, 100));
  ipcMain.handle(
    "remote:save",
    (_event, patch: Partial<Omit<RemotePublicConfig, "devices" | "hasToken">> & { token?: string }) => {
      if (typeof patch.relayUrl === "string") {
        const value = patch.relayUrl.trim().replace(/\/+$/, "");
        if (value) {
          let url: URL;
          try {
            url = new URL(value);
          } catch {
            return { ok: false, error: "中继地址格式不对，应该像 https://allai.example.com" };
          }
          const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
          if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
            return { ok: false, error: "中继地址必须是 https://（手机上的加密功能只在 HTTPS 下可用）" };
          }
        }
        config.relayUrl = value;
      }
      if (typeof patch.token === "string" && patch.token.trim()) config.token = wrapSecret(patch.token.trim());
      if (typeof patch.desktopName === "string") config.desktopName = patch.desktopName.trim().slice(0, 40) || os.hostname();
      if (patch.caps) config.caps = { ...config.caps, ...patch.caps };
      const reconnect =
        typeof patch.enabled === "boolean" ||
        typeof patch.relayUrl === "string" ||
        Boolean(patch.token && patch.token.trim());
      if (typeof patch.enabled === "boolean") config.enabled = patch.enabled;
      saveConfig();
      if (reconnect) {
        retryDelay = 1000;
        connect();
      }
      if (patch.caps) broadcast("caps", config.caps);
      return { ok: true, config: publicConfig() };
    },
  );
  ipcMain.handle("remote:pair", async () => {
    if (!config.relayUrl) return { ok: false, error: "先填好中继地址" };
    const pairId = randomId(16);
    const secret = randomBytes(32);
    invite = { pairId, key: await pairingKey(secret, pairId), expiresAt: Date.now() + PAIR_TTL_MS };
    const link = inviteLink(config.relayUrl, {
      d: config.desktopId,
      p: pairId,
      s: toB64Url(secret),
      n: config.desktopName,
    });
    return { ok: true, link, expiresAt: invite.expiresAt };
  });
  ipcMain.handle("remote:cancel-pair", () => {
    invite = null;
  });
  ipcMain.handle("remote:revoke", (_event, id: string) => {
    const device = config.devices.find((item) => item.id === id);
    config.devices = config.devices.filter((item) => item.id !== id);
    saveConfig();
    forgetSession(id);
    // 先告诉它被移除了（它会删掉本地密钥），再让中继断开它。
    sendPlain(id, { op: "denied" });
    relaySend({ t: "kick", to: id });
    if (device) record(device.name, "被移除");
    pushStatus();
    return publicConfig();
  });
  ipcMain.handle("remote:rename", (_event, id: string, name: string) => {
    const device = config.devices.find((item) => item.id === id);
    if (device && typeof name === "string" && name.trim()) {
      device.name = name.trim().slice(0, 40);
      saveConfig();
      pushStatus();
    }
    return publicConfig();
  });

  ipcMain.on("remote:reply", (_event, id: string, reply: { ok: boolean; result?: unknown; error?: string }) => {
    const call = rendererCalls.get(id);
    if (!call) return;
    rendererCalls.delete(id);
    clearTimeout(call.timer);
    if (reply?.ok) call.resolve(reply.result);
    else call.reject(new Error(reply?.error || "电脑端执行失败"));
  });
  ipcMain.on("remote:publish", (_event, next: Snapshot) => {
    snapshot = next;
    for (const session of sessions.values()) pushUpdates(session);
  });

  if (config.enabled) connect();
}
