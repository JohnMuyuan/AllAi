import type { AgentAsk, FileDiff } from "@/lib/types";

export type DetectedCli = {
  kind: "grok-build" | "claude-code" | "codex";
  name: string;
  command: string;
  version: string;
};

export type DesktopSession = {
  id: string;
  agentId: string;
  agentName: string;
  cwd: string;
  action: "run" | "login";
  status: "running" | "exited";
  exitCode: number | null;
};

export type PtyStartRequest = {
  sessionId: string;
  agentId: string;
  action: "run" | "login";
  cwd: string;
  cols: number;
  rows: number;
};

export type AgentKind = "grok-build" | "claude-code" | "codex" | "custom";

export type AgentWork = {
  id: string;
  kind: AgentKind;
  agentName: string;
  title: string;
  cwd: string;
  cliSessionId: string;
  model?: string;
  modelKey?: string;
  providerId?: string;
  sessionModel?: string;
  endpointId?: string;
  running: boolean;
  /** CLI 进程还开着（哪怕闲着）。Claude Code / Grok 能判断。 */
  online?: boolean;
  pid?: number;
  createdAt: number;
  updatedAt: number;
  preview: string;
  source: "history" | "live" | "new";
  messagesFile?: string;
  messagesFiles?: string[];
};

export type AgentTraceItem =
  | { type: "thinking"; text: string }
  | { type: "tool"; name: string; detail?: string; diff?: FileDiff[]; ask?: AgentAsk };

export type AgentMessage = {
  id: string;
  role: "user" | "assistant" | "notice";
  content: string;
  thinking?: string;
  tools?: { name: string; detail?: string }[];
  trace?: AgentTraceItem[];
  modelKey?: string;
  fromModelKey?: string;
  createdAt: number;
};

