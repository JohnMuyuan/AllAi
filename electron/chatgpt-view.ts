import { BrowserView, BrowserWindow, WebContentsView, session } from "electron";

export type ChatGptBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

let view: WebContentsView | BrowserView | null = null;
let usingWebContentsView = false;
let attached: BrowserWindow | null = null;

function chromeUa() {
  return session.defaultSession
    .getUserAgent()
    .replace(/\sElectron\/\S+/i, "")
    .replace(/\sallai\/\S+/i, "");
}

function webContentsOf() {
  if (!view) return null;
  return view.webContents;
}

function ensureView() {
  if (view) return view;
  const ses = session.fromPartition("persist:chatgpt");
  ses.setUserAgent(chromeUa());
  const webPreferences = {
    partition: "persist:chatgpt",
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
  };
  if (typeof WebContentsView === "function") {
    usingWebContentsView = true;
    view = new WebContentsView({ webPreferences });
  } else {
    usingWebContentsView = false;
    view = new BrowserView({ webPreferences });
  }
  const wc = webContentsOf();
  if (wc) {
    wc.setWindowOpenHandler(({ url }) => {
      if (!/^https?:\/\//i.test(url)) return { action: "deny" };
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 920,
          height: 720,
          autoHideMenuBar: true,
          webPreferences: {
            partition: "persist:chatgpt",
            sandbox: true,
            nodeIntegration: false,
            contextIsolation: true,
          },
        },
      };
    });
    void wc.loadURL("https://chatgpt.com");
  }
  return view;
}

function detach() {
  if (!attached || !view) {
    attached = null;
    return;
  }
  try {
    if (usingWebContentsView) {
      attached.contentView.removeChildView(view as WebContentsView);
    } else {
      attached.removeBrowserView(view as BrowserView);
    }
  } catch {
    // already detached
  }
  attached = null;
}

function attachTo(win: BrowserWindow) {
  const current = ensureView();
  if (attached && attached !== win) detach();
  if (attached === win) return;
  if (usingWebContentsView) {
    win.contentView.addChildView(current as WebContentsView);
  } else {
    win.addBrowserView(current as BrowserView);
  }
  attached = win;
}

export function showChatGpt(win: BrowserWindow, bounds: ChatGptBounds) {
  if (bounds.width < 40 || bounds.height < 40) {
    hideChatGpt();
    return;
  }
  attachTo(win);
  view?.setBounds({
    x: Math.max(0, Math.round(bounds.x)),
    y: Math.max(0, Math.round(bounds.y)),
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height)),
  });
}

export function hideChatGpt() {
  detach();
}

export function destroyChatGpt() {
  hideChatGpt();
  try {
    webContentsOf()?.close();
  } catch {
    // ignore
  }
  view = null;
}
