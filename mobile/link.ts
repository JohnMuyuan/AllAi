/**
 * 手机网页和电脑之间的连接：配对、握手、加密 RPC、文件收发。
 * 加密协议和电脑端是同一份代码（electron/remote-protocol.ts）。
 *
 * 每台配过对的电脑存一条：电脑 id、这台手机在它那里的 id、以及长期密钥。
 * 密钥以「不可导出」的 CryptoKey 存在 IndexedDB 里：页面脚本能用它，但读不出原始字节。
 */
import {
  SecureChannel,
  fromB64,
  importBaseKey,
  openOnce,
  pairingKey,
  randomBytes,
  randomId,
  sealOnce,
  toB64,
  type PairingInvite,
} from "../electron/remote-protocol";

export type SavedDesktop = {
  desktopId: string;
  name: string;
  deviceId: string;
  key: CryptoKey;
  pairedAt: number;
};

export type Attachment = { id: string; name: string; mime: string; kind: "image" | "video" | "audio" | "file" };

/* ---------------- 本地存储 ---------------- */

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("这个浏览器不支持本地存储（无痕模式？），没法保存配对"));
      return;
    }
    const request = indexedDB.open("allai-remote", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("desktops", { keyPath: "desktopId" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("打不开本地存储"));
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const request = run(db.transaction("desktops", mode).objectStore("desktops"));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("本地存储出错"));
  });
}

/**
 * 实际落盘的一条。**密钥存原始字节（base64），打开时再导入成 CryptoKey。**
 *
 * 0.16.0 直接把 CryptoKey 对象存进 IndexedDB。iPhone 上把网页加到主屏幕当 App 用时，
 * 杀掉后台再打开就要重新配对 —— WebKit 在主屏幕 App 里存进去的 CryptoKey，进程重启后
 * 读不回来，整张表读取失败，页面以为从没配过。现在存普通字符串，并且 IndexedDB 和
 * localStorage 各存一份，任何一份还在就能用。
 */
type StoredDesktop = {
  desktopId: string;
  name: string;
  deviceId: string;
  keyB64?: string;
  /** 0.16.0 的旧记录才有 */
  key?: CryptoKey;
  pairedAt: number;
};

const LOCAL_KEY = "allai-remote-desktops";

function readLocal(): StoredDesktop[] {
  try {
    const value = JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]") as unknown;
    return Array.isArray(value) ? (value as StoredDesktop[]) : [];
  } catch {
    return [];
  }
}

function writeLocal(list: StoredDesktop[]) {
  try {
    const plain = list
      .filter((item) => item.keyB64)
      .map(({ desktopId, name, deviceId, keyB64, pairedAt }) => ({ desktopId, name, deviceId, keyB64, pairedAt }));
    localStorage.setItem(LOCAL_KEY, JSON.stringify(plain));
  } catch {
    // 无痕模式等写不了，IndexedDB 那份还在
  }
}

async function readIdb(): Promise<StoredDesktop[]> {
  try {
    return await tx<StoredDesktop[]>("readonly", (store) => store.getAll() as IDBRequest<StoredDesktop[]>);
  } catch {
    // 读不出来多半是里面有坏掉的旧 CryptoKey 记录。清掉，不然以后每次都读失败。
    await tx("readwrite", (store) => store.clear()).catch(() => undefined);
    return [];
  }
}

export async function listDesktops(): Promise<SavedDesktop[]> {
  const merged = new Map<string, StoredDesktop>();
  for (const item of [...readLocal(), ...(await readIdb())]) {
    if (!item?.desktopId) continue;
    const previous = merged.get(item.desktopId);
    if (!previous || (!previous.keyB64 && item.keyB64)) merged.set(item.desktopId, item);
  }
  const out: SavedDesktop[] = [];
  for (const item of merged.values()) {
    try {
      const key = item.keyB64
        ? await importBaseKey(fromB64(item.keyB64))
        : item.key instanceof CryptoKey
          ? item.key
          : null;
      if (key) out.push({ desktopId: item.desktopId, name: item.name, deviceId: item.deviceId, key, pairedAt: item.pairedAt });
    } catch {
      // 这一条坏了就跳过，别影响其他电脑
    }
  }
  // 两份互相补齐：localStorage 丢了从 IndexedDB 补回来，反过来下次保存时也会补。
  writeLocal([...merged.values()]);
  return out.sort((a, b) => a.pairedAt - b.pairedAt);
}

