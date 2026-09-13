import fs from "fs";
import os from "os";
import path from "path";
import * as pty from "node-pty";
import { adminLinkStatus, ensureAdminLink, stopAdminLink } from "./admin-client";
import { runChatTurn, runLogin } from "./chat-run";
import {
  cliAuthLogin,
  cliAuthLogout,
  cliAuthStatus,
  cliListModels,
  isCliAuthKind,
  type CliAuthKind,
} from "./cli-auth";
import { officialChatAgent } from "./claude-cli";
import { deleteWork, type AgentWork as DeletableWork } from "./history";
import { unwatchMessages, watchMessages } from "./watch";
import { readAgent } from "./db";
import { resolveCommand } from "./detect";
import { apiEnv, childEnv, planLaunch } from "./launch";

type DesktopSession = {
  id: string;
  agentId: string;
  agentName: string;
  cwd: string;
  action: "run" | "login";
  status: "running" | "exited";
  exitCode: number | null;
};

type LiveSession = DesktopSession & {
  pty: pty.IPty;
  buffer: string;
};

type ChatOpts = {
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
};

type OfficialChatKind = "claude" | "grok" | "chatgpt";

type OfficialChatOpts = {
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
};

type Incoming =
  | { id: string; type: "start"; opts: StartOpts }
  | { id: string; type: "write"; sessionId: string; data: string }
  | { id: string; type: "resize"; sessionId: string; cols: number; rows: number }
  | { id: string; type: "kill"; sessionId: string }
  | { id: string; type: "attach"; sessionId: string }
  | { id: string; type: "list" }
  | { id: string; type: "chat"; opts: ChatOpts }
  | { id: string; type: "login"; agentId: string }
  | { id: string; type: "cli-auth-status"; kind: CliAuthKind; command?: string }
  | { id: string; type: "cli-auth-login"; kind: CliAuthKind; command?: string }
  | { id: string; type: "cli-auth-logout"; kind: CliAuthKind; command?: string }
  | { id: string; type: "cli-models"; kind: CliAuthKind; command?: string }
  | { id: string; type: "official-chat"; opts: OfficialChatOpts }
  | { id: string; type: "delete-work"; work: DeletableWork }
  | { id: string; type: "watch-work"; work: DeletableWork }
  | { id: string; type: "unwatch-work" }
  | { id: string; type: "admin-ensure" }
  | { id: string; type: "admin-status" };

const chats = new Map<string, { kill: () => void }>();

type StartOpts = {
  sessionId: string;
  agentId: string;
  action: "run" | "login";
  cwd: string;
  cols: number;
  rows: number;
};

const sessions = new Map<string, LiveSession>();
const BUFFER_LIMIT = 180_000;

function send(message: unknown) {
  process.send?.(message);
}

function toPublic(live: LiveSession): DesktopSession {
  return {
    id: live.id,
    agentId: live.agentId,
    agentName: live.agentName,
    cwd: live.cwd,
    action: live.action,
    status: live.status,
    exitCode: live.exitCode,
  };
}

async function start(opts: StartOpts): Promise<{ ok: true } | { ok: false; error: string }> {
  const agent = readAgent(opts.agentId);
  if (!agent) return { ok: false, error: "找不到这个 Agent 配置" };

  const command = await resolveCommand(agent.kind, agent.command);
  if (!command) {
    return {
      ok: false,
      error: `没有找到 ${agent.name} 的可执行文件。请先安装，或在设置里填写命令路径。`,
    };
  }

  const cwd = (opts.cwd || agent.cwd || os.homedir()).trim();
  const plan = planLaunch(agent, opts.action, command);

  try {
    const proc = pty.spawn(plan.file, plan.args, {
      name: "xterm-256color",
      cols: Math.max(2, opts.cols),
      rows: Math.max(2, opts.rows),
      cwd,
      env: childEnv(plan.env),
      useConpty: true,
    });

    const live: LiveSession = {
      id: opts.sessionId,
      agentId: agent.id,
      agentName: agent.name,
      cwd,
      action: opts.action,
      status: "running",
      exitCode: null,
      pty: proc,
      buffer: "",
    };
    sessions.set(opts.sessionId, live);
    send({ type: "sessions", sessions: [...sessions.values()].map(toPublic) });

    proc.onData((data) => {
      live.buffer += data;
      if (live.buffer.length > BUFFER_LIMIT) {
        live.buffer = live.buffer.slice(live.buffer.length - BUFFER_LIMIT);
      }
      send({ type: "data", sessionId: opts.sessionId, data });
    });

    proc.onExit(({ exitCode }) => {
      live.status = "exited";
      live.exitCode = exitCode;
      send({ type: "sessions", sessions: [...sessions.values()].map(toPublic) });
      send({ type: "exit", sessionId: opts.sessionId, exitCode });
    });

    if (plan.stdin) {
      setTimeout(() => {
        try {
          proc.write(plan.stdin ?? "");
        } catch {
          // ignore
        }
      }, 400);
    }

    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法启动进程";
    return { ok: false, error: message };
  }
}

