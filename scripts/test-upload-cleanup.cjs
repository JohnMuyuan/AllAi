/**
 * 附件清理。跑法：
 *
 *   node scripts/test-upload-cleanup.cjs
 *
 * 补的是一个一直存在的洞：删创作会顺手删掉它生成的图，**删聊天对话却什么都不删** ——
 * 你发过的图、AI 在聊天里生成的图，永远留在 ~/.allai/uploads，也没有入口能清。
 * 实测用户机器上 67 个附件 4.88MB 全部没有任何引用。
 *
 * 但「删没人用的文件」很容易删错，所以这里重点测的是**安全阀**：
 *   - 还被别的对话 / 创作 / 人物引用的，一个都不能删；
 *   - 有对话文件读不出来（扫不全）时，宁可一个都不删；
 *   - 刚上传还没写进消息的（很新的文件）不能碰。
 *
 * 全程用临时 ALLAI_DATA_DIR，不碰你真的 ~/.allai。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const data = fs.mkdtempSync(path.join(os.tmpdir(), "allai-upload-clean-"));
process.env.ALLAI_DATA_DIR = data;

const esbuild = require(path.join(ROOT, "node_modules", "esbuild"));
const outDir = fs.mkdtempSync(path.join(ROOT, "node_modules", ".allai-upload-clean-"));
const out = path.join(outDir, "mod.cjs");
esbuild.buildSync({
  stdin: {
    contents: [
      `export { listConversations, writeConversation, removeConversation } from ${JSON.stringify(path.join(ROOT, "lib", "conversations.ts"))};`,
      `export { saveUpload, readUpload } from ${JSON.stringify(path.join(ROOT, "lib", "uploads.ts"))};`,
    ].join("\n"),
    resolveDir: ROOT,
    loader: "ts",
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  outfile: out,
  logLevel: "silent",
});
const { listConversations, writeConversation, removeConversation, saveUpload, readUpload } = require(out);

const results = [];
const check = (name, ok, detail = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** 把文件时间往前拨，绕过「24 小时内不碰」那道保险。 */
function age(id) {
  const dir = path.join(data, "uploads");
  for (const name of fs.readdirSync(dir)) {
    if (!name.startsWith(id)) continue;
    const old = Date.now() - 3 * 24 * 3600 * 1000;
    fs.utimesSync(path.join(dir, name), old / 1000, old / 1000);
  }
}

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const put = (name) => saveUpload({ name, mime: "image/png", data: png });

function conversation(id, messages) {
  return { id, title: id, messages, modelKey: "p::m", createdAt: 1, updatedAt: 1 };
}

async function main() {
  // A 独占；B 被另一条对话也引用；C 是聊天里生成的图（只出现在正文 markdown 里）
  const a = await put("a.png");
  const b = await put("b.png");
  const c = await put("c.png");
  const keepNew = await put("new.png"); // 刚传的，不许碰

  await writeConversation(
    conversation("conv-1", [
      { id: "m1", role: "user", content: "看图", attachments: [{ id: a.id, name: "a.png", mime: "image/png", kind: "image" }], createdAt: 1 },
      { id: "m2", role: "assistant", content: `好的\n![生成图](/api/uploads/${c.id})`, createdAt: 2 },
      { id: "m3", role: "user", content: "还有这张", attachments: [{ id: b.id, name: "b.png", mime: "image/png", kind: "image" }], createdAt: 3 },
    ]),
  );
  await writeConversation(
    conversation("conv-2", [
      { id: "n1", role: "user", content: "同一张图", attachments: [{ id: b.id, name: "b.png", mime: "image/png", kind: "image" }], createdAt: 1 },
    ]),
  );

  // 删掉 conv-1：a 和 c 是它独占的，b 还被 conv-2 用着
  await removeConversation("conv-1");
  check("删对话会删掉它独占的附件", !(await readUpload(a.id)));
  check("正文里的生成图也一起删（不在 attachments 里）", !(await readUpload(c.id)));
  check("还被别的对话引用的不许删", Boolean(await readUpload(b.id)));

  // 开机扫：b 仍被 conv-2 引用，keepNew 太新
  age(b.id);
  await listConversations();
  await wait(600);
  check("开机扫不动还被引用的", Boolean(await readUpload(b.id)));
  check("开机扫不动刚上传的", Boolean(await readUpload(keepNew.id)));

  // 真正的孤儿：谁都不引用，而且够老
  const orphan = await put("orphan.png");
  age(orphan.id);
  // sweep 每个进程只跑一次，直接调内部逻辑不方便 —— 换一条对话触发不了，
  // 所以这里改用「删掉最后一条引用」的路径验证孤儿会被收走。
  await writeConversation(conversation("conv-3", [
    { id: "o1", role: "user", content: "孤儿", attachments: [{ id: orphan.id, name: "orphan.png", mime: "image/png", kind: "image" }], createdAt: 1 },
  ]));
  await removeConversation("conv-3");
  check("没人再引用的会被收走", !(await readUpload(orphan.id)));

  // 安全阀：有对话文件坏掉时，一个都不能删
  const broken = await put("broken.png");
  age(broken.id);
  await writeConversation(conversation("conv-4", [
    { id: "p1", role: "user", content: "要删的", attachments: [{ id: broken.id, name: "broken.png", mime: "image/png", kind: "image" }], createdAt: 1 },
  ]));
  fs.writeFileSync(path.join(data, "conversations", "conv-2.json"), "{ 这不是 JSON");
  await removeConversation("conv-4");
  check(
    "有对话读不出来时一个都不删",
    Boolean(await readUpload(broken.id)),
    "扫不全还敢删，等于把读不出来那条对话里的图全清了",
  );

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.rmSync(data, { recursive: true, force: true });
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} 通过`);
  assert.equal(passed, results.length, "upload cleanup regression failed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