async function saveDesktop(record: StoredDesktop) {
  writeLocal([...readLocal().filter((item) => item.desktopId !== record.desktopId), record]);
  await tx("readwrite", (store) => store.put(record)).catch(() => {
    if (!readLocal().some((item) => item.desktopId === record.desktopId)) {
      throw new Error("这个浏览器存不下配对信息（无痕模式？）");
    }
  });
}

export async function removeDesktop(desktopId: string) {
  writeLocal(readLocal().filter((item) => item.desktopId !== desktopId));
  await tx("readwrite", (store) => store.delete(desktopId)).catch(() => undefined);
}

/* ---------------- 中继 ---------------- */

/** 支持部署在子路径下：/ws 跟着页面所在的目录走。 */
function relayUrl() {
  const base = location.pathname.replace(/[^/]*$/, "");
  return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}${base}ws`;
}

type RelayMessage = { t: string; d?: string; online?: boolean };

/** 扫码配对：拿二维码里的一次性 secret 和电脑交换这台手机的长期密钥。 */
export function pairWith(invite: PairingInvite, deviceName: string): Promise<SavedDesktop> {
  const deviceId = randomId(16);
  return new Promise((resolve, reject) => {
    let settled = false;
    const ws = new WebSocket(relayUrl());
    const finish = (error: Error | null, value?: SavedDesktop) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.close();
      if (error) reject(error);
      else resolve(value!);
    };
    const timer = setTimeout(
      () => finish(new Error("电脑没有回应。确认电脑上的 AllAi 开着远程控制，并且已经连上中继。")),
      20_000,
    );
    const keyPromise = pairingKey(fromB64(invite.s), invite.p);
    ws.onopen = () => ws.send(JSON.stringify({ t: "device", desktop: invite.d, id: deviceId }));
    ws.onerror = () => finish(new Error("连不上中继服务器"));
    ws.onclose = () => finish(new Error("和中继的连接断了"));
    ws.onmessage = async (event) => {
      let msg: RelayMessage;
      try {
        msg = JSON.parse(String(event.data)) as RelayMessage;
      } catch {
        return;
      }
      try {
        if (msg.t === "ready" || msg.t === "online") {
          if (msg.t === "ready" && !msg.online) {
            finish(new Error("电脑现在不在线。确认电脑上的 AllAi 开着远程控制。"));
            return;
          }
          const d = await sealOnce(await keyPromise, { name: deviceName });
          ws.send(JSON.stringify({ t: "send", d: JSON.stringify({ p: { op: "pair", p: invite.p, d } }) }));
          return;
        }
        if (msg.t === "offline") {
          finish(new Error("电脑离线了"));
          return;
        }
        if (msg.t !== "msg" || !msg.d) return;
        const envelope = JSON.parse(msg.d) as { p?: { op?: string; d?: string; reason?: string } };
        if (envelope.p?.op === "pair-failed") {
          finish(new Error(envelope.p.reason || "配对失败"));
          return;
        }
        if (envelope.p?.op !== "paired" || !envelope.p.d) return;
        const data = (await openOnce(await keyPromise, envelope.p.d)) as {
          key: string;
          desktopId: string;
          desktopName?: string;
        };
        if (data.desktopId !== invite.d) throw new Error("电脑身份对不上");
        const key = await importBaseKey(fromB64(data.key));
        const record: StoredDesktop = {
          desktopId: data.desktopId,
          name: data.desktopName || invite.n,
          deviceId,
          keyB64: data.key,
          pairedAt: Date.now(),
        };
        await saveDesktop(record);
        // 请浏览器别在空间紧张时清掉这个网站的数据（主屏幕 App 本来就不会被清）
        void navigator.storage?.persist?.().catch(() => undefined);
        finish(null, {
          desktopId: record.desktopId,
          name: record.name,
          deviceId,
          key,
          pairedAt: record.pairedAt,
        });
      } catch (error) {
        finish(error instanceof Error ? error : new Error("配对失败"));
      }
    };
  });
}

/* ---------------- 已配对电脑的连接 ---------------- */

export type LinkState = "connecting" | "offline" | "ready" | "denied";

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: number };

export type LinkHandlers = {
  onState: (state: LinkState) => void;
  onEvent: (ev: string, data: unknown) => void;
  onReady: () => void;
};

export class DesktopLink {
  state: LinkState = "connecting";
  private ws: WebSocket | null = null;
  private channel: SecureChannel | null = null;
  private nonce: Uint8Array | null = null;
  private pending = new Map<string, Pending>();
  private stopped = false;
  private retry = 1000;
  private retryTimer = 0;
  private pingTimer = 0;
  private lastPong = 0;
  readonly files = new Map<string, Promise<string>>();

  private handlers: LinkHandlers = { onState: () => undefined, onEvent: () => undefined, onReady: () => undefined };

  constructor(readonly desktop: SavedDesktop) {}

  start(handlers: LinkHandlers) {
    this.handlers = handlers;
    this.stopped = false;
    document.addEventListener("visibilitychange", this.onVisible);
    this.connect();
  }

  stop() {
    this.stopped = true;
    document.removeEventListener("visibilitychange", this.onVisible);
    clearTimeout(this.retryTimer);
    clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = null;
    this.failAll("已断开");
    for (const url of this.files.values()) void url.then((value) => URL.revokeObjectURL(value)).catch(() => undefined);
    this.files.clear();
  }

  /** 手机切到后台时浏览器会掐掉连接，回到前台立刻重连，不等退避。 */
  private onVisible = () => {
    if (document.visibilityState !== "visible" || this.stopped) return;
    if (!this.ws || this.ws.readyState > 1) {
      clearTimeout(this.retryTimer);
      this.retry = 1000;
      this.connect();
    }
  };

  private setState(state: LinkState) {
    if (this.state === state) return;
    this.state = state;
    this.handlers.onState(state);
  }

  private failAll(message: string) {
    for (const call of this.pending.values()) {
      clearTimeout(call.timer);
      call.reject(new Error(message));
    }
    this.pending.clear();
  }

  private connect() {
    if (this.stopped) return;
    this.ws?.close();
    this.channel = null;
    this.setState("connecting");
    const ws = new WebSocket(relayUrl());
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: "device", desktop: this.desktop.desktopId, id: this.desktop.deviceId }));
      this.lastPong = Date.now();
      clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => {
        if (Date.now() - this.lastPong > 60_000) {
          ws.close();
          return;
        }
        if (ws.readyState === 1) ws.send(JSON.stringify({ t: "ping" }));
      }, 20_000);
    };
    ws.onmessage = (event) => {
      if (this.ws !== ws) return;
      void this.onMessage(String(event.data));
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.channel = null;
      clearInterval(this.pingTimer);
      this.failAll("连接断了");
      if (this.stopped || this.state === "denied") return;
      this.setState("connecting");
      this.retryTimer = window.setTimeout(() => this.connect(), this.retry);
      this.retry = Math.min(this.retry * 2, 15_000);
    };
  }

  private handshake() {
    this.channel = null;
    this.nonce = randomBytes(16);
    this.send({ p: { op: "hello", n: toB64(this.nonce) } });
  }

  private send(envelope: unknown) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ t: "send", d: JSON.stringify(envelope) }));
  }

  private async onMessage(raw: string) {
    let msg: RelayMessage;
    try {
      msg = JSON.parse(raw) as RelayMessage;
    } catch {
      return;
    }
    if (msg.t === "pong") {
      this.lastPong = Date.now();
      return;
    }
    if (msg.t === "ready") {
      this.lastPong = Date.now();
      if (msg.online) this.handshake();
      else this.setState("offline");
      return;
    }
    if (msg.t === "online") {
      this.handshake();
      return;
    }
    if (msg.t === "offline") {
      this.channel = null;
      this.failAll("电脑离线了");
      this.setState("offline");
      return;
    }
    if (msg.t !== "msg" || !msg.d) return;
    let envelope: { p?: { op?: string; n?: string }; s?: string };
    try {
      envelope = JSON.parse(msg.d) as typeof envelope;
    } catch {
      return;
    }
    if (typeof envelope.s === "string") {
      const channel = this.channel;
      if (!channel) return;
      // 前面不能有 await：解密计数器依赖收到的顺序。
      const opening = channel.open(envelope.s);
      let payload: { id?: string; ok?: boolean; result?: unknown; error?: string; ev?: string; data?: unknown };
      try {
        payload = (await opening) as typeof payload;
      } catch {
        if (this.channel === channel) this.handshake();
        return;
      }
      if (payload.ev) {
        this.handlers.onEvent(payload.ev, payload.data);
        return;
      }
      const call = payload.id ? this.pending.get(payload.id) : undefined;
      if (!call || !payload.id) return;
      this.pending.delete(payload.id);
      clearTimeout(call.timer);
      if (payload.ok) call.resolve(payload.result);
      else call.reject(new Error(payload.error || "电脑端出错了"));
      return;
    }
    const op = envelope.p?.op;
    if (op === "welcome" && this.nonce && envelope.p?.n) {
      const nonce = this.nonce;
      this.nonce = null;
      this.channel = await SecureChannel.create(this.desktop.key, nonce, fromB64(envelope.p.n), "device");
      this.retry = 1000;
      this.setState("ready");
      this.handlers.onReady();
    } else if (op === "reset") {
      this.failAll("会话重置了，请重试");
      this.handshake();
    } else if (op === "denied") {
      this.setState("denied");
      this.stop();
    }
  }

  async call<T = unknown>(op: string, args: Record<string, unknown> = {}, timeoutMs = 60_000): Promise<T> {
    const channel = this.channel;
    if (!channel || this.state !== "ready") throw new Error(this.state === "offline" ? "电脑不在线" : "还没连上电脑");
    const id = randomId(8);
    const sealed = await channel.seal({ id, op, args });
    if (this.channel !== channel) throw new Error("连接刚刚重置了，请重试");
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("电脑没有响应"));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      this.send({ s: sealed });
    });
  }

  /** 电脑上的图片/视频：分块取回、在本地拼成 blob。同一个文件只取一次。 */
  fileUrl(id: string) {
    let url = this.files.get(id);
    if (!url) {
      url = (async () => {
        const parts: Uint8Array[] = [];
        let offset = 0;
        let mime = "application/octet-stream";
        for (;;) {
          const chunk = await this.call<{ mime: string; total: number; data: string }>("file.get", { id, offset });
          mime = chunk.mime;
          const bytes = fromB64(chunk.data);
          parts.push(bytes);
          offset += bytes.length;
          if (!bytes.length || offset >= chunk.total) break;
        }
        return URL.createObjectURL(new Blob(parts as BlobPart[], { type: mime }));
      })();
      url.catch(() => this.files.delete(id));
      this.files.set(id, url);
    }
    return url;
  }

  /** 传文件给电脑。按 3 字节整数倍切块，电脑那边 base64 直接拼接就是原文件。 */
  async upload(file: File, onProgress?: (ratio: number) => void): Promise<Attachment> {
    const CHUNK = 3 * 64 * 1024;
    const tx = randomId(8);
    let result: unknown = null;
    for (let offset = 0; offset < file.size || offset === 0; offset += CHUNK) {
      const bytes = new Uint8Array(await file.slice(offset, offset + CHUNK).arrayBuffer());
      const done = offset + CHUNK >= file.size;
      result = await this.call("file.put", {
        tx,
        name: file.name || "image.jpg",
        mime: file.type || "application/octet-stream",
        data: toB64(bytes),
        done,
      });
      onProgress?.(Math.min(1, (offset + CHUNK) / Math.max(1, file.size)));
      if (done) break;
    }
    return result as Attachment;
  }
}
