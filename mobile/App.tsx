import { Bot, ChevronDown, ImageIcon, LoaderCircle, MessageSquare, MonitorSmartphone, ScanLine, Trash2, WifiOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT, type Translate } from "../components/I18n";
import { parseInvite, type PairingInvite } from "../electron/remote-protocol";
import { DesktopLink, listDesktops, pairWith, removeDesktop, type LinkState, type SavedDesktop } from "./link";
import {
  ConfirmSheet,
  Disconnected,
  Notify,
  Sheet,
  applyPatch,
  errorText,
  useNotify,
  type AgentMsg,
  type ChatMsg,
  type Meta,
  type Thread,
  type ThreadPatch,
} from "./ui";
import { Scanner, canScan } from "./Scanner";
import { AgentPane, ChatPane, StudioPane } from "./views";

type Tab = "chat" | "agents" | "studio";

function guessDeviceName(t: Translate) {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua)) return "iPad";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? t("Android 手机") : t("Android 平板");
  if (/Mac OS X/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return t("Windows 电脑");
  return t("我的设备");
}

function readStorage(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 无痕模式下写不了，不影响使用
  }
}

export function App() {
  const t = useT();
  const [desktops, setDesktops] = useState<SavedDesktop[] | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(() => readStorage("allai-remote-current"));
  const [invite, setInvite] = useState<PairingInvite | null>(() => parseInvite(location.hash));
  const [toast, setToast] = useState("");
  const [loadError, setLoadError] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanAvailable] = useState(canScan);
  const toastTimer = useRef(0);

  const notify = useCallback((text: string) => {
    setToast(text);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 3200);
  }, []);

  const reload = useCallback(async () => {
    try {
      setDesktops(await listDesktops());
    } catch (error) {
      setLoadError(errorText(error));
      setDesktops([]);
    }
  }, []);

  useEffect(() => {
    listDesktops()
      .then(setDesktops)
      .catch((error: unknown) => {
        setLoadError(errorText(error));
        setDesktops([]);
      });
  }, []);

  const current = desktops?.find((item) => item.desktopId === currentId) ?? desktops?.[0] ?? null;

  /** 扫出来的必须是这个中继自己的配对链接：别的地址的码配了也连不上，还可能是钓鱼链接。 */
  function handleScan(text: string) {
    setScanning(false);
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      notify(t("这不是 AllAi 的配对二维码"));
      return;
    }
    if (url.origin !== location.origin) {
      notify(t("这个二维码属于另一个中继地址（{host}），请在那个地址打开", { host: url.host }));
      return;
    }
    const scanned = parseInvite(url.hash);
    if (!scanned) {
      notify(t("这不是 AllAi 的配对二维码"));
      return;
    }
    setInvite(scanned);
  }

  function select(id: string) {
    setCurrentId(id);
    writeStorage("allai-remote-current", id);
  }

  let body: React.ReactNode;
  if (invite) {
    body = (
      <PairScreen
        invite={invite}
        onDone={async (saved) => {
          history.replaceState(null, "", location.pathname + location.search);
          setInvite(null);
          await reload();
          if (saved) {
            select(saved.desktopId);
            notify(t("已和「{name}」配对", { name: saved.name }));
          }
        }}
      />
    );
  } else if (desktops === null) {
    body = (
      <div className="grid h-full place-items-center">
        <LoaderCircle className="size-6 animate-spin text-muted" />
      </div>
    );
  } else if (!current) {
    body = <Welcome error={loadError} onScan={scanAvailable ? () => setScanning(true) : undefined} />;
  } else {
    body = (
      <RemoteScreen
        key={current.desktopId}
        desktop={current}
        desktops={desktops}
        onSwitch={select}
        onScan={scanAvailable ? () => setScanning(true) : undefined}
        onRemoved={async () => {
          await removeDesktop(current.desktopId);
          await reload();
        }}
      />
    );
  }

  return (
    <Notify.Provider value={notify}>
      <div className="remote-shell safe-top flex h-dvh flex-col bg-canvas text-ink">{body}</div>
      {scanning ? <Scanner onResult={handleScan} onClose={() => setScanning(false)} /> : null}
      {toast ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-6">
          <div className="toast-enter rounded-xl bg-ink px-4 py-2 text-sm text-canvas shadow-lg">{t(toast)}</div>
        </div>
      ) : null}
    </Notify.Provider>
  );
}

