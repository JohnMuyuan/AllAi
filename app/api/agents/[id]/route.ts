import { NextResponse } from "next/server";
import { withGlobalEndpoints } from "@/lib/agent-endpoints";
import { toPublicAgent } from "@/lib/public";
import { readDb, updateDb } from "@/lib/store";
import type { AgentAuthMode, AgentKind, AgentProfile } from "@/lib/types";

export const dynamic = "force-dynamic";

const KINDS: AgentKind[] = ["grok-build", "claude-code", "codex", "custom"];

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const body = (await request.json()) as Partial<AgentProfile>;
  const agent = await updateDb((db) => {
    const current = db.agents.find((item) => item.id === id);
    if (!current) return null;
    if (typeof body.name === "string" && body.name.trim()) current.name = body.name.trim();
    if (typeof body.kind === "string" && KINDS.includes(body.kind as AgentKind)) {
      current.kind = body.kind as AgentKind;
    }
    if (typeof body.command === "string") current.command = body.command.trim();
    if (Array.isArray(body.args)) current.args = body.args.map(String);
    if (typeof body.cwd === "string") current.cwd = body.cwd.trim();
    if (body.authMode === "api" || body.authMode === "official") {
      current.authMode = body.authMode as AgentAuthMode;
    }
    if (typeof body.apiKey === "string" && body.apiKey.trim() && !body.apiKey.includes("•")) {
      current.apiKey = body.apiKey.trim();
    }
    if (typeof body.baseUrl === "string") current.baseUrl = body.baseUrl.trim();
    if (typeof body.model === "string") current.model = body.model.trim();
    if (typeof body.activeEndpointId === "string") current.activeEndpointId = body.activeEndpointId;
    if (typeof body.model === "string") {
      // 选中的是全局接口时，模型只记在这个 Agent 上（各 Agent 可以用不同模型），
      // 别写进全局池，也别误写到本地的第一个接口上。
      const sharedIds = new Set((db.agentEndpoints ?? []).map((item) => item.id));
      if (!sharedIds.has(current.activeEndpointId)) {
        const selected =
          current.endpoints.find((item) => item.id === current.activeEndpointId) ??
          current.endpoints[0];
        if (selected) selected.model = current.model;
      }
    }
    if (Array.isArray(body.endpoints)) {
      // 全局池里的接口是合并进来给界面看的，别在这儿存成这个 Agent 自己的副本，
      // 否则就回到「每个 Agent 一份、改一处不同步」的老样子了。
      const incoming = body.endpoints.filter((item) => !item.global);
      // 全剩下空的话（界面只发了全局接口过来）就别动本地那几个，
      // 否则官方登录那条会被抹掉。
      if (incoming.length) current.endpoints = incoming.map((item) => {
        const prev = current.endpoints?.find((entry) => entry.id === item.id);
        const incomingKey = typeof item.apiKey === "string" ? item.apiKey.trim() : "";
        const official = item.mode !== "api";
        return {
          id: item.id || crypto.randomUUID(),
          label: (item.label || "接口").trim(),
          mode: official ? "official" : "api",
          apiKey: official
            ? ""
            : incomingKey && !incomingKey.includes("•")
              ? incomingKey
              : prev?.apiKey || "",
          baseUrl: official ? "" : (item.baseUrl || "").trim(),
          model: (item.model || "").trim(),
          models: Array.isArray(item.models) ? item.models : prev?.models || [],
        };
      });
      // 选中的可能是全局池里的，那就别把它改回本地的第一个。
      const globalIds = new Set((db.agentEndpoints ?? []).map((item) => item.id));
      const active = globalIds.has(current.activeEndpointId)
        ? null
        : (current.endpoints.find((item) => item.id === current.activeEndpointId) ??
          current.endpoints[0]);
      if (active) {
        current.activeEndpointId = active.id;
        current.authMode = active.mode;
        current.apiKey = active.apiKey;
        current.baseUrl = active.baseUrl;
        current.model = active.model || current.model;
      }
    }
    if (body.extraEnv && typeof body.extraEnv === "object") {
      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries(body.extraEnv)) {
        if (typeof value === "string" && key.trim()) env[key.trim()] = value;
      }
      current.extraEnv = env;
    }
    return current;
  });
  if (!agent) return NextResponse.json({ error: "Agent 不存在" }, { status: 404 });
  const db = await readDb();
  return NextResponse.json({
    agent: toPublicAgent(withGlobalEndpoints(agent, db.agentEndpoints)),
  });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const removed = await updateDb((db) => {
    const index = db.agents.findIndex((item) => item.id === id);
    if (index === -1) return false;
    db.agents.splice(index, 1);
    return true;
  });
  if (!removed) return NextResponse.json({ error: "Agent 不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
