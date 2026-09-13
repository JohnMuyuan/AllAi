"use client";

import type { AppPrefs, PublicAgent, PublicProvider } from "@/lib/types";
import { LANGS, type LangMode } from "@/lib/i18n";
import { THEME_MODES, type ThemeMode } from "@/lib/theme";
import { useT } from "./I18n";
import { BrandIconSettings } from "./BrandIconSettings";
import { ContextSettings } from "./ContextSettings";
import { OptionSelect } from "./OptionSelect";
import { DEFAULT_STATS_FIELDS, STATS_FIELDS } from "./StatsBar";

type Props = {
  providers: PublicProvider[];
  agents: PublicAgent[];
  prefs: AppPrefs;
  onChange: (patch: Partial<AppPrefs>) => void;
  onToast?: (text: string) => void;
  /*
   * 外观和语言不进 db.json 的 prefs：它们必须在**读 prefs 之前**就生效
   * （首屏防闪烁那段脚本要用），所以存 localStorage，见 lib/theme.ts / lib/i18n.ts。
   */
  themeMode: ThemeMode;
  onThemeMode: (mode: ThemeMode) => void;
  langMode: LangMode;
  onLangMode: (mode: LangMode) => void;
};

function Row({
  title,
  hint,
  children,
}: {
  title: string;
  hint: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <div className="mb-1.5 text-sm font-medium">{title}</div>
      <div className="mb-2 text-xs leading-5 text-muted">{hint}</div>
      {children}
    </div>
  );
}

