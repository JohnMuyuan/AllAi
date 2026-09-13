import { execFile, spawn } from "child_process";
import os from "os";
import { promisify } from "util";
import type { AgentRecord } from "./db";
import { cliInvocation, resolveCommand } from "./detect";
import { childEnv, planLaunch } from "./launch";

const execFileAsync = promisify(execFile);

export type ClaudeAuthStatus = {
  installed: boolean;
  loggedIn: boolean;
  email: string;
  subscriptionType: string;
};

/** 官方登录聊天用的临时 Agent 记录：只带 kind，不带任何第三方 Key/地址。 */
export function officialChatAgent(
  kind: "claude-code" | "grok-build" | "codex" = "claude-code",
): AgentRecord {
  return {
    id: `${kind}-official-chat`,
    name: kind === "grok-build" ? "Grok" : kind === "codex" ? "ChatGPT" : "Claude",
    kind,
    command: "",
    args: [],
    cwd: "",
    authMode: "official",
    apiKey: "",
    baseUrl: "",
    model: "",
    extraEnv: {},
  };
}

function parseStatus(text: string): Omit<ClaudeAuthStatus, "installed"> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return { loggedIn: false, email: "", subscriptionType: "" };
  }
  const parsed = JSON.parse(text.slice(start, end + 1)) as {
    loggedIn?: boolean;
    email?: string;
    subscriptionType?: string;
  };
  return {
    loggedIn: Boolean(parsed.loggedIn),
    email: typeof parsed.email === "string" ? parsed.email : "",
    subscriptionType: typeof parsed.subscriptionType === "string" ? parsed.subscriptionType : "",
  };
}

export async function claudeAuthStatus(): Promise<ClaudeAuthStatus> {
  const command = await resolveCommand("claude-code", "");
  if (!command) {
    return { installed: false, loggedIn: false, email: "", subscriptionType: "" };
  }
  try {
    const inv = cliInvocation(command, ["auth", "status", "--json"]);
    const { stdout, stderr } = await execFileAsync(inv.file, inv.args, {
      timeout: 15000,
      windowsHide: true,
      windowsVerbatimArguments: inv.verbatim,
    });
    return { installed: true, ...parseStatus(`${stdout}\n${stderr}`) };
  } catch (error) {
    const extra = error as { stdout?: string; stderr?: string };
    try {
      return { installed: true, ...parseStatus(`${extra.stdout || ""}\n${extra.stderr || ""}`) };
    } catch {
      return { installed: true, loggedIn: false, email: "", subscriptionType: "" };
    }
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function claudeAuthLogin(): Promise<{ ok: true } | { ok: false; error: string }> {
  const before = await claudeAuthStatus();
  if (!before.installed) {
    return { ok: false, error: "没有找到 Claude Code。请先安装 claude 命令行。" };
  }
  if (before.loggedIn) return { ok: true };

  const command = await resolveCommand("claude-code", "");
  if (!command) {
    return { ok: false, error: "没有找到 Claude Code。请先安装 claude 命令行。" };
  }
  const plan = planLaunch(officialChatAgent("claude-code"), "login", command);
  const proc = spawn(plan.file, plan.args, {
    cwd: os.homedir(),
    env: childEnv(plan.env),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    windowsVerbatimArguments: plan.verbatim,
  });

  let closed: number | null | undefined;
  proc.on("close", (code) => {
    closed = code;
  });
  proc.on("error", () => {
    closed = -1;
  });

  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const status = await claudeAuthStatus();
    if (status.loggedIn) {
      try {
        proc.kill();
      } catch {
        // ignore
      }
      return { ok: true };
    }
    if (closed !== undefined) {
      for (let i = 0; i < 6; i++) {
        await sleep(500);
        const again = await claudeAuthStatus();
        if (again.loggedIn) return { ok: true };
      }
      return { ok: false, error: "没有检测到登录成功，请再点一次登录" };
    }
    await sleep(1200);
  }
  try {
    proc.kill();
  } catch {
    // ignore
  }
  const last = await claudeAuthStatus();
  if (last.loggedIn) return { ok: true };
  return { ok: false, error: "登录等待超时，请再试一次" };
}

export async function claudeAuthLogout(): Promise<{ ok: true } | { ok: false; error: string }> {
  const command = await resolveCommand("claude-code", "");
  if (!command) {
    return { ok: false, error: "没有找到 Claude Code。" };
  }
  try {
    const inv = cliInvocation(command, ["auth", "logout"]);
    await execFileAsync(inv.file, inv.args, {
      timeout: 20000,
      windowsHide: true,
      windowsVerbatimArguments: inv.verbatim,
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "退出登录失败" };
  }
}
