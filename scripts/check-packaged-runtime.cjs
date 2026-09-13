// Exercise the actual shipped Electron/Next runtime, outside source node_modules.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");

function checkComputerHost(runtime) {
  return new Promise((resolve, reject) => {
    const script = path.join(runtime, "resources", "computer.ps1");
    assert(fs.existsSync(script), "Packaged computer.ps1 must be a real resource file");
    const bytes = fs.readFileSync(script);
    assert(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), "computer.ps1 must keep its UTF-8 BOM");
    const child = spawn(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    let readyHandled = false;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Packaged computer host did not become ready in 10 seconds"));
    }, 10_000);
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      const line = stdout.split(/\r?\n/).find((row) => row.trim().startsWith("{"));
      if (!line || readyHandled) return;
      try {
        const ready = JSON.parse(line);
        assert(ready.ready && ready.width > 0 && ready.height > 0, "Packaged computer host must report physical screen size");
        assert.equal(ready.uia, true, "Packaged computer host must load Windows UI Automation");
        assert.equal(ready.capture, true, "Packaged computer host must load target-window capture support");
        readyHandled = true;
        child.stdin.write("quit\n");
      } catch (error) {
        clearTimeout(timer);
        child.kill();
        reject(error);
      }
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Packaged computer host exited ${code}: ${stderr}`));
    });
  });
}

/**
 * 终端宿主（本机所有 CLI 都由它启动）在**仓库外面**也必须能起来。
 *
 * 必须拷到临时目录再跑：resources/pty-host 就在仓库里面，就地跑的话
 * require("node-pty") 会一路往上找到仓库自己的 node_modules，怎么都过 ——
 * 而真正装安装包的机器上没有那份，一启动就挂，界面上只剩「无法联系终端宿主」。
 * 0.16.17 之前就是这么漏出去的。
 */
function checkPtyHost(runtime) {
  const source = path.join(runtime, "resources", "pty-host");
  assert.ok(fs.existsSync(path.join(source, "pty-host.js")), "Packaged pty-host.js must exist");
  assert.ok(
    fs.existsSync(path.join(source, "node_modules", "node-pty")),
    "Packaged pty-host must ship its own node-pty (electron-builder drops node_modules from extraResources)",
  );
  const away = fs.mkdtempSync(path.join(os.tmpdir(), "allai-pty-check-"));
  const script = path.join(away, "pty-host", "pty-host.js");
  fs.cpSync(source, path.join(away, "pty-host"), { recursive: true });
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(runtime, "resources", "node.exe"), [script], {
      cwd: path.dirname(script),
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      windowsHide: true,
      env: { ...process.env, ALLAI_DATA_DIR: away },
    });
    let stderr = "";
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill(); } catch {}
      try { fs.rmSync(away, { recursive: true, force: true }); } catch {}
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => finish(new Error("pty-host did not answer within 20s")), 20_000);
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => finish(error));
    child.on("exit", (code) =>
      finish(new Error(`pty-host exited with code ${code} outside the repo:
${stderr.slice(0, 800)}`)),
    );
    // 真发一次调用：起得来还不够，IPC 得能一来一回。
    child.on("message", (message) => {
      if (message && message.id === "check") finish(null);
    });
    child.send({ id: "check", type: "list" });
  });
}

function checkAdminHost(runtime) {
  return new Promise((resolve, reject) => {
    const script = path.join(runtime, "resources", "admin-host.js");
    assert(fs.existsSync(script), "Packaged admin-host.js must be a real resource file");
    assert(!script.includes(".asar"), "admin-host.js must not be inside asar");
    const node = path.join(runtime, "resources", "node.exe");
    assert(fs.existsSync(node), "Packaged node.exe must exist to launch the admin host");
    // 和 electron/admin-client.ts 同一个方向：我们开管道，宿主连过来，
    // 第一行必须报上启动时给它的一次性密钥。
    const pipe = `\\\\.\\pipe\\allai-admin-check-${process.pid}-${Date.now()}`;
    const secret = require("node:crypto").randomBytes(16).toString("hex");
    let child = null;
    let settled = false;
    const server = net.createServer((socket) => {
      let buffer = "";
      let greeted = false;
      let saw = false;
      socket.on("error", () => {});
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        let index;
        while ((index = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (!line) continue;
          let msg;
          try { msg = JSON.parse(line); } catch { continue; }
          if (!greeted) {
            if (msg.hello !== secret) return finish(new Error("admin host did not present its launch secret"));
            greeted = true;
            socket.write(`${JSON.stringify({
              id: "check",
              op: "spawn",
              file: process.env.ComSpec || "cmd.exe",
              args: ["/d", "/s", "/c", "echo ALLAI_ADMIN_OK"],
              cwd: os.tmpdir(),
            })}\n`);
            continue;
          }
          if (msg.id !== "check") continue;
          if (msg.type === "error") return finish(new Error(msg.message || "admin host spawn failed"));
          if (msg.type === "out" && msg.data) {
            const text = Buffer.from(msg.data, "base64").toString("utf8");
            if (text.includes("ALLAI_ADMIN_OK")) saw = true;
          }
          if (msg.type === "exit") {
            if (!saw) return finish(new Error("admin host spawned but did not echo ALLAI_ADMIN_OK"));
            // 链路一断，宿主必须自己退出 —— 不能留一个提权进程在后台挂着。
            if (child.exitCode !== null) return finish();
            child.once("exit", () => finish());
            socket.end();
            return;
          }
        }
      });
    });
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      try { child?.kill(); } catch {}
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(
      () => finish(new Error("Packaged admin host did not finish handshake, command and self-exit in 8 seconds")),
      8_000,
    );
    server.on("error", (error) => finish(error));
    server.listen(pipe, () => {
      child = spawn(node, [script, pipe, secret], { windowsHide: true, stdio: "ignore" });
      child.on("error", (error) => finish(error));
    });
  });
}

async function main() {
  const root = path.resolve(__dirname, "..");
  const runtime = path.join(root, "dist/win-unpacked");
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "allai-runtime-check-"));
  fs.writeFileSync(path.join(fixture, "db.json"), JSON.stringify({
    providers: [{ id: "packaging-test", name: "Saved configuration", apiKey: "", baseUrl: "https://example.invalid/v1", models: [{ id: "fixture-model", kind: "chat" }] }],
    conversations: [], agents: [], seeded: { xai: true },
  }));
  const port = await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
  const child = spawn(path.join(runtime, "AllAi.exe"), [path.join(runtime, "resources/standalone/server.js")], {
    cwd: fixture, windowsHide: true, stdio: "ignore",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PORT: String(port), HOSTNAME: "127.0.0.1", ALLAI_DATA_DIR: fixture },
  });
  let spawnError;
  child.on("error", (error) => { spawnError = error; });
  try {
    const base = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (spawnError) throw spawnError;
      try { ready = (await fetch(base, { signal: AbortSignal.timeout(1000) })).ok; } catch {}
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert(ready, "Packaged homepage must start");
    for (const route of ["providers", "agents", "prefs"]) {
      const response = await fetch(`${base}/api/${route}`, { signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 200, `Packaged /api/${route} must load saved settings`);
      const data = await response.json();
      if (route === "providers") assert.equal(data.providers[0]?.id, "packaging-test");
    }
    await checkComputerHost(runtime);
    await checkAdminHost(runtime);
    await checkPtyHost(runtime);
    console.log("PASS: shipped Electron runtime loads homepage, saved providers, agents and preferences.");
    console.log("PASS: packaged Computer Use host starts with DPI and UI Automation support.");
    console.log("PASS: packaged admin host starts and can spawn a process.");
    console.log("PASS: packaged pty host starts outside the repo and answers IPC.");
  } finally {
    child.kill();
    if (child.exitCode === null && !spawnError) await new Promise((resolve) => child.once("exit", resolve));
    // Only remove the isolated, generated test directory under the system temp root.
    if (path.dirname(fixture) === path.resolve(os.tmpdir()) && path.basename(fixture).startsWith("allai-runtime-check-")) {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