function Welcome({ error, onScan }: { error: string; onScan?: () => void }) {
  const t = useT();
  return (
    <div className="grid h-full place-items-center px-8 text-center">
      <div>
        <MonitorSmartphone className="mx-auto mb-4 size-12 text-muted" />
        <p className="text-lg font-medium">{t("AllAi 远程")}</p>
        <p className="mt-3 text-sm leading-6 text-muted">
          {t("在电脑上的 AllAi 里打开「设置 → 远程」，点「生成配对二维码」，")}
          {onScan ? t("然后点下面的「扫码配对」。") : t("然后用手机相机扫码。")}
        </p>
        {onScan ? (
          <button
            type="button"
            onClick={onScan}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-3 text-[15px] font-medium text-accent-fg"
          >
            <ScanLine className="size-5" />
            {t("扫码配对")}
          </button>
        ) : null}
        <p className="mt-3 text-xs leading-5 text-muted">{t("手机和电脑之间端到端加密，中继服务器看不到内容。")}</p>
        {error ? <p className="mt-3 text-xs text-danger">{t(error)}</p> : null}
      </div>
    </div>
  );
}

function PairScreen({ invite, onDone }: { invite: PairingInvite; onDone: (saved: SavedDesktop | null) => void }) {
  const t = useT();
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const deviceName = name ?? guessDeviceName(t);
  return (
    <div className="grid h-full place-items-center px-6">
      <div className="w-full max-w-sm">
        <MonitorSmartphone className="mx-auto mb-4 size-12 text-accent" />
        <p className="text-center text-lg font-medium">{t("和「{name}」配对", { name: invite.n })}</p>
        <p className="mt-2 text-center text-sm leading-6 text-muted">
          {t("配对后这台设备可以操控那台电脑上的 AllAi。只在你自己的设备上配对。")}
        </p>
        <label className="mt-6 grid gap-1 text-xs text-muted">
          {t("这台设备的名字（电脑上会显示）")}
          <input
            value={deviceName}
            onChange={(event) => setName(event.target.value)}
            className="rounded-xl border border-line bg-elevated px-3 py-2.5 text-ink outline-none focus:border-accent"
          />
        </label>
        {error ? <p className="mt-3 text-sm text-danger">{t(error)}</p> : null}
        <button
          type="button"
          disabled={busy || !deviceName.trim()}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              onDone(await pairWith(invite, deviceName.trim()));
            } catch (err) {
              setError(errorText(err));
            } finally {
              setBusy(false);
            }
          }}
          className="mt-5 w-full rounded-xl bg-accent py-3 text-[15px] font-medium text-accent-fg disabled:opacity-40"
        >
          {busy ? t("配对中…") : t("配对")}
        </button>
        <button type="button" onClick={() => onDone(null)} className="mt-2 w-full py-2 text-sm text-muted">
          {t("取消")}
        </button>
      </div>
    </div>
  );
}