export type ChatEvent =
  | { type: "delta"; text: string }
  | { type: "replace"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool"; name: string; detail?: string; diff?: FileDiff[]; ask?: AgentAsk }
  | { type: "model"; modelId: string }
  | { type: "session"; cliSessionId: string }
  | { type: "error"; message: string }
  | { type: "reset"; reason: string }
  | {
      type: "usage";
      modelId?: string;
      /** 这一轮真正占用的窗口大小。各家口径不同，已在 chat-parse 里统一。 */
      contextTokens?: number;
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      reasoning: number;
      costUsd?: number;
      durationMs?: number;
    }
  | { type: "done" };

export type CliAuthKind = "grok-build" | "claude-code" | "codex";

export type CliUpdateState = {
  autoUpdate: boolean;
  running: DetectedCli["kind"] | null;
  queue: DetectedCli["kind"][];
  results: Partial<
    Record<DetectedCli["kind"], { at: number; ok: boolean; before?: string; after?: string; message: string }>
  >;
};

export type OfficialChatKind = "claude" | "grok" | "chatgpt";

export type OfficialQuota = {
  name: string;
  fiveHourPct?: number;
  weekPct?: number;
  weekReset?: string;
  credits?: number;
  resetCredits?: number;
};

export type OfficialQuotaMap = {
  claude?: OfficialQuota;
  grok?: OfficialQuota;
  chatgpt?: OfficialQuota;
};

export type CliAuthStatus = {
  kind: CliAuthKind;
  installed: boolean;
  loggedIn: boolean;
  email: string;
  account: string;
};

export type AllAiDesktop = {
  isDesktop: true;
  detect: () => Promise<DetectedCli[]>;
  pickFolder: () => Promise<string | null>;
  start: (
    opts: PtyStartRequest,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  write: (sessionId: string, data: string) => void;
  resize: (sessionId: string, cols: number, rows: number) => void;
  kill: (sessionId: string) => Promise<void>;
  attach: (
    sessionId: string,
  ) => Promise<{ history: string; session: DesktopSession | null }>;
  listSessions: () => Promise<DesktopSession[]>;
  onData: (cb: (sessionId: string, data: string) => void) => () => void;
  onExit: (cb: (sessionId: string, exitCode: number) => void) => () => void;
  onSessions: (cb: (sessions: DesktopSession[]) => void) => () => void;
  scanWorks: () => Promise<AgentWork[]>;
  loadMessages: (work: AgentWork) => Promise<AgentMessage[]>;
  prompt: (opts: {
    sessionId: string;
    agentId: string;
    prompt: string;
    cwd: string;
    resumeId?: string;
    newSessionId?: string;
    model?: string;
    endpointId?: string;
    providerId?: string;
    effort?: string;
    images?: string[];
    webSearch?: boolean;
    permissionMode?: string;
    history?: { role: "user" | "assistant"; content: string }[];
    elevated?: boolean;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
  ensureAdmin: () => Promise<{ ok: true; elevated: boolean } | { ok: false; error: string }>;
  adminStatus: () => Promise<{ elevated: boolean; linked: boolean; script: string }>;
  showChatGpt: (bounds: { x: number; y: number; width: number; height: number }) => Promise<void>;
  hideChatGpt: () => Promise<void>;
  revealPath: (href: string, cwd?: string) => Promise<boolean>;
  officialQuota: () => Promise<OfficialQuotaMap>;
  /** 扫一遍本机所有 CLI 的用量（增量）。见 electron/usage-scan.ts。 */
  scanUsage: () => Promise<{ files: number; changed: number; skipped: boolean }>;
  /** CC Switch 的历史用量：doImport=false 只预览，true 才真的导入。 */
  ccSwitchUsage: (doImport: boolean) => Promise<CcSwitchPreview>;
  notify: (payload: { title: string; body?: string; evenIfFocused?: boolean }) => Promise<{ shown: boolean }>;
  login: (agentId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  deleteWork: (work: AgentWork) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** 盯住这条工作的会话文件，有新内容就通过 onWorkMessages 推过来。 */
  windowState: () => Promise<{ maximized: boolean }>;
  windowMinimize: () => Promise<void>;
  windowToggleMaximize: () => Promise<void>;
  windowClose: () => Promise<void>;
  onWindowState: (cb: (state: { maximized: boolean }) => void) => () => void;
  watchWork: (work: AgentWork) => Promise<{ ok: true } | { ok: false; error: string }>;
  unwatchWork: () => Promise<{ ok: true }>;
  onWorkMessages: (
    cb: (payload: {
      workId: string;
      messages: AgentMessage[];
      running: boolean;
      online?: boolean;
      /** CLI 自己报的窗口占用。比我们按字符估的准得多，见 readContextUsage。 */
      context?: { tokens: number; window?: number };
    }) => void,
  ) => () => void;
  /** 单独问一次 CLI 自报的上下文占用（打开一条工作时用）。 */
  workContext: (
    work: Pick<AgentWork, "kind" | "cliSessionId"> & { messagesFile?: string },
  ) => Promise<{ tokens: number; window?: number } | null>;
  /** Computer Use：先最小化 AllAi 并锁定它后面的目标窗口。 */
  computerBegin: () => Promise<
    | { ok: true; target: { id: string; pid: number; title: string; x: number; y: number; width: number; height: number } }
    | { ok: false; error: string }
  >;
  computerScreenshot: () => Promise<
    | {
        ok: true;
        shot: {
          dataUrl: string;
          width: number;
          height: number;
          target: { id: string; pid: number; title: string; x: number; y: number; width: number; height: number };
          changedRatio?: number;
          controls?: { id: number; type: string; name: string; x: number; y: number; width: number; height: number }[];
          windows?: { id: string; title: string }[];
        };
      }
    | { ok: false; error: string }
  >;
  computerAct: (
    action: unknown,
    shot: {
      width: number;
      height: number;
      target: { id: string; pid: number; title: string; x: number; y: number; width: number; height: number };
    },
  ) => Promise<
    | { ok: true; cursor?: { x: number; y: number }; foreground?: { title: string; x: number; y: number; width: number; height: number } }
    | { ok: false; error: string }
  >;
  /** 显示 AllAi 来做极少数关键确认；确认后再恢复目标窗口。 */
  computerPause: () => Promise<void>;
  computerResume: () => Promise<{ ok: true; target: unknown } | { ok: false; error: string }>;
  computerInfo: () => Promise<{ running: boolean; script: string; logical: { width: number; height: number }; physical: { width: number; height: number } | null; shotWidth: number; target?: unknown }>;
  computerStop: () => Promise<{ ok: true }>;
  cliAuthStatus: (kind: CliAuthKind, command?: string) => Promise<CliAuthStatus>;
  cliAuthLogin: (
    kind: CliAuthKind,
    command?: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  cliAuthLogout: (
    kind: CliAuthKind,
    command?: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  cliListModels: (
    kind: CliAuthKind,
    command?: string,
  ) => Promise<
    | { ok: true; models: { id: string; label: string; reasoningLevels?: string[] }[] }
    | { ok: false; error: string }
  >;
  officialChat: (opts: {
    kind: OfficialChatKind;
    sessionId: string;
    prompt: string;
    resumeId?: string;
    newSessionId?: string;
    model?: string;
    effort?: string;
    webSearch?: boolean;
    history?: { role: "user" | "assistant"; content: string }[];
    elevated?: boolean;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
  onChat: (cb: (sessionId: string, event: ChatEvent) => void) => () => void;
  /** 更新本机 CLI（不传就是全部）。排队执行，跑完返回状态。 */
  cliUpdate: (kinds?: string[]) => Promise<CliUpdateState>;
  cliUpdateState: () => Promise<CliUpdateState>;
  cliSetAutoUpdate: (value: boolean) => Promise<CliUpdateState>;
  onCliUpdateState: (cb: (state: CliUpdateState) => void) => () => void;
  remoteConfig: () => Promise<RemoteConfig>;
  remoteStatus: () => Promise<RemoteStatus>;
  remoteLog: () => Promise<{ at: number; device: string; action: string }[]>;
  remoteSave: (
    patch: Partial<Pick<RemoteConfig, "enabled" | "relayUrl" | "desktopName">> & {
      token?: string;
      caps?: Partial<RemoteCaps>;
    },
  ) => Promise<{ ok: true; config: RemoteConfig } | { ok: false; error: string }>;
  remotePair: () => Promise<{ ok: true; link: string; expiresAt: number } | { ok: false; error: string }>;
  remoteCancelPair: () => Promise<void>;
  remoteRevoke: (id: string) => Promise<RemoteConfig>;
  remoteRename: (id: string, name: string) => Promise<RemoteConfig>;
  remotePublish: (snapshot: unknown) => void;
  remoteReply: (id: string, reply: { ok: true; result?: unknown } | { ok: false; error: string }) => void;
  onRemoteCommand: (cb: (command: RemoteCommand) => void) => () => void;
  onRemoteStatus: (cb: (status: RemoteStatus) => void) => () => void;
  onRemotePaired: (cb: (device: { id: string; name: string }) => void) => () => void;
};

export type RemoteCaps = { followPermission: boolean; allowAdmin: boolean };

export type RemoteConfig = {
  enabled: boolean;
  relayUrl: string;
  hasToken: boolean;
  desktopName: string;
  caps: RemoteCaps;
  devices: { id: string; name: string; createdAt: number; lastSeen?: number }[];
};

export type RemoteStatus = {
  state: "off" | "connecting" | "online" | "error";
  error?: string;
  sessions: { id: string; name: string }[];
};

export type RemoteCommand = { id: string; op: string; args: Record<string, unknown> };

export type CcSwitchPreview = {
  found: boolean;
  path: string;
  days: number;
  requests: number;
  tokens: number;
  costUsd: number;
  from: string;
  to: string;
  bySource: { source: string; requests: number; costUsd: number }[];
};

declare global {
  interface Window {
    allaiDesktop?: AllAiDesktop;
  }
}

export {};