export function GeneralSettings({
  providers,
  agents,
  prefs,
  onChange,
  onToast,
  themeMode,
  onThemeMode,
  langMode,
  onLangMode,
}: Props) {
  const t = useT();
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <Row title={t("外观")} hint={t("深浅色。选「跟随系统」就跟着 Windows 的设置走，系统一换这边立刻跟着变。")}>
        <OptionSelect
          label={t("外观")}
          value={themeMode}
          onChange={(value) => onThemeMode(value as ThemeMode)}
          options={THEME_MODES.map((item) => ({
            value: item.value,
            label: t(item.label),
            description: t(item.hint),
          }))}
        />
      </Row>
      <Row title={t("语言")} hint={t("界面语言。")}>
        <OptionSelect
          label={t("语言")}
          value={langMode}
          onChange={(value) => onLangMode(value as LangMode)}
          options={LANGS.map((item) => ({
            value: item.value,
            label: t(item.label),
            description: t(item.hint),
          }))}
        />
      </Row>
      <Row
        title={t("输入框下的统计行")}
        hint={t("聊天输入框下面显示一行小字：输出速度、上下文长度、这条对话累计消耗、缓存命中率、当前模型来源等，显示哪几项可以自己选。用官方登录账号时还会显示该账号近 5 小时 / 近 7 天的用量。")}
      >
        <OptionSelect
          label="统计行"
          value={prefs.showStats ? "on" : "off"}
          onChange={(value) => onChange({ showStats: value === "on" })}
          options={[
            { value: "off", label: "不显示", description: "默认" },
            { value: "on", label: "显示", description: "输入框下面多一行调试信息" },
          ]}
        />
        {prefs.showStats ? (
          <div className="mt-3">
            <div className="mb-1.5 text-xs text-muted">{t("显示哪几项（点一下切换）")}</div>
            <div className="flex flex-wrap gap-1.5">
              {STATS_FIELDS.map((field) => {
                const current = prefs.statsFields ?? DEFAULT_STATS_FIELDS;
                const on = current.includes(field.id);
                return (
                  <button
                    key={field.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      onChange({
                        statsFields: on ? current.filter((item) => item !== field.id) : [...current, field.id],
                      })
                    }
                    className={`rounded-full border px-2.5 py-1 text-xs ${
                      on ? "border-accent bg-accent/10 text-ink" : "border-line text-muted hover:bg-user/60"
                    }`}
                  >
                    {t(field.label)}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </Row>

      <div className="mb-5 border-t border-line pt-5">
        <ContextSettings
          prefs={prefs}
          providers={providers}
          agents={agents}
          onChange={onChange}
        />
      </div>

      <div className="mb-5 border-t border-line pt-5">
        <Row
          title={t("操控电脑")}
          hint={
            <>
              {t("聊天输入框里那个「操控电脑」开关打开后，AI 会截屏、看图、然后操作你的鼠标键盘，发送任务后 AllAi 会暂时最小化并锁定它后面的应用窗口，一步一截图直到做完。普通点击、输入和按键会连续执行，不需要你中途切回来点确认。")}
              <strong>{t("截图会发到你为这个模型配置的接口")}</strong>
              {t(" —— 屏幕上有什么它就看到什么，密码管理器、聊天窗口、银行页面都算在内。执行期间输入框上方有一条横幅，随时可以停。")}
            </>
          }
        >
          <OptionSelect
            label="安全档位"
            value={prefs.computerSafety || "confirm-risky"}
            onChange={(value) =>
              onChange({ computerSafety: value as AppPrefs["computerSafety"] })
            }
            options={[
              { value: "confirm-all", label: "逐步审核", description: "每个动作都暂停，仅用于调试" },
              {
                value: "confirm-risky",
                label: "仅关键提交确认",
                description: "默认。明确要求的任务连续完成；仅在对象不清或动作超出要求时询问",
              },
              { value: "auto", label: "完全自动", description: "整个任务不暂停确认，适合你明确授权的操作" },
            ]}
          />
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="font-medium">{t("单次任务步数上限")}</span>
              <span className="font-mono tabular-nums text-muted">
                {t("{n} 步", { n: prefs.computerMaxSteps || 15 })}
              </span>
            </div>
            <input
              type="range"
              min={3}
              max={40}
              step={1}
              value={prefs.computerMaxSteps || 15}
              onChange={(event) => onChange({ computerMaxSteps: Number(event.target.value) })}
              className="w-full accent-[var(--accent)]"
            />
            <p className="mt-1 text-[11px] text-muted">
              {t("防止它原地打转烧 token。到上限会自动停下，你可以再发一句让它继续。")}
            </p>
          </div>
        </Row>
      </div>

      <div className="mb-5 border-t border-line pt-5">
        <Row
          title={t("联网搜索")}
          hint={
            <>
              {t("聊天和 Agent 各自一个开关，输入框里推理强度左边那个「联网」按钮改的就是这里。官方登录的三家走各自 CLI 的搜索工具；第三方接口会带上")}{" "}
              <code className="font-mono">web_search</code>
              {t(" 参数，网关不认的话会自动去掉重试，不会把聊天弄挂。创作台是生图，没有联网这回事。")}
            </>
          }
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <OptionSelect
              label="聊天"
              value={prefs.webSearchChat ? "on" : "off"}
              onChange={(value) => onChange({ webSearchChat: value === "on" })}
              options={[
                { value: "off", label: "聊天：不联网", description: "只用模型自己的知识（默认）" },
                { value: "on", label: "聊天：联网", description: "可以查最新信息" },
              ]}
            />
            <OptionSelect
              label="Agent"
              value={prefs.webSearchAgent ? "on" : "off"}
              onChange={(value) => onChange({ webSearchAgent: value === "on" })}
              options={[
                { value: "on", label: "Agent：联网", description: "查文档、找报错（默认）" },
                { value: "off", label: "Agent：不联网", description: "断网干活" },
              ]}
            />
          </div>
        </Row>
      </div>

      <div className="mb-5 border-t border-line pt-5">
        <Row
          title={t("通知")}
          hint={t("Agent 做完、官方额度到点时发 Windows 通知。窗口正开着、已经在看的时候不打扰。")}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <OptionSelect
              label="Agent 做完"
              value={prefs.notifyAgentDone === false ? "off" : "on"}
              onChange={(value) => onChange({ notifyAgentDone: value === "on" })}
              options={[
                { value: "on", label: "通知", description: "一轮结束时提醒（默认）" },
                { value: "off", label: "不通知", description: "自己回来看" },
              ]}
            />
            <OptionSelect
              label="官方额度"
              value={prefs.notifyQuota === false ? "off" : "on"}
              onChange={(value) => onChange({ notifyQuota: value === "on" })}
              options={[
                { value: "on", label: "提醒", description: "5 小时 / 7 天已用到 80%、90%（默认）" },
                { value: "off", label: "不提醒", description: "只在统计行里看" },
              ]}
            />
          </div>
        </Row>
      </div>

      <div className="border-t border-line pt-5">
        <div className="mb-1.5 text-sm font-medium">{t("模型图标")}</div>
        <BrandIconSettings
          providers={providers}
          prefs={prefs}
          onChange={onChange}
          onToast={onToast}
        />
      </div>
    </div>
  );
}