process.on("message", async (message: Incoming) => {
  try {
    if (message.type === "start") {
      send({ id: message.id, type: "result", result: await start(message.opts) });
      return;
    }
    if (message.type === "write") {
      sessions.get(message.sessionId)?.pty.write(message.data);
      send({ id: message.id, type: "result", result: true });
      return;
    }
    if (message.type === "resize") {
      const current = sessions.get(message.sessionId);
      if (current?.status === "running") {
        current.pty.resize(Math.max(2, message.cols), Math.max(2, message.rows));
      }
      send({ id: message.id, type: "result", result: true });
      return;
    }
    if (message.type === "kill") {
      try {
        sessions.get(message.sessionId)?.pty.kill();
      } catch {
        // already gone
      }
      chats.get(message.sessionId)?.kill();
      chats.delete(message.sessionId);
      send({ id: message.id, type: "result", result: true });
      return;
    }
    if (message.type === "admin-ensure") {
      send({ id: message.id, type: "result", result: await ensureAdminLink() });
      return;
    }
    if (message.type === "admin-status") {
      send({ id: message.id, type: "result", result: adminLinkStatus() });
      return;
    }
    if (message.type === "chat") {
      const agent = readAgent(message.opts.agentId, message.opts.endpointId);
      if (!agent) {
        send({ id: message.id, type: "result", result: { ok: false, error: "找不到这个 Agent 配置" } });
        return;
      }
      const command = await resolveCommand(agent.kind, agent.command);
      if (!command) {
        send({
          id: message.id,
          type: "result",
          result: { ok: false, error: `没有找到 ${agent.name}` },
        });
        return;
      }
      // 要以管理员身份跑，先把管理员宿主连上（必要时弹一次 UAC），连不上就别往下走。
      if (message.opts.elevated) {
        const admin = await ensureAdminLink();
        if (!admin.ok) {
          send({ id: message.id, type: "result", result: admin });
          return;
        }
      }
      chats.get(message.opts.sessionId)?.kill();
      const handle = runChatTurn(
        {
          sessionId: message.opts.sessionId,
          agent,
          command,
          prompt: message.opts.prompt,
          cwd: message.opts.cwd || os.homedir(),
          resumeId: message.opts.resumeId,
          newSessionId: message.opts.newSessionId,
          model: message.opts.model,
          effort: message.opts.effort,
          images: message.opts.images,
          webSearch: message.opts.webSearch,
          permissionMode: message.opts.permissionMode,
          history: message.opts.history,
          elevated: message.opts.elevated,
        },
        (event) => {
          send({ type: "chat-event", sessionId: message.opts.sessionId, event });
          // 一轮跑完就把句柄撤掉。chats 以前只增不删，每一轮都留一份
          // （子进程引用 + 输出缓冲 + StringDecoder）常驻宿主进程 ——
          // 用一天下来是几百份。done 说明进程已经 close，之后再收到 kill
          // 就是 no-op，不会有别的影响。
          if (event.type === "done") chats.delete(message.opts.sessionId);
        },
      );
      chats.set(message.opts.sessionId, handle);
      send({ id: message.id, type: "result", result: { ok: true } });
      return;
    }
    if (message.type === "cli-auth-status") {
      send({
        id: message.id,
        type: "result",
        result: isCliAuthKind(message.kind)
          ? await cliAuthStatus(message.kind, message.command || "")
          : { kind: message.kind, installed: false, loggedIn: false, email: "", account: "" },
      });
      return;
    }
    if (message.type === "cli-auth-login") {
      send({
        id: message.id,
        type: "result",
        result: isCliAuthKind(message.kind)
          ? await cliAuthLogin(message.kind, message.command || "")
          : { ok: false, error: "这个 Agent 没有官方登录" },
      });
      return;
    }
    if (message.type === "cli-auth-logout") {
      send({
        id: message.id,
        type: "result",
        result: isCliAuthKind(message.kind)
          ? await cliAuthLogout(message.kind, message.command || "")
          : { ok: false, error: "这个 Agent 没有官方登录" },
      });
      return;
    }
    if (message.type === "cli-models") {
      send({
        id: message.id,
        type: "result",
        result: isCliAuthKind(message.kind)
          ? await cliListModels(message.kind, message.command || "")
          : { ok: false, error: "这个 Agent 没有官方模型列表" },
      });
      return;
    }
    if (message.type === "official-chat") {
      const kind: OfficialChatKind =
        message.opts.kind === "grok" || message.opts.kind === "chatgpt"
          ? message.opts.kind
          : "claude";
      const cliKind =
        kind === "grok" ? "grok-build" : kind === "chatgpt" ? "codex" : "claude-code";
      const cliName =
        kind === "grok" ? "Grok" : kind === "chatgpt" ? "Codex CLI" : "Claude Code";
      const command = await resolveCommand(cliKind, "");
      if (!command) {
        send({
          id: message.id,
          type: "result",
          result: { ok: false, error: `没有找到 ${cliName}。请先安装对应的命令行。` },
        });
        return;
      }
      // 聊天跑在自己的空目录里，免得 Agent 的工作目录被当成上下文。
      const cwd = path.join(os.homedir(), ".allai", `${kind}-chat`);
      fs.mkdirSync(cwd, { recursive: true });
      // 要以管理员身份跑，先把管理员宿主连上（必要时弹一次 UAC），连不上就别往下走。
      if (message.opts.elevated) {
        const admin = await ensureAdminLink();
        if (!admin.ok) {
          send({ id: message.id, type: "result", result: admin });
          return;
        }
      }
      chats.get(message.opts.sessionId)?.kill();
      const handle = runChatTurn(
        {
          sessionId: message.opts.sessionId,
          agent: officialChatAgent(cliKind),
          command,
          prompt: message.opts.prompt,
          cwd,
          resumeId: message.opts.resumeId,
          newSessionId: message.opts.newSessionId,
          model: message.opts.model,
          mode: "chat",
          effort: message.opts.effort,
          webSearch: message.opts.webSearch,
          history: message.opts.history,
          elevated: message.opts.elevated,
        },
        (event) => {
          send({ type: "chat-event", sessionId: message.opts.sessionId, event });
          if (event.type === "done") chats.delete(message.opts.sessionId);
        },
      );
      chats.set(message.opts.sessionId, handle);
      send({ id: message.id, type: "result", result: { ok: true } });
      return;
    }
    if (message.type === "watch-work") {
      const result = watchMessages(message.work, (payload) =>
        send({ type: "work-messages", ...payload }),
      );
      send({ id: message.id, type: "result", result });
      return;
    }
    if (message.type === "unwatch-work") {
      unwatchMessages();
      send({ id: message.id, type: "result", result: { ok: true } });
      return;
    }
    if (message.type === "delete-work") {
      send({ id: message.id, type: "result", result: await deleteWork(message.work) });
      return;
    }
    if (message.type === "login") {
      const agent = readAgent(message.agentId);
      if (!agent) {
        send({ id: message.id, type: "result", result: { ok: false, error: "找不到这个 Agent 配置" } });
        return;
      }
      if (isCliAuthKind(agent.kind) && agent.authMode !== "api") {
        send({
          id: message.id,
          type: "result",
          result: await cliAuthLogin(agent.kind, agent.command),
        });
        return;
      }
      const command = await resolveCommand(agent.kind, agent.command);
      if (!command) {
        send({
          id: message.id,
          type: "result",
          result: { ok: false, error: `没有找到 ${agent.name}` },
        });
        return;
      }
      const plan = planLaunch(agent, "login", command);
      const result = await runLogin(
        plan.file,
        plan.args,
        apiEnv(agent),
        plan.stdin,
        plan.verbatim,
      );
      send({ id: message.id, type: "result", result });
      return;
    }
    if (message.type === "attach") {
      const current = sessions.get(message.sessionId);
      send({
        id: message.id,
        type: "result",
        result: current
          ? { history: current.buffer, session: toPublic(current) }
          : { history: "", session: null },
      });
      return;
    }
    if (message.type === "list") {
      send({ id: message.id, type: "result", result: [...sessions.values()].map(toPublic) });
      return;
    }
    // 认不出来的消息也要回一句，否则主进程那边的 Promise 永远挂着。
    const unknown = message as { id?: string; type?: string };
    send({
      id: unknown.id,
      type: "result",
      result: { ok: false, error: `终端宿主不认识这个请求：${unknown.type}` },
    });
  } catch (error) {
    send({
      id: message.id,
      type: "result",
      result: { ok: false, error: error instanceof Error ? error.message : "终端宿主出错" },
    });
  }
});

process.on("disconnect", () => {
  for (const live of sessions.values()) {
    try {
      live.pty.kill();
    } catch {
      // ignore
    }
  }
  for (const chat of chats.values()) chat.kill();
  // 管理员宿主跟着链路走：链路一断它自己就退，这里只是把链路关干净。
  stopAdminLink();
  process.exit(0);
});
