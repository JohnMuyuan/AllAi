import { ChildProcess, spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { StringDecoder } from "string_decoder";
import { processIsElevated, spawnViaAdminHost } from "./admin-client";
import { eventsFromJson, type ChatEvent } from "./chat-parse";
import type { AgentRecord } from "./db";
import { cliInvocation } from "./detect";
import { apiEnv, childEnv, isClaudeAuthNoise } from "./launch";

export type ChatTurnOpts = {
  sessionId: string;
  agent: AgentRecord;
  command: string;
  prompt: string;
  cwd: string;
  resumeId?: string;
  newSessionId?: string;
  model?: string;
  mode?: "agent" | "chat";
  effort?: string;
  /** 用户发的图片（已经复制进工作目录）。Codex 有原生 -i，其它家走提示词里的路径。 */
  images?: string[];
  /** 允许联网搜索。聊天模式默认不开，Agent 默认开。 */
  webSearch?: boolean;
  /** Agent 权限模式。聊天模式忽略。 */
  permissionMode?: string;
  /**
   * 换模型时补给新模型的上下文，只在开新会话（没有 resumeId）时有值。
   * Claude 用 stdin 的多轮 stream-json 喂；Grok / Codex 没有多轮输入，
   * 由调用方把它拼进 prompt。
   */
  history?: { role: "user" | "assistant"; content: string }[];
  /** 经提权宿主启动 CLI。AllAi 本身已是管理员时仍走普通 spawn。 */
  elevated?: boolean;
};

const CHAT_SYSTEM =
  "You are a helpful chat assistant. Reply in the user's language. This is a conversation, not a coding session.";

const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max", "ultra"]);

/**
 * Grok / Codex 没有多轮输入，换模型时只能把历史写进提示词。
 * 措辞要说死「这是历史、不是此刻的问题」，否则模型会去重新回答旧问题。
 */
function withHistoryPrompt(
  history: { role: "user" | "assistant"; content: string }[] | undefined,
  prompt: string,
) {
  // 斜杠指令必须原样交给 CLI，拼上历史它就不认了。
  if (/^\s*\//.test(prompt)) return prompt;
  if (!history?.length) return prompt;
  const sep = `\n\n`;
  const transcript = history
    .map((item) => `${item.role === "assistant" ? "助手" : "用户"}：${item.content}`)
    .join(sep);
  return [
    "【以下是你和用户此前的对话，供你了解来龙去脉。这不是用户此刻的提问，不要复述、不要重新回答它们。】",
    transcript,
    "【以上是历史。用户此刻的问题】",
    prompt,
  ].join(sep);
}

const CLAUDE_PERMISSIONS = new Set(["auto", "acceptEdits", "bypassPermissions", "dontAsk", "plan"]);
const GROK_PERMISSIONS = new Set(["auto", "acceptEdits", "bypassPermissions", "dontAsk", "plan"]);

function grokPermissionArgs(mode?: string) {
  const value = mode && GROK_PERMISSIONS.has(mode) ? mode : "bypassPermissions";
  if (value === "bypassPermissions") return ["--always-approve"];
  return ["--permission-mode", value];
}

function claudePermissionArgs(mode?: string) {
  const value = mode && CLAUDE_PERMISSIONS.has(mode) ? mode : "bypassPermissions";
  return ["--permission-mode", value];
}

function codexPermissionArgs(mode?: string) {
  if (mode === "read-only") return ["--sandbox", "read-only"];
  if (mode === "full") return ["--dangerously-bypass-approvals-and-sandbox"];
  // `--approve-for-me` 已经按 workspace-write 沙箱自动批；再传 `--sandbox`
  // 会被 clap 拒掉（codex 0.153+：cannot be used with '--approve-for-me'）。
  return ["--approve-for-me"];
}

function spawnCli(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
  oauthOnly?: boolean,
  /** 要往 stdin 写东西（Claude 的多轮 stream-json 输入）就得开着它。 */
  wantsStdin?: boolean,
  elevated?: boolean,
): ChildProcess {
  const merged = childEnv(env, oauthOnly);
  const inv = cliInvocation(command, args);
  if (elevated && !processIsElevated()) {
    return spawnViaAdminHost(inv.file, inv.args, cwd, merged, Boolean(wantsStdin), inv.verbatim);
  }
  return spawn(inv.file, inv.args, {
    cwd,
    env: merged,
    windowsHide: true,
    stdio: [wantsStdin ? "pipe" : "ignore", "pipe", "pipe"],
    windowsVerbatimArguments: inv.verbatim,
  });
}

/** Claude 的 stream-json 输入：一行一条消息，最后带上这轮的提问。 */
function claudeStdinLines(
  history: { role: "user" | "assistant"; content: string }[],
  prompt: string,
) {
  const rows = [...history, { role: "user" as const, content: prompt }];
  return rows
    .map((item) =>
      JSON.stringify({
        type: item.role,
        message: { role: item.role, content: [{ type: "text", text: item.content }] },
      }),
    )
    .map((line) => `${line}\n`)
    .join("");
}

function writePromptFile(sessionId: string, prompt: string) {
  const file = path.join(os.tmpdir(), `allai-${sessionId}.txt`);
  fs.writeFileSync(file, prompt, "utf8");
  return file;
}

/**
 * 拼出这一轮的命令行 —— 以及**怎么把 prompt 交给 CLI**。
 *
 * prompt 绝不能无脑当命令行参数：Windows 整条命令行上限 32767 个字符，
 * 而 Agent 换会话时要把整段历史重放过去，几百 KB 很正常 —— 直接 `spawn ENAMETOOLONG`
 * （0.16.20 之前就是这样：`long` 判断和 writePromptFile 都写了，
 *  可 claude 那一支又把文件读回来塞进 argv，等于白写；codex 压根没管）。
 *
 * 三家各有各的入口，都是对着本机 CLI 的 --help 核过的：
 * - grok：`--prompt-file <文件>`
 * - claude：`-p` 不带参数时从 stdin 读（`--input-format text` 是默认值）
 * - codex：`codex exec` 的 PROMPT 省略（或给 `-`）时从 stdin 读。
 *   **别又给参数又给 stdin** —— 那样 stdin 会被当成额外的 `<stdin>` 块追加上去。
 *
 * 单独导出是为了能测：`scripts/test-cli-args.cjs` 直接断言长 prompt 不会出现在 argv 里。
 */
export function buildArgs(opts: ChatTurnOpts): { args: string[]; cleanup?: string; stdin?: string } {
  const extra = [...(opts.agent.args ?? [])];
  const model = (opts.model || opts.agent.model).trim();
  // Claude 聊天走 stdin 的多轮输入，历史不进 prompt；其余情况（包括 Agent）
  // 带历史的那一版才是真正发出去的内容，长度判断也要按它来。
  const claudeStdin =
    opts.mode === "chat" && opts.agent.kind === "claude-code" && Boolean(opts.history?.length);
  const outgoing = claudeStdin ? opts.prompt : withHistoryPrompt(opts.history, opts.prompt);
  const long = outgoing.length > 3500;

  if (opts.agent.kind === "grok-build") {
    const args = [
      "--output-format",
      "streaming-messages-json",
      "--include-partial-messages",
    ];
    if (opts.mode === "chat") {
      // 聊天不是编程会话：不给文件/命令工具，只在用户开了联网时放行搜索。
      args.push("--tools", opts.webSearch ? "web_search,web_fetch" : "");
      if (!opts.webSearch) args.push("--disable-web-search");
      args.push("--no-subagents", "--no-plan", "--system-prompt-override", CHAT_SYSTEM);
    } else {
      if (!opts.webSearch) args.push("--disable-web-search");
      args.push(...grokPermissionArgs(opts.permissionMode));
    }
    const promptFile = long ? writePromptFile(opts.sessionId, outgoing) : "";
    if (promptFile) args.push("--prompt-file", promptFile);
    else args.push("-p", outgoing);
    if (opts.resumeId) args.push("--resume", opts.resumeId);
    else if (opts.newSessionId) args.push("--session-id", opts.newSessionId);
    if (model) args.push("-m", model);
    if (opts.effort && EFFORTS.has(opts.effort)) args.push("--reasoning-effort", opts.effort);
    if (opts.mode === "chat") return { args, cleanup: promptFile || undefined };
    return { args: [...args, ...extra], cleanup: promptFile || undefined };
  }

  if (opts.agent.kind === "claude-code") {
    // 太长就不放 argv，交给 stdin（`-p` 不带参数时它就从 stdin 读）。
    const viaStdin = long ? outgoing : "";
    if (opts.mode === "chat") {
      // 有历史就走 stream-json 输入：角色是原生的，不用把历史伪装成用户的话。
      const args = opts.history?.length
        ? ["-p", "--input-format", "stream-json"]
        : viaStdin
          ? ["-p"]
          : ["-p", outgoing];
      args.push(
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--tools",
        opts.webSearch ? "WebSearch,WebFetch" : "",
        "--disable-slash-commands",
        "--safe-mode",
        "--system-prompt",
        CHAT_SYSTEM,
      );
      if (opts.resumeId) args.push("--resume", opts.resumeId);
      else if (opts.newSessionId) args.push("--session-id", opts.newSessionId);
      if (model) args.push("--model", model);
      if (opts.effort && EFFORTS.has(opts.effort)) args.push("--effort", opts.effort);
      return { args, stdin: viaStdin || undefined };
    }
    const args = [
      "-p",
      ...(viaStdin ? [] : [outgoing]),
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      ...claudePermissionArgs(opts.permissionMode),
    ];
    if (opts.agent.authMode === "api") {
      args.push("--settings", '{"disableClaudeAiConnectors":true}');
    }
    if (opts.resumeId) args.push("--resume", opts.resumeId);
    else if (opts.newSessionId) args.push("--session-id", opts.newSessionId);
    if (model) args.push("--model", model);
    if (opts.effort && EFFORTS.has(opts.effort)) args.push("--effort", opts.effort);
    return { args: [...args, ...extra], stdin: viaStdin || undefined };
  }

  if (opts.agent.kind === "codex") {
    if (opts.mode === "chat") {
      // 聊天：只读沙箱 + 空目录，别让它去动用户的文件。
      const args = [
        "exec",
        "--json",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "-C",
        opts.cwd,
      ];
      if (opts.resumeId) args.splice(1, 0, "resume", opts.resumeId);
      if (model) args.push("-m", model);
      if (opts.effort && EFFORTS.has(opts.effort)) {
        args.push("-c", `model_reasoning_effort="${opts.effort}"`);
      }
      args.push("-c", `tools.web_search=${opts.webSearch ? "true" : "false"}`);
      // codex 没有 --system-prompt，也没有多轮输入：系统提示和历史都拼进 prompt。
      const full = `${CHAT_SYSTEM}

${outgoing}`;
      if (full.length > 3500) return { args, stdin: full };
      args.push(full);
      return { args };
    }
    const args = [
      "exec",
      "--json",
      "--skip-git-repo-check",
      ...codexPermissionArgs(opts.permissionMode),
    ];
    args.push("-c", `tools.web_search=${opts.webSearch === false ? "false" : "true"}`);
    for (const image of opts.images ?? []) args.push("-i", image);
    if (opts.resumeId) args.splice(1, 0, "resume", opts.resumeId);
    if (model) args.push("-m", model);
    if (opts.effort && EFFORTS.has(opts.effort)) {
      args.push("-c", `model_reasoning_effort="${opts.effort}"`);
    }
    if (long) return { args: [...args, ...extra], stdin: outgoing };
    args.push(outgoing);
    return { args: [...args, ...extra] };
  }

  // 自定义命令：参数怎么接是用户自己定的，我们不知道它有没有 stdin 入口，只能原样传。
  return { args: extra.length ? [...extra, opts.prompt] : [opts.prompt] };
}

function missingSession(text: string) {
  return /no conversation found with session id/i.test(text);
}

export function runChatTurn(
  opts: ChatTurnOpts,
  emit: (event: ChatEvent) => void,
): { kill: () => void } {
  let child: ChildProcess | null = null;
  let stopped = false;

  const start = (current: ChatTurnOpts, allowRetry: boolean) => {
    const { args, cleanup, stdin } = buildArgs(current);
    // 怎么把 prompt 交给 CLI 全在 buildArgs 里决定（argv / stdin / --prompt-file）。
    // Claude 聊天带历史时是原生多轮输入，那一份在这里现拼。
    const stdinPayload =
      current.mode === "chat" && current.agent.kind === "claude-code" && current.history?.length
        ? claudeStdinLines(current.history, current.prompt)
        : stdin || "";
    const proc = spawnCli(
      current.command,
      args,
      current.cwd,
      apiEnv(current.agent, current.model),
      current.mode === "chat",
      Boolean(stdinPayload),
      current.elevated,
    );
    child = proc;
    if (stdinPayload) {
      try {
        proc.stdin?.write(stdinPayload);
        proc.stdin?.end();
      } catch {
        // 写不进去就让它按空输入跑，下面会收到 CLI 自己的报错
      }
    }
    let buffer = "";
    const stdoutDecoder = new StringDecoder("utf8");
    let sawJson = false;
    let resumeMissing = false;

    const consumeText = (text: string) => {
      buffer += text;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (missingSession(trimmed) && current.resumeId && allowRetry) {
          resumeMissing = true;
          continue;
        }
        if (trimmed.startsWith("{")) {
          try {
            const events = eventsFromJson(JSON.parse(trimmed) as Record<string, unknown>);
            sawJson = true;
            for (const event of events) {
              if (event.type === "error" && missingSession(event.message) && current.resumeId && allowRetry) {
                resumeMissing = true;
                continue;
              }
              emit(event);
            }
            continue;
          } catch {
            // fall through
          }
        }
        if (isClaudeAuthNoise(trimmed)) continue;
        if (!sawJson) emit({ type: "delta", text: trimmed + "\n" });
      }
    };

    const consume = (chunk: Buffer) => consumeText(stdoutDecoder.write(chunk));

    proc.stdout?.on("data", consume);
    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (missingSession(text) && current.resumeId && allowRetry) {
        resumeMissing = true;
        return;
      }
      const trimmed = text.trim();
      if (isClaudeAuthNoise(trimmed)) return;
      if (trimmed && !sawJson) emit({ type: "delta", text: trimmed + "\n" });
    });
    proc.on("error", (error) => emit({ type: "error", message: error.message }));
    proc.on("close", (code) => {
      // CLI 关闭前不一定补换行；同时用 StringDecoder 收尾，避免中文刚好被 chunk
      // 切在 UTF-8 多字节中间时变成乱码。
      const tail = stdoutDecoder.end();
      if (tail || buffer.trim()) consumeText(`${tail}\n`);
      if (cleanup) fs.unlink(cleanup, () => undefined);
      if (stopped) return;
      if (resumeMissing && current.resumeId && allowRetry) {
        // 会话在 CLI 那边没了，只能开新的。必须告诉界面 —— 这一轮没有上下文。
        emit({ type: "reset", reason: "上一轮的会话在命令行那边已经不存在" });
        start({ ...current, resumeId: undefined, newSessionId: undefined }, false);
        return;
      }
      if (code && code !== 0 && !sawJson) {
        emit({ type: "error", message: `进程退出 ${code}` });
      }
      emit({ type: "done" });
    });
  };

  start(opts, true);
  return {
    kill: () => {
      stopped = true;
      try {
        child?.kill();
      } catch {
        // ignore
      }
    },
  };
}

export function runLogin(
  command: string,
  args: string[],
  env: Record<string, string>,
  stdin?: string,
  verbatim?: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd: os.homedir(),
      env: childEnv(env),
      windowsHide: true,
      stdio: ["pipe", "ignore", "ignore"],
      // 调用方传进来的已经是 cliInvocation 的结果；.cmd shim 会被包成
      // cmd /d /s /c "…"，少了这个 Node 会再加一层引号（0.4.13 那个坑）。
      windowsVerbatimArguments: verbatim,
    });
    if (stdin) {
      setTimeout(() => {
        try {
          proc.stdin?.write(stdin);
        } catch {
          // ignore
        }
      }, 400);
    }
    proc.on("error", (error) => resolve({ ok: false, error: error.message }));
    proc.on("close", (code) => {
      if (code && code !== 0) resolve({ ok: false, error: `登录进程退出 ${code}` });
      else resolve({ ok: true });
    });
  });
}
