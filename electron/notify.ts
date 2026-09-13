import { Notification, type BrowserWindow } from "electron";

let mainWindow: BrowserWindow | null = null;

export function setNotifyWindow(win: BrowserWindow | null) {
  mainWindow = win;
}

export function windowFocused() {
  return Boolean(mainWindow?.isFocused());
}

/** 应用级通知。Agent 做完、额度到点用这个，不弹窗。 */
export function showNotice(title: string, body: string) {
  if (!Notification.isSupported()) return false;
  try {
    const notice = new Notification({ title, body, silent: false });
    notice.on("click", () => {
      mainWindow?.show();
      mainWindow?.focus();
    });
    notice.show();
    return true;
  } catch {
    return false;
  }
}
