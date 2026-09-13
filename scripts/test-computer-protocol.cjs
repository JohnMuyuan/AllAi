"use strict";
const assert = require("assert");
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "allai-computer-"));
execFileSync(
  process.execPath,
  [
    path.join(root, "node_modules", "typescript", "bin", "tsc"),
    "lib/computer-use.ts",
    "--pretty",
    "false",
    "--module",
    "commonjs",
    "--target",
    "es2020",
    "--outDir",
    outDir,
    "--esModuleInterop",
    "--skipLibCheck",
  ],
  { cwd: root, stdio: "pipe" },
);
const { extractActions, parseAction, stripActions } = require(path.join(outDir, "computer-use.js"));

assert.equal(parseAction({ op: "click", x: 10.6, y: 20 })?.x, 11);
assert.equal(extractActions("```action\n{\"op\":\"click\",\"x\":1,\"y\":2}\n```")[0].op, "click");
assert.equal(extractActions("好的\n```json\n{\"op\":\"done\",\"summary\":\"完了\"}\n```")[0].op, "done");
assert.equal(
  extractActions('先点这里 {"op":"click","x":40,"y":80} 然后再说一句')[0].y,
  80,
);
assert.equal(
  extractActions("```action\n{\"action\":{\"op\":\"text\",\"text\":\"hello\",\"element\":3}}\n```")[0].element,
  3,
);
assert.equal(stripActions("看见图。\n```action\n{\"op\":\"wait\",\"ms\":200}\n```\n").includes("op"), false);
assert.equal(extractActions("随便说说，没有动作")[0], undefined);

console.log("computer protocol tests: ok");
