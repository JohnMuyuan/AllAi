/**
 * 远程控制的加密协议。电脑（Electron 主进程）和手机网页用的是**同一份代码** ——
 * 两边都有 WebCrypto，逐字节一致，不会出现「这边加密那边解不开」。
 *
 * 这里只准用两边都有的东西：globalThis.crypto、TextEncoder、Uint8Array、DataView。
 * 不要用 Buffer（浏览器没有）、btoa（Node 老版本没有，且处理不了二进制以外的东西）。
 *
 * 安全模型：
 * - 配对：电脑生成一次性 pairId + 32 字节 secret，放进二维码链接的 **#片段**
 *   （片段不会发给服务器）。手机用 HKDF(secret, pairId) 派生的密钥和电脑交换，
 *   电脑发给手机一把这台手机专属的 32 字节长期密钥。
 * - 会话：每次连上，双方各出 16 字节随机数，HKDF(长期密钥, 两个随机数) 派生本次会话的
 *   AES-256-GCM 密钥。IV 由「方向 + 计数器」构成，不在网上传：重放、乱序、篡改的帧
 *   都会直接解密失败。中继服务器只看得到密文。
 */

const subtle = globalThis.crypto.subtle;

type Bytes = Uint8Array;

/** TS 新版本里 Uint8Array 和 BufferSource 的泛型对不上，这里统一转一下。 */
const ab = (bytes: Bytes) => bytes as unknown as ArrayBuffer;

/** 配对邀请的有效期。二维码被人拍到也只在这段时间里有用，而且只能用一次。 */
export const PAIR_TTL_MS = 10 * 60 * 1000;

export function randomBytes(count: number): Bytes {
  const out = new Uint8Array(count);
  globalThis.crypto.getRandomValues(out);
  return out;
}

export function toHex(bytes: Bytes) {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

export function randomId(bytes = 16) {
  return toHex(randomBytes(bytes));
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_INDEX = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) table[B64.charCodeAt(i)] = i;
  table["-".charCodeAt(0)] = 62;
  table["_".charCodeAt(0)] = 63;
  return table;
})();

export function toB64(bytes: Bytes): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += `${B64[(n >> 18) & 63]}${B64[(n >> 12) & 63]}==`;
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += `${B64[(n >> 18) & 63]}${B64[(n >> 12) & 63]}${B64[(n >> 6) & 63]}=`;
  }
  return out;
}

/** 同时认标准 base64 和 URL 安全 base64，缺不缺补位都行。 */
export function fromB64(text: string): Bytes {
  const clean = text.replace(/[=\s]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    const value = code < 128 ? B64_INDEX[code] : -1;
    if (value < 0) throw new Error("base64 格式不对");
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index++] = (buffer >> bits) & 0xff;
    }
  }
  return out.subarray(0, index);
}

