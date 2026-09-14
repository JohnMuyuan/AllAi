import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("allaiDesktop", {
  isDesktop: true,
  detect: () => ipcRenderer.invoke("cli:detect"),
  pickFolder: () => ipcRenderer.invoke("dialog:folder"),
  start: (opts: unknown) => ipcRenderer.invoke("pty:start", opts),
  write: (sessionId: string, data: string) => ipcRenderer.send("pty:write", sessionId, data),
  resize: (sessionId: string, cols: number, rows: number) =>
    ipcRenderer.send("pty:resize", sessionId, cols, rows),
  kill: (sessionId: string) => ipcRenderer.invoke("pty:kill", sessionId),
  attach: (sessionId: string) => ipcRenderer.invoke("pty:attach", sessionId),
  listSessions: () => ipcRenderer.invoke("pty:list"),
  onData: (cb: (sessionId: string, data: string) => void) => {
    const listener = (_event: unknown, sessionId: string, data: string) => cb(sessionId, data);
    ipcRenderer.on("pty:data", listener);
    return () => ipcRenderer.removeListener("pty:data", listener);
  },
  onExit: (cb: (sessionId: string, exitCode: number) => void) => {
    const listener = (_event: unknown, sessionId: string, exitCode: number) => cb(sessionId, exitCode);
    ipcRenderer.on("pty:exit", listener);
    return () => ipcRenderer.removeListener("pty:exit", listener);
  },
  onSessions: (cb: (sessions: unknown[]) => void) => {
    const listener = (_event: unknown, sessions: unknown[]) => cb(sessions);
    ipcRenderer.on("pty:sessions", listener);
    return () => ipcRenderer.removeListener("pty:sessions", listener);
  },
  scanWorks: () => ipcRenderer.invoke("agent:works"),
  loadMessages: (work: unknown) => ipcRenderer.invoke("agent:messages", work),
  workContext: (work: unknown) => ipcRenderer.invoke("agent:context", work),
  computerBegin: () => ipcRenderer.invoke("computer:begin"),
  computerScreenshot: () => ipcRenderer.invoke("computer:screenshot"),
  computerAct: (action: unknown, shot: unknown) => ipcRenderer.invoke("computer:act", action, shot),
  computerPause: () => ipcRenderer.invoke("computer:pause"),
  computerResume: () => ipcRenderer.invoke("computer:resume"),
  computerInfo: () => ipcRenderer.invoke("computer:info"),
  computerStop: () => ipcRenderer.invoke("computer:stop"),
  prompt: (opts: unknown) => ipcRenderer.invoke("agent:prompt", opts),
  ensureAdmin: () => ipcRenderer.invoke("admin:ensure"),
  adminStatus: () => ipcRenderer.invoke("admin:status"),
  login: (agentId: string) => ipcRenderer.invoke("agent:login", agentId),
  deleteWork: (work: unknown) => ipcRenderer.invoke("agent:delete-work", work),
  windowState: () => ipcRenderer.invoke("window:state"),
  windowMinimize: () => ipcRenderer.invoke("window:minimize"),
  windowToggleMaximize: () => ipcRenderer.invoke("window:toggle-maximize"),
  windowClose: () => ipcRenderer.invoke("window:close"),
  setTheme: (theme: "light" | "dark") => ipcRenderer.send("theme:resolved", theme),
  onWindowState: (cb: (state: { maximized: boolean }) => void) => {
    const listener = (_event: unknown, state: { maximized: boolean }) => cb(state);
    ipcRenderer.on("window:state", listener);
    return () => ipcRenderer.removeListener("window:state", listener);
  },
  watchWork: (work: unknown) => ipcRenderer.invoke("agent:watch-work", work),
  unwatchWork: () => ipcRenderer.invoke("agent:unwatch-work"),
  onWorkMessages: (cb: (payload: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on("agent:work-messages", listener);
    return () => ipcRenderer.removeListener("agent:work-messages", listener);
  },
  cliAuthStatus: (kind: string, command?: string) =>
    ipcRenderer.invoke("cli:auth-status", kind, command),
  cliAuthLogin: (kind: string, command?: string) =>
    ipcRenderer.invoke("cli:auth-login", kind, command),
  cliAuthLogout: (kind: string, command?: string) =>
    ipcRenderer.invoke("cli:auth-logout", kind, command),
  cliListModels: (kind: string, command?: string) =>
    ipcRenderer.invoke("cli:models", kind, command),
  officialChat: (opts: unknown) => ipcRenderer.invoke("official:chat", opts),
  officialProbe: (opts: unknown) => ipcRenderer.invoke("official:probe", opts),
  showChatGpt: (bounds: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.invoke("chatgpt:show", bounds),
  hideChatGpt: () => ipcRenderer.invoke("chatgpt:hide"),
  revealPath: (href: string, cwd?: string) => ipcRenderer.invoke("shell:reveal", href, cwd),
  officialQuota: () => ipcRenderer.invoke("quota:official"),
  /** 扫一遍本机所有 CLI 的用量（增量）。 */
  scanUsage: () => ipcRenderer.invoke("usage:scan"),
  /** doImport=false 只看有什么可导的，true 才真的写进来。 */
  ccSwitchUsage: (doImport: boolean) => ipcRenderer.invoke("usage:cc-switch", doImport),
  notify: (payload: { title: string; body?: string; evenIfFocused?: boolean }) =>
    ipcRenderer.invoke("notify:show", payload),
  remoteConfig: () => ipcRenderer.invoke("remote:config"),
  remoteStatus: () => ipcRenderer.invoke("remote:status"),
  remoteLog: () => ipcRenderer.invoke("remote:log"),
  remoteSave: (patch: unknown) => ipcRenderer.invoke("remote:save", patch),
  remotePair: () => ipcRenderer.invoke("remote:pair"),
  remoteCancelPair: () => ipcRenderer.invoke("remote:cancel-pair"),
  remoteRevoke: (id: string) => ipcRenderer.invoke("remote:revoke", id),
  remoteRename: (id: string, name: string) => ipcRenderer.invoke("remote:rename", id, name),
  remotePublish: (snapshot: unknown) => ipcRenderer.send("remote:publish", snapshot),
  remoteReply: (id: string, reply: unknown) => ipcRenderer.send("remote:reply", id, reply),
  onRemoteCommand: (cb: (command: unknown) => void) => {
    const listener = (_event: unknown, command: unknown) => cb(command);
    ipcRenderer.on("remote:command", listener);
    return () => ipcRenderer.removeListener("remote:command", listener);
  },
  onRemoteStatus: (cb: (status: unknown) => void) => {
    const listener = (_event: unknown, value: unknown) => cb(value);
    ipcRenderer.on("remote:status", listener);
    return () => ipcRenderer.removeListener("remote:status", listener);
  },
  onRemotePaired: (cb: (device: unknown) => void) => {
    const listener = (_event: unknown, device: unknown) => cb(device);
    ipcRenderer.on("remote:paired", listener);
    return () => ipcRenderer.removeListener("remote:paired", listener);
  },
  cliUpdate: (kinds?: string[]) => ipcRenderer.invoke("cli:update", kinds),
  cliUpdateState: () => ipcRenderer.invoke("cli:update-state"),
  cliSetAutoUpdate: (value: boolean) => ipcRenderer.invoke("cli:auto-update", value),
  onCliUpdateState: (cb: (state: unknown) => void) => {
    const listener = (_event: unknown, state: unknown) => cb(state);
    ipcRenderer.on("cli:update-state", listener);
    return () => ipcRenderer.removeListener("cli:update-state", listener);
  },
  /** AllAi 自己的更新。查到的版本在后台下载，退出时自动装。 */
  appUpdateCheck: () => ipcRenderer.invoke("app:update-check"),
  appUpdateState: () => ipcRenderer.invoke("app:update-state"),
  appInstallUpdate: () => ipcRenderer.invoke("app:update-install"),
  appSetAutoUpdate: (value: boolean) => ipcRenderer.invoke("app:auto-update", value),
  onAppUpdateState: (cb: (state: unknown) => void) => {
    const listener = (_event: unknown, state: unknown) => cb(state);
    ipcRenderer.on("app:update-state", listener);
    return () => ipcRenderer.removeListener("app:update-state", listener);
  },
  onChat: (cb: (sessionId: string, event: unknown) => void) => {
    const listener = (_event: unknown, sessionId: string, event: unknown) => cb(sessionId, event);
    ipcRenderer.on("agent:event", listener);
    return () => ipcRenderer.removeListener("agent:event", listener);
  },
});
