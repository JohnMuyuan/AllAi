/**
 * 模型溯源的纯函数：家族识别、指纹库映射、指示灯、数字解析。
 *
 *   node scripts/test-model-trace.cjs
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const esbuild = require(path.join(ROOT, "node_modules", "esbuild"));
const dir = fs.mkdtempSync(path.join(ROOT, "node_modules", ".allai-model-trace-"));
const out = path.join(dir, "model-trace.cjs");
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "lib", "model-trace", "match.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  outfile: out,
  logLevel: "silent",
});
const fingerprintOut = path.join(dir, "fingerprint.cjs");
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "lib", "model-trace", "fingerprint.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  outfile: fingerprintOut,
  logLevel: "silent",
});

const { traceFamily, mapToBankId, isRouteMismatch, lampLevel } = require(out);
const { parseNumbers } = require(fingerprintOut);

const results = [];
const check = (name, ok, detail = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

check("claude 家族", traceFamily("claude-sonnet-4-6") === "claude");
check("gpt 家族", traceFamily("gpt-5.4") === "gpt");
check("o3 算 gpt", traceFamily("o3") === "gpt");
check("grok 不测", traceFamily("grok-4.6") === null);
check("gemini 不测", traceFamily("gemini-2.5-pro") === null);

check("精确对上 gpt-5.4", mapToBankId("gpt-5.4") === "gpt-5.4");
check("gpt-5 不要误撞 gpt-5.4", mapToBankId("gpt-5") === null);
check("gpt-4o 库里没有", mapToBankId("gpt-4o") === null);
check("sonnet 5", mapToBankId("claude-sonnet-5") === "claude-sonnet-5");
check("haiku", mapToBankId("claude-haiku-4-5-20251001") === "claude-haiku-4-5-20251001");

check("家族不同就是路由", isRouteMismatch("claude-sonnet-5", "gpt-5.4", "gpt", 0.2) === true);
check("对上不算", isRouteMismatch("gpt-5.4", "gpt-5.4", "gpt", 0.9) === false);
check("同家族但对不上且够自信", isRouteMismatch("gpt-5.4", "gpt-5.5", "gpt", 0.4) === true);
check("同家族但对不上且不自信", isRouteMismatch("gpt-5.4", "gpt-5.5", "gpt", 0.2) === false);
check("库外型号只比家族", isRouteMismatch("gpt-4o", "gpt-5.4", "gpt", 0.9) === false);

check("0% 绿灯", lampLevel(0) === "green");
check("10% 黄灯", lampLevel(0.1) === "yellow");
check("19% 仍黄", lampLevel(0.19) === "yellow");
check("20% 红灯", lampLevel(0.2) === "red");
check("50% 仍红", lampLevel(0.5) === "red");

check(
  "解析最长数字串",
  JSON.stringify(parseNumbers("note 12 then 3, 4, 5 and more")) === JSON.stringify([3, 4, 5]),
);
check("字母会切开两段", parseNumbers("1 2 hello 10 11 12").join(",") === "10,11,12");
check("超出 355 丢掉", parseNumbers("1 400 2").join(",") === "1,2");

fs.rmSync(dir, { recursive: true, force: true });
const failed = results.filter((item) => !item).length;
if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log(`\n${results.length} passed`);
