import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { skillsDir } from "./paths";
import type { AgentKind, ManagedSkill } from "./types";

function parseFrontmatter(text: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const name =
    (match && /^name:\s*(.+)$/m.exec(match[1])?.[1].trim().replace(/^["']|["']$/g, "")) || "";
  const description =
    (match &&
      /^description:\s*(.+)$/m.exec(match[1])?.[1].trim().replace(/^["']|["']$/g, "")) ||
    "";
  return { name, description };
}

async function readSkill(folder: string, source: ManagedSkill["source"], managed: boolean) {
  const file = path.join(folder, "SKILL.md");
  try {
    const text = await fs.readFile(file, "utf8");
    const parsed = parseFrontmatter(text);
    const id = path.basename(folder);
    return {
      id: `${source}:${id}`,
      name: parsed.name || id,
      description: parsed.description.slice(0, 180),
      source,
      path: folder,
      managed,
      disabledFor: [] as AgentKind[],
    } satisfies ManagedSkill;
  } catch {
    return null;
  }
}

async function scanDir(root: string, source: ManagedSkill["source"], managed: boolean) {
  const out: ManagedSkill[] = [];
  try {
    const names = await fs.readdir(root);
    for (const name of names) {
      const full = path.join(root, name);
      try {
        if (!(await fs.stat(full)).isDirectory()) continue;
      } catch {
        continue;
      }
      const skill = await readSkill(full, source, managed);
      if (skill) out.push(skill);
    }
  } catch {
    // missing
  }
  return out;
}

export async function scanSkills(saved: ManagedSkill[] = []) {
  const home = os.homedir();
  const found = [
    ...(await scanDir(path.join(home, ".grok", "skills"), "grok", false)),
    ...(await scanDir(path.join(home, ".grok", "bundled", "skills"), "grok", false)),
    ...(await scanDir(path.join(home, ".claude", "skills"), "claude", false)),
    ...(await scanDir(path.join(home, ".codex", "skills"), "codex", false)),
    ...(await scanDir(skillsDir(), "allai", true)),
  ];
  const byPath = new Map(saved.map((item) => [item.path, item]));
  return found.map((item) => {
    const prev = byPath.get(item.path) || saved.find((entry) => entry.id === item.id);
    return {
      ...item,
      sourcePath: prev?.sourcePath || item.sourcePath,
      disabledFor: prev?.disabledFor ?? [],
    };
  });
}

export async function importSkill(from: string) {
  const source = path.resolve(from);
  const skill = await readSkill(source, "allai", true);
  if (!skill) throw new Error("这个文件夹里没有 SKILL.md");
  const dest = path.join(skillsDir(), path.basename(source));
  await fs.mkdir(skillsDir(), { recursive: true });
  await fs.cp(source, dest, { recursive: true });
  return {
    ...(await readSkill(dest, "allai", true))!,
    sourcePath: source,
  };
}

export async function deleteManagedSkill(folder: string) {
  const root = path.resolve(skillsDir());
  const resolved = path.resolve(folder);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("只能删除 AllAi 导入的 Skills");
  }
  await fs.rm(resolved, { recursive: true, force: true });
}

export function skillHint(skill: ManagedSkill, kind: AgentKind) {
  return !skill.disabledFor.includes(kind);
}
