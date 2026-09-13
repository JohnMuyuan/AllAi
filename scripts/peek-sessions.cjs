const fs = require("fs");
const path = require("path");
const home = process.env.USERPROFILE;

function firstJsonLines(file, n = 8) {
  const fd = fs.openSync(file, "r");
  const buf = Buffer.alloc(64 * 1024);
  const read = fs.readSync(fd, buf, 0, buf.length, 0);
  fs.closeSync(fd);
  const text = buf.slice(0, read).toString("utf8");
  const lines = text.split(/\n/).filter(Boolean).slice(0, n);
  for (const line of lines) {
    try {
      const o = JSON.parse(line);
      console.log("TYPE", o.type || o.role || o.sessionUpdate, "KEYS", Object.keys(o).join(","));
      console.log(JSON.stringify(o).slice(0, 500));
    } catch {
      console.log("SKIP", line.slice(0, 120));
    }
  }
}

console.log("\n==== GROK updates ====");
firstJsonLines(
  path.join(
    home,
    ".grok/sessions/D%3A%5CCodePorject%5CWeb%5CAllAi/01a07a5a-a78f-7e00-89e1-924ddfc0a7ac/updates.jsonl",
  ),
  6,
);

console.log("\n==== CLAUDE ====");
firstJsonLines(
  path.join(home, ".claude/projects/D--CodePorject---/d8be971e-52a9-4bd3-957d-245ab38b8a7b.jsonl"),
  8,
);

console.log("\n==== CODEX ====");
firstJsonLines(
  path.join(
    home,
    ".codex/sessions/2026/09/06/rollout-2026-09-06T00-17-59-01a07594-c6c3-7d51-9866-c85e291eed20.jsonl",
  ),
  6,
);
