"use client";

import { LoaderCircle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getDesktop } from "@/lib/desktop";
import { APP_VERSION } from "@/lib/version";
import type { AppUpdateState, CliUpdateState, DetectedCli } from "@/types/desktop";
import { BrandMark } from "./BrandMarks";
import { Logo } from "./Logo";
import { useLang, useT } from "./I18n";

/**
 * 设置 → 关于：软件信息、声明、电脑上装了哪些 CLI，以及手动 / 启动时自动更新它们。
 * 更新在主进程里跑（electron/cli-update.ts），这里只显示状态、发指令。
 *
 * 上半截是 AllAi 自己的更新（electron/app-update.ts）：查到新版本会在后台下载，
 * 退出时自动装上；这里只是让它看得见、能手动催一下。
 */

function when(at: number, lang: string) {
  const date = new Date(at);
  if (lang === "en") {
    return date.toLocaleString("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;
}

export function AboutSettings() {
  const t = useT();
  const lang = useLang();
  const desktop = getDesktop();
  const [clis, setClis] = useState<DetectedCli[] | null>(null);
  const [state, setState] = useState<CliUpdateState | null>(null);
  const [upd, setUpd] = useState<AppUpdateState | null>(null);

  const refresh = useCallback(() => {
    const api = getDesktop();
    if (!api) return;
    void api
      .detect()
      .then(setClis)
      .catch(() => setClis([]));
  }, []);

  useEffect(() => {
    const api = getDesktop();
    if (!api?.cliUpdateState) return;
    refresh();
    void api.cliUpdateState().then(setState).catch(() => undefined);
    return api.onCliUpdateState((next) => {
      setState(next);
      // 一轮更新跑完，重新读一遍版本号。
      if (!next.running && !next.queue.length) refresh();
    });
  }, [refresh]);

  useEffect(() => {
    const api = getDesktop();
    if (!api?.appUpdateState) return;
    void api.appUpdateState().then(setUpd).catch(() => undefined);
    return api.onAppUpdateState(setUpd);
  }, []);

  const busy = Boolean(state?.running || state?.queue.length);

  /* AllAi 自己的更新。查 / 装各一个按钮，状态一律显示在下面这行，不弹窗（约定 22）。 */
  const checkApp = () => {
    const api = getDesktop();
    if (!api) return;
    void api.appUpdateCheck().then(setUpd).catch(() => undefined);
  };
  const installApp = () => {
    const api = getDesktop();
    if (!api) return;
    void api.appInstallUpdate().then(setUpd).catch(() => undefined);
  };
  const appBusy =
    upd?.status === "checking" || upd?.status === "available" || upd?.status === "downloading";
  const appLine = !upd
    ? t("读取中…")
    : upd.status === "unsupported"
      ? t("这个版本不能自动更新（开发模式），请手动装新版本。")
      : upd.status === "checking"
        ? t("正在检查更新…")
        : upd.status === "latest"
          ? t("已是最新版本。")
          : upd.status === "available"
            ? t("发现新版本 {v}，正在后台下载…", { v: upd.version ?? "" })
            : upd.status === "downloading"
              ? t("正在下载 {v}（{n}%）", { v: upd.version ?? "", n: upd.percent ?? 0 })
              : upd.status === "downloaded"
                ? t("{v} 已下载，退出 AllAi 时会自己装上。", { v: upd.version ?? "" })
                : upd.status === "error"
                  ? t("检查更新失败。")
                  : upd.at
                    ? t("上次检查：{when}", { when: when(upd.at, lang) })
                    : t("还没检查过。");

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <div className="mb-6 flex items-center gap-4">
        <Logo className="size-14" />
        <div>
          <div className="text-lg font-semibold">AllAi</div>
          <div className="text-sm text-muted">{t("高效地与AI工作")} · {t("版本")} {APP_VERSION}</div>
        </div>
      </div>

      <p className="mb-6 text-sm leading-6 text-muted">
        {t("AllAi 把聊天、本地 Agent（Claude Code、Codex、Grok Build）和生图 / 生视频放在同一个窗口里。对话、配置和上传的文件都保存在这台电脑的 ~/.allai 目录。")}
      </p>

      <div className="mb-6">
        <div className="mb-2 flex items-center gap-2">
          <div className="text-sm font-medium">{t("AllAi 更新")}</div>
          {desktop?.appUpdateCheck ? (
            <button
              type="button"
              disabled={appBusy}
              onClick={checkApp}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs hover:bg-user disabled:opacity-50"
            >
              {appBusy ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              {appBusy ? t("正在检查…") : t("检查更新")}
            </button>
          ) : null}
        </div>
        {!desktop ? (
          <p className="text-xs text-muted">{t("只有桌面版能检查更新。")}</p>
        ) : (
          <>
            <div className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-sm">{appLine}</div>
                {upd?.detail ? (
                  <div className="truncate font-mono text-[11px] text-muted" title={upd.detail}>
                    {upd.detail}
                  </div>
                ) : null}
              </div>
              {upd?.status === "downloaded" ? (
                <button
                  type="button"
                  onClick={installApp}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs hover:bg-user"
                >
                  <RefreshCw className="size-3.5" />
                  {t("立即重启并安装")}
                </button>
              ) : null}
            </div>
            {desktop && upd ? (
              <label className="mt-3 flex cursor-pointer items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 size-4 accent-[var(--accent)]"
                  checked={upd.autoUpdate}
                  onChange={(event) => void desktop.appSetAutoUpdate(event.target.checked).then(setUpd)}
                />
                <span>
                  {t("启动时自动检查更新")}
                  <span className="block text-xs text-muted">
                    {t("在后台下载，不影响使用。下好后退出 AllAi 会自动装上，下次打开就是新版本。")}
                  </span>
                </span>
              </label>
            ) : null}
          </>
        )}
      </div>

      <div className="mb-6">
        <div className="mb-2 flex items-center gap-2">
          <div className="text-sm font-medium">{t("电脑上已安装的 CLI")}</div>
          {desktop?.cliUpdate && clis?.length ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void desktop.cliUpdate()}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs hover:bg-user disabled:opacity-50"
            >
              {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              {busy ? t("更新中…") : t("全部更新")}
            </button>
          ) : null}
        </div>
        {!desktop ? (
          <p className="text-xs text-muted">{t("只有桌面版能查看和更新本机 CLI。")}</p>
        ) : clis === null ? (
          <p className="text-xs text-muted">{t("检测中…")}</p>
        ) : !clis.length ? (
          <p className="text-xs text-muted">{t("没有找到 Claude Code、Codex 或 Grok Build。装好后重新打开这一页即可。")}</p>
        ) : (
          <ul className="grid gap-2">
            {clis.map((cli) => {
              const result = state?.results[cli.kind];
              const running = state?.running === cli.kind;
              const queued = state?.queue.includes(cli.kind);
              return (
                <li key={cli.kind} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5">
                  <BrandMark kind={cli.kind} className="size-6 shrink-0 text-ink" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium">{cli.name}</span>
                      <span className="truncate text-xs text-muted">{cli.version}</span>
                    </div>
                    <div className="truncate font-mono text-[11px] text-muted" title={cli.command}>
                      {cli.command}
                    </div>
                    {running ? (
                      <div className="mt-0.5 text-[11px] text-accent">{t("正在更新…")}</div>
                    ) : queued ? (
                      <div className="mt-0.5 text-[11px] text-muted">{t("排队中")}</div>
                    ) : result ? (
                      <div className={`mt-0.5 truncate text-[11px] ${result.ok ? "text-muted" : "text-danger"}`} title={result.message}>
                        {when(result.at, lang)} · {t(result.message)}
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void desktop.cliUpdate?.([cli.kind])}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 text-xs text-muted hover:bg-user hover:text-ink disabled:opacity-50"
                  >
                    {running ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                    {t("更新")}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {desktop?.cliSetAutoUpdate && state ? (
          <label className="mt-3 flex cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1 size-4 accent-[var(--accent)]"
              checked={state.autoUpdate}
              onChange={(event) => void desktop.cliSetAutoUpdate(event.target.checked).then(setState)}
            />
            <span>
              {t("每次启动 AllAi 时自动更新所有 CLI")}
              <span className="block text-xs text-muted">
                {t("在后台跑，不影响使用。正在用的 CLI 可能更新失败（文件被占用），下次启动会再试。")}
              </span>
            </span>
          </label>
        ) : null}
      </div>

      <div className="mb-2 text-sm font-medium">{t("声明")}</div>
      <ul className="list-disc space-y-1.5 pl-5 text-xs leading-5 text-muted">
        <li>{t("AllAi 是个人使用的桌面工具，不收集、不上传你的对话和使用数据。")}</li>
        <li>
          {t("API Key 和登录凭据只保存在本机。你发给模型的内容会直接发到你配置的服务商或本机 CLI，请遵守对应服务的使用条款。")}
        </li>
        <li>
          {t("Claude Code、Codex、Grok Build 等 CLI 及其商标归各自的公司所有，AllAi 只调用你本机已经安装的程序，与这些公司没有关联。")}
        </li>
        <li>{t("AI 生成的内容和 Agent 对文件的改动可能有错，重要的改动请自己确认。")}</li>
      </ul>
    </div>
  );
}
