import { NextResponse } from "next/server";
import { ensureEndpoints, withGlobalEndpoints } from "@/lib/agent-endpoints";
import { publicEndpoint, toPublicAgent } from "@/lib/public";
import { readDb, updateDb } from "@/lib/store";
import type { AgentAuthMode, AgentKind, AgentProfile } from "@/lib/types";

export const dynamic = "force-dynamic";

const KINDS: AgentKind[] = ["grok-build", "claude-code", "codex", "custom"];

function asKind(value: unknown): AgentKind {
  return KINDS.includes(value as AgentKind) ? (value as AgentKind) : "custom";
}

function asAuth(value: unknown): AgentAuthMode {
  return value === "api" ? "api" : "official";
}

function extraEnv(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === "string" && key.trim()) out[key.trim()] = item;
  }
  return out;
}

export async function GET() {
  const db = await readDb();
  return NextResponse.json({
    agents: db.agents.map((item) =>
      toPublicAgent(withGlobalEndpoints(item, db.agentEndpoints)),
    ),
    agentEndpoints: (db.agentEndpoints ?? []).map(publicEndpoint),
  });
}

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<AgentProfile>;
  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "请填写名称" }, { status: 400 });
  }
  const agent = await updateDb((db) => {
    const created = ensureEndpoints({
      id: crypto.randomUUID(),
      name,
      kind: asKind(body.kind),
      command: body.command?.trim() ?? "",
      args: Array.isArray(body.args) ? body.args.map(String) : [],
      cwd: body.cwd?.trim() ?? "",
      authMode: asAuth(body.authMode),
      apiKey: body.apiKey?.trim() ?? "",
      baseUrl: body.baseUrl?.trim() ?? "",
      model: body.model?.trim() ?? "",
      extraEnv: extraEnv(body.extraEnv),
      endpoints: [],
      activeEndpointId: "",
      createdAt: Date.now(),
    });
    db.agents.push(created);
    return created;
  });
  const db = await readDb();
  return NextResponse.json({
    agent: toPublicAgent(withGlobalEndpoints(agent, db.agentEndpoints)),
  });
}