export function toB64Url(bytes: Bytes) {
  return toB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const utf8 = (text: string) => new TextEncoder().encode(text);
export const fromUtf8 = (bytes: Bytes) => new TextDecoder().decode(bytes);

function concat(...parts: Bytes[]) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** 长期密钥（或配对 secret）导入成 HKDF 的原料。不可导出：页面里的脚本只能用，拿不走原文。 */
export function importBaseKey(raw: Bytes): Promise<CryptoKey> {
  return subtle.importKey("raw", ab(raw), "HKDF", false, ["deriveKey"]);
}

function derive(base: CryptoKey, salt: Bytes, info: string): Promise<CryptoKey> {
  return subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: ab(salt), info: ab(utf8(info)) },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** 配对阶段用的密钥：只加密配对时那两条消息。 */
export async function pairingKey(secret: Bytes, pairId: string): Promise<CryptoKey> {
  return derive(await importBaseKey(secret), utf8(pairId), "allai-remote-pair-v1");
}

/** 一次性加密（随机 IV，IV 放在密文前面）。只给配对那两条消息用。 */
export async function sealOnce(key: CryptoKey, value: unknown): Promise<string> {
  const iv = randomBytes(12);
  const cipher = await subtle.encrypt({ name: "AES-GCM", iv: ab(iv) }, key, ab(utf8(JSON.stringify(value))));
  return toB64(concat(iv, new Uint8Array(cipher)));
}

export async function openOnce(key: CryptoKey, text: string): Promise<unknown> {
  const all = fromB64(text);
  if (all.length < 12 + 16) throw new Error("密文太短");
  const plain = await subtle.decrypt({ name: "AES-GCM", iv: ab(all.subarray(0, 12)) }, key, ab(all.subarray(12)));
  return JSON.parse(fromUtf8(new Uint8Array(plain)));
}

export type Side = "desktop" | "device";
const DIRECTION: Record<Side, number> = { desktop: 1, device: 2 };

/**
 * 一次连接的加密通道。
 *
 * IV = [方向 1 字节][0 0 0][计数器 8 字节]，**不在网上传**，双方各自按顺序算。
 * 所以任何重放、乱序、丢帧、篡改都会让 GCM 校验失败 —— 通道一旦出错就该整条断开重连。
 *
 * 加密和解密都串成队列：计数器必须和发送/接收顺序严格一致。调用方按
 * `await seal()` 的完成顺序发送即可（队列保证完成顺序 = 调用顺序）。
 */
export class SecureChannel {
  private sendCounter = 0;
  private recvCounter = 0;
  private sendQueue: Promise<unknown> = Promise.resolve();
  private recvQueue: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly key: CryptoKey,
    private readonly side: Side,
  ) {}

  static async create(base: CryptoKey, deviceNonce: Bytes, desktopNonce: Bytes, side: Side) {
    const key = await derive(base, concat(deviceNonce, desktopNonce), "allai-remote-session-v1");
    return new SecureChannel(key, side);
  }

  private iv(direction: number, counter: number) {
    const iv = new Uint8Array(12);
    iv[0] = direction;
    const view = new DataView(iv.buffer);
    view.setUint32(4, Math.floor(counter / 2 ** 32));
    view.setUint32(8, counter >>> 0);
    return iv;
  }

  seal(value: unknown): Promise<string> {
    const counter = this.sendCounter++;
    const iv = this.iv(DIRECTION[this.side], counter);
    const next = this.sendQueue.then(async () => {
      const cipher = await subtle.encrypt(
        { name: "AES-GCM", iv: ab(iv) },
        this.key,
        ab(utf8(JSON.stringify(value))),
      );
      return toB64(new Uint8Array(cipher));
    });
    this.sendQueue = next.catch(() => undefined);
    return next;
  }

  open(text: string): Promise<unknown> {
    const counter = this.recvCounter++;
    const direction = this.side === "desktop" ? DIRECTION.device : DIRECTION.desktop;
    const iv = this.iv(direction, counter);
    const next = this.recvQueue.then(async () => {
      const plain = await subtle.decrypt({ name: "AES-GCM", iv: ab(iv) }, this.key, ab(fromB64(text)));
      return JSON.parse(fromUtf8(new Uint8Array(plain))) as unknown;
    });
    this.recvQueue = next.catch(() => undefined);
    return next;
  }
}

/** 二维码里放的东西。整段放在链接的 # 后面，不会发给服务器。 */
export type PairingInvite = {
  /** 电脑的 id */
  d: string;
  /** 这次配对的 id */
  p: string;
  /** 32 字节 secret，base64url */
  s: string;
  /** 电脑名字，给手机上显示 */
  n: string;
};

export function inviteLink(relayUrl: string, invite: PairingInvite) {
  const json = utf8(JSON.stringify(invite));
  return `${relayUrl.replace(/\/+$/, "")}/#pair=${toB64Url(json)}`;
}

export function parseInvite(hash: string): PairingInvite | null {
  const match = /(?:^#|&)pair=([A-Za-z0-9_-]+)/.exec(hash);
  if (!match) return null;
  try {
    const value = JSON.parse(fromUtf8(fromB64(match[1]))) as Partial<PairingInvite>;
    if (typeof value.d !== "string" || typeof value.p !== "string" || typeof value.s !== "string") return null;
    return { d: value.d, p: value.p, s: value.s, n: typeof value.n === "string" ? value.n : "我的电脑" };
  } catch {
    return null;
  }
}

/* ---------- 中继帧（明文 JSON，中继只看这一层） ---------- */

/** 手机 → 电脑的载荷：会话建立前是明文 {p}，之后一律是密文 {s}。 */
export type Envelope = { p: Record<string, unknown> } | { s: string };

export type RpcRequest = { id: string; op: string; args?: unknown };
export type RpcResponse = { id: string; ok: true; result?: unknown } | { id: string; ok: false; error: string };
export type RpcEvent = { ev: string; data: unknown };
