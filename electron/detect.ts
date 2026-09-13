import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export type DetectedCli = {
  kind: "grok-build" | "claude-code" | "codex";
  name: string;
  command: string;
  version: string;
};

const CANDIDATES: {
  kind: DetectedCli["kind"];
  name: string;
  bins: string[];
  extra: () => string[];
}[] = [
  {
    kind: "grok-build",
    name: "Grok Build",
    bins: ["grok", "grok.exe"],
    extra: () => [path.join(os.homedir(), ".grok", "bin", "grok.exe")],
  },
  {
    kind: "claude-code",
    name: "Claude Code",
    bins: ["claude", "claude.exe"],
    extra: () => [path.join(os.homedir(), ".local", "bin", "claude.exe")],
  },
  {
    kind: "codex",
    name: "Codex CLI",
    bins: ["codex", "codex.cmd", "codex.exe"],
    extra: () => [
      path.join(process.env.APPDATA || "", "npm", "codex.exe"),
      path.join(process.env.APPDATA || "", "npm", "codex.cmd"),
      path.join(process.env.APPDATA || "", "npm", "node_modules", "@openai", "codex", "bin", "codex.js"),
    ],
  },
];

async function whereBin(name: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("where.exe", [name], { windowsHide: true });
    const line = stdout
      .split(/\r?\n/)
      .map((item) => item.trim())
      .find((item) => item && !item.toLowerCase().endsWith(".ps1"));
    return line || null;
  } catch {
    return null;
  }
}

export async function versionOf(command: string): Promise<string> {
  try {
    const inv = cliInvocation(command, ["--version"]);
    const { stdout, stderr } = await execFileAsync(inv.file, inv.args, {
      windowsHide: true,
      timeout: 8000,
      windowsVerbatimArguments: inv.verbatim,
    });
    const text = `${stdout}\n${stderr}`.trim();
    return text.split(/\r?\n/)[0]?.slice(0, 80) || "已安装";
  } catch {
    return "已安装";
  }
}

export async function detectClis(): Promise<DetectedCli[]> {
  const found: DetectedCli[] = [];
  for (const item of CANDIDATES) {
    const guesses = [...item.extra(), ...(await Promise.all(item.bins.map(whereBin)))].filter(
      (value): value is string => Boolean(value && fs.existsSync(value)),
    );
    const command =
      guesses.find((value) => /\.exe$/i.test(value)) ||
      guesses.find((value) => /\.cmd$/i.test(value)) ||
      guesses[0];
    if (!command) continue;
    found.push({
      kind: item.kind,
      name: item.name,
      command,
      version: await versionOf(command),
    });
  }
  return found;
}

export async function resolveCommand(
  kind: DetectedCli["kind"] | "custom",
  explicit: string,
): Promise<string | null> {
  if (explicit.trim()) return explicit.trim();
  if (kind === "custom") return null;
  const list = await detectClis();
  return list.find((item) => item.kind === kind)?.command ?? null;
}

export type CliInvocation = {
  file: string;
  args: string[];
  verbatim?: boolean;
};

function unwrapNpmJs(command: string): string | null {
  if (/\.js$/i.test(command) && fs.existsSync(command)) return command;
  if (!/\.(cmd|bat)$/i.test(command) || !fs.existsSync(command)) return null;
  try {
    const text = fs.readFileSync(command, "utf8");
    const hit = text.match(/%dp0%\\node_modules\\([^"'\s]+\.js)/i);
    if (!hit) return null;
    const js = path.join(path.dirname(command), "node_modules", hit[1]);
    return fs.existsSync(js) ? js : null;
  } catch {
    return null;
  }
}

function quoteWin(part: string) {
  if (part === "") return '""';
  return /[\s&<>^|()"]/.test(part) ? `"${part.replace(/"/g, '\\"')}"` : part;
}

function resolveNodeBin() {
  if (!process.versions.electron) return process.execPath;
  const candidates = [process.env.ALLAI_NODE, process.env.npm_node_execpath].filter(Boolean) as string[];
  return candidates.find((item) => fs.existsSync(item)) || "node";
}

export function cliInvocation(command: string, args: string[] = []): CliInvocation {
  const js = unwrapNpmJs(command);
  if (js) {
    return { file: resolveNodeBin(), args: [js, ...args] };
  }
  if (/\.exe$/i.test(command) && (path.isAbsolute(command) || !command.includes(" "))) {
    return { file: command, args };
  }
  if (/\.(cmd|bat)$/i.test(command)) {
    return {
      file: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", [quoteWin(command), ...args.map(quoteWin)].join(" ")],
      verbatim: true,
    };
  }
  return { file: command, args };
}
