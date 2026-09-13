import type { AgentKind } from "./types";

export type PermissionOption = { value: string; label: string; description: string };

/** 各家 CLI 自己的权限模式。聊天不走这里。 */
const CLAUDE: PermissionOption[] = [
  { value: "auto", label: "自动", description: "安全操作自动批，其余再问" },
  { value: "acceptEdits", label: "接受编辑", description: "改文件自动批，跑命令还要问" },
  { value: "plan", label: "计划", description: "只读分析，不改文件、不跑命令" },
  { value: "dontAsk", label: "不询问", description: "会提示的操作一律拒绝" },
  { value: "bypassPermissions", label: "全部放行", description: "跳过权限检查，适合你信任的目录" },
];

const GROK: PermissionOption[] = [
  { value: "auto", label: "自动", description: "安全操作自动批" },
  { value: "acceptEdits", label: "接受编辑", description: "文件改动自动批" },
  { value: "plan", label: "计划", description: "只规划，不落地改动" },
  { value: "dontAsk", label: "不询问", description: "会提示的操作一律拒绝" },
  { value: "bypassPermissions", label: "全部放行", description: "工具一律自动批准" },
];

const CODEX: PermissionOption[] = [
  { value: "auto", label: "自动", description: "工作区可写，审批走自动审查" },
  { value: "read-only", label: "只读", description: "沙箱只读，不能改工作区文件" },
  { value: "full", label: "全部放行", description: "关掉沙箱和审批" },
];

export const DEFAULT_PERMISSION: Record<string, string> = {
  "grok-build": "bypassPermissions",
  "claude-code": "bypassPermissions",
  "codex": "auto",
};

export function permissionOptions(kind: AgentKind | undefined): PermissionOption[] {
  if (kind === "claude-code") return CLAUDE;
  if (kind === "grok-build") return GROK;
  if (kind === "codex") return CODEX;
  return [];
}

export function resolvePermission(kind: AgentKind | undefined, value?: string) {
  const options = permissionOptions(kind);
  if (!options.length) return "";
  if (value && options.some((item) => item.value === value)) return value;
  return DEFAULT_PERMISSION[kind || ""] || options[0].value;
}