function RemoteScreen({
  desktop,
  desktops,
  onSwitch,
  onScan,
  onRemoved,
}: {
  desktop: SavedDesktop;
  desktops: SavedDesktop[];
  onSwitch: (id: string) => void;
  onScan?: () => void;
  onRemoved: () => Promise<void>;
}) {
  const [state, setState] = useState<LinkState>("connecting");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [chatThread, setChatThread] = useState<Thread<ChatMsg>>();
  const [agentThread, setAgentThread] = useState<Thread<AgentMsg>>();
  const [studioTick, setStudioTick] = useState(0);
  const [tab, setTabState] = useState<Tab>(() => (readStorage("allai-remote-tab") as Tab) || "agents");
  const [screens, setScreens] = useState<Record<Tab, "list" | "thread">>({ chat: "list", agents: "list", studio: "list" });
  const [menu, setMenu] = useState(false);
  const [removing, setRemoving] = useState(false);
  const t = useT();
  const notify = useNotify();
  // 连接的回调在 useMemo 里建一次，拿 ref 读最新的提示函数。
  const notifyRef = useRef(notify);
  const tRef = useRef(t);
  useEffect(() => {
    notifyRef.current = notify;
    tRef.current = t;
  }, [notify, t]);

  /*
   * 连不上超过一会儿，就整屏换成「已断开」。
   *
   * 只看 state 不行：每次重连都会先经过 connecting，那一下整屏跳掉太吵。
   * 所以 offline（中继明确说电脑不在线）立刻换，connecting 拖过 4 秒才换。
   */
  const [slow, setSlow] = useState(false);
  const stalled = state === "offline" || slow;
  useEffect(() => {
    // 只在「连着但一直没好」时装表；变 ready 时由 onState 回调清掉（别在 effect 里同步 setState）。
    if (state === "ready" || state === "offline") return;
    const timer = window.setTimeout(() => setSlow(true), 4000);
    return () => window.clearTimeout(timer);
  }, [state]);

  const link = useMemo(() => new DesktopLink(desktop), [desktop]);

  useEffect(() => {
    link.start({
      onState: (next) => {
        setState(next);
        if (next === "ready") setSlow(false);
      },
      onReady: () => {
        void link.call("sync").catch((error) => notifyRef.current(tRef.current(errorText(error))));
      },
      onEvent: (ev, data) => {
        if (ev === "state") setMeta(data as Meta);
        if (ev === "thread") {
          const patch = data as ThreadPatch;
          if (patch.area === "chat") setChatThread((prev) => applyPatch(prev, patch));
          if (patch.area === "agent") setAgentThread((prev) => applyPatch(prev, patch));
        }
        if (ev === "studio") {
          setStudioTick((value) => value + 1);
          const error = (data as { error?: string }).error;
          if (error) notifyRef.current(tRef.current("创作失败：{error}", { error }));
        }
      },
    });
    return () => link.stop();
  }, [link]);

  // 手机的返回键 / 返回手势：从对话里退回列表，而不是直接离开页面。
  useEffect(() => {
    const onPop = () => setScreens({ chat: "list", agents: "list", studio: "list" });
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function setTab(next: Tab) {
    setTabState(next);
    writeStorage("allai-remote-tab", next);
  }

  const open = (which: Tab) => () => {
    setScreens((current) => ({ ...current, [which]: "thread" }));
    history.pushState({ allai: which }, "");
  };
  const back = (which: Tab) => () => {
    if (history.state?.allai) history.back();
    else setScreens((current) => ({ ...current, [which]: "list" }));
  };

  if (state === "denied") {
    return (
      <div className="grid h-full place-items-center px-8 text-center">
        <div>
          <WifiOff className="mx-auto mb-4 size-10 text-danger" />
          <p className="text-base font-medium">{t("「{name}」已经移除了这台设备", { name: desktop.name })}</p>
          <p className="mt-2 text-sm text-muted">{t("要继续用，请在电脑上重新生成二维码配对。")}</p>
          <button type="button" onClick={() => void onRemoved()} className="mt-5 rounded-xl border border-line px-4 py-2 text-sm">
            {t("删除这台电脑的记录")}
          </button>
        </div>
      </div>
    );
  }

  const banner =
    state === "ready"
      ? null
      : state === "offline"
        ? t("「{name}」不在线：电脑要开着、AllAi 要开着远程控制", { name: desktop.name })
        : t("正在连接…");

  return (
          <>
            <div className="flex h-9 shrink-0 items-center gap-2 bg-canvas px-3 text-xs">
              <button type="button" onClick={() => setMenu(true)} className="flex min-w-0 items-center gap-1.5">
                <span
                  className={`size-2 shrink-0 rounded-full ${
                    state === "ready" ? "bg-emerald-500" : state === "offline" ? "bg-danger" : "bg-amber-500"
                  }`}
                />
                <span className="truncate font-medium">{desktop.name}</span>
                <ChevronDown className="size-3.5 shrink-0 text-muted" />
              </button>
              {banner && !stalled ? (
                <span className="ml-auto truncate text-muted">{banner}</span>
              ) : null}
            </div>

            <div className="flex min-h-0 flex-1 flex-col">
              {stalled ? (
                <Disconnected
                  name={desktop.name}
                  connecting={state !== "offline"}
                  onScan={onScan}
                  onSwitch={desktops.length > 1 ? () => setMenu(true) : undefined}
                />
              ) : !meta ? (
                <div className="grid h-full place-items-center text-sm text-muted">
                  {state === "ready" ? t("同步中…") : banner}
                </div>
              ) : (
                <>
                  {tab === "chat" ? (
                    <div className="flex min-h-0 flex-1 flex-col">
                      <ChatPane link={link} meta={meta} thread={chatThread} screen={screens.chat} open={open("chat")} back={back("chat")} />
                    </div>
                  ) : null}
                  {tab === "agents" ? (
                    <div className="flex min-h-0 flex-1 flex-col">
                      <AgentPane link={link} meta={meta} thread={agentThread} screen={screens.agents} open={open("agents")} back={back("agents")} />
                    </div>
                  ) : null}
                  {tab === "studio" ? (
                    <div className="flex min-h-0 flex-1 flex-col">
                      <StudioPane link={link} meta={meta} screen={screens.studio} open={open("studio")} back={back("studio")} tick={studioTick} visible={state === "ready"} />
                    </div>
                  ) : null}
                </>
              )}
            </div>

            {screens[tab] === "list" && !stalled ? (
              <nav className="safe-bottom grid shrink-0 grid-cols-3 border-t border-line bg-sidebar">
                {(
                  [
                    ["chat", t("聊天"), MessageSquare],
                    ["agents", t("Agent"), Bot],
                    ["studio", t("创作"), ImageIcon],
                  ] as const
                ).map(([id, label, Icon]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTab(id)}
                    className={`flex flex-col items-center gap-0.5 py-2 text-[11px] ${tab === id ? "text-accent" : "text-muted"}`}
                  >
                    <Icon className="size-5" />
                    {label}
                  </button>
                ))}
              </nav>
            ) : null}

            {menu ? (
              <Sheet title={t("已配对的电脑")} onClose={() => setMenu(false)}>
                  <div className="grid gap-1">
                    {desktops.map((item) => (
                      <button
                        key={item.desktopId}
                        type="button"
                        onClick={() => {
                          setMenu(false);
                          onSwitch(item.desktopId);
                        }}
                        className={`rounded-xl px-3 py-2.5 text-left text-[15px] ${
                          item.desktopId === desktop.desktopId ? "bg-user font-medium" : ""
                        }`}
                      >
                        {item.name}
                      </button>
                    ))}
                  </div>
                  <p className="mt-3 text-xs leading-5 text-muted">
                    {t("要加一台电脑：在那台电脑的 AllAi「设置 → 远程」里生成二维码，")}
                    {onScan ? t("点下面扫码。") : t("用手机扫。")}
                  </p>
                  {onScan ? (
                    <button
                      type="button"
                      onClick={() => {
                        setMenu(false);
                        onScan();
                      }}
                      className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-2.5 text-sm font-medium text-accent-fg"
                    >
                      <ScanLine className="size-4" />
                      {t("扫码添加电脑")}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      setMenu(false);
                      setRemoving(true);
                    }}
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-line py-2.5 text-sm text-danger"
                  >
                    <Trash2 className="size-4" />
                    {t("删除「{name}」的配对", { name: desktop.name })}
                  </button>
              </Sheet>
            ) : null}
            {removing ? (
              <ConfirmSheet
                title={t("删除「{name}」的配对？", { name: desktop.name })}
                detail={t("电脑那边也记得移除这台设备。")}
                confirmText={t("删除")}
                danger
                onClose={() => setRemoving(false)}
                onConfirm={() => {
                  setRemoving(false);
                  void onRemoved();
                }}
              />
            ) : null}
          </>
  );
}
