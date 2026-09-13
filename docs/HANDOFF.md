# AllAi 交接

给下一轮对话或下一个人用。当前发版 **0.16.47**，安装包 `dist/AllAi-Setup-0.16.47.exe`。
逐条发版见仓库根目录 `CHANGELOG.md`。

## 接手先读这三段

1. **怎样才算「改好了」**：用户日常打开的是桌面快捷方式
   `C:\Users\7ipny\Desktop\AllAi.lnk`，不是 `next dev`。**只改源码不打包，用户看不见。**
   改完必须：`Stop-Process -Name AllAi -Force`（若在运行）→ `npm run dist` →
   让用户**完全退出**再从快捷方式打开。
   **打完包还要把源码 push 到 GitHub，安装包发 Release**（tag `vX.Y.Z`，附件
   `dist/AllAi-Setup-X.Y.Z.exe`）。仓库保持私有；`dist/` 不进 git。
2. **交活前把下面「改完要跑的检查」四条全跑完。** tsc 和 eslint 都过不代表能跑 ——
   这个项目栽过好几次：客户端引服务端模块（整个界面白屏）、构建 OOM、CLI 参数互斥，
   全是只有真跑起来才暴露的。
3. **「产品约定」那一节的 94 条是用户反复强调过、或踩坑踩出来的**，不是风格偏好。
   动到相关代码前先扫一遍。**约定 91–92 是 0.16.41 审查出来的，尤其要先看** ——
   那两条是同一类错误在两个地方各犯一次，代码里可能还有第三处。
   约定 93–94 是 0.16.42 的：**认牌子的规则和抓图标的顺序都只有一份，别抄第二份。**
   约定 95–97 是 0.16.43 的：**翻译只翻显示不翻数据；图标按「模型 → 接口 → 厂商」找；
   界面上拼出来的中文要先拆成模板和变量再翻。**

---

## 和用户协作

- 用户说中文，回复也用中文。用户自己不写这个项目的代码，靠你实现，但**对结果很有判断力** ——
  界面不对、按钮没用、弹窗丑，一眼看得出来并且会直说。
- **先说结论，别先邀功。** 有一次我先讲修好了什么、把「这个能力其实用不了」放在后面，
  用户直接问「也就是说你没修复吗？」。有没修好的部分就先说没修好。
- **别弹窗。** 这是被反复强调最多的一条（产品约定 22）。AI 干活的过程、报错、
  换模型、压缩上下文，全部显示在对话流里。弹窗只留给「已删除」这种应用级操作，
  而且要用 `components/ConfirmDialog.tsx`，不许用 `window.confirm`（原生的丑）。
- **需求常常一次给三到五条**，编号列出来。做完要**逐条回**，包括「这条我没做，因为…」。
- **动手前不用问太多**，方案一般直接授权（「具体方案和制作还是得麻烦你了」）。
  但方案定了要先用两三句说清楚再写代码。
- 每一轮功能做完的固定动作：版本号 +1 → 写 `CHANGELOG.md` → 更新本文件 → `npm run dist` →
  源码 push 到 `JohnMuyuan/AllAi`，安装包发 GitHub Release。
  用户会立刻从快捷方式打开验收。

---

## 改完要跑的检查

```bash
node scripts/check-client-imports.cjs      # 客户端组件不许引服务端模块
npx tsc --noEmit -p tsconfig.json          # 应用侧
npx tsc --noEmit -p electron/tsconfig.json # Electron 侧（两个 tsconfig，别只跑一个）
npx eslint components app lib mobile relay # scripts/ 和 relay/dist 不在 eslint 配置里
npm run build                              # 真正的验证：前三条过了这条照样可能炸
npm run remote:build                       # 动了 mobile/ 或 relay/ 或 remote-protocol 时
node scripts/test-pty-bridge.cjs           # 动了 electron/pty.ts 的 IPC
node scripts/test-cli-args.cjs             # 动了 electron/chat-run.ts 的参数拼装
node scripts/test-work-merge.cjs          # 动了 mergeAgentWorkLists
node scripts/test-agent-live.cjs          # 动了 electron/live.ts 的判活
node scripts/test-remote-sessions.cjs      # 动了 electron/remote.ts 的会话生命周期时
node scripts/test-launch-env.cjs           # 动了 electron/launch.ts 的鉴权环境变量
node scripts/test-i18n-ui.cjs              # 动了 lib/i18n.ts / lib/theme.ts / Agent 顶栏（要 dev server，见文件头）
node scripts/test-agent-session.cjs        # 动了换模型 / 交接压缩
node scripts/test-cli-commands.cjs         # 动了 lib/cli-commands.ts
```

`check-client-imports` 已经挂在 `npm run build` 和 `npm run dist` 前面了。

**怎么真的验证一个功能**（这个项目不能靠「看起来对」）：

- 起一个隔离的开发实例：`ALLAI_DATA_DIR="$TEMP/xxx" npx next dev -p 4600`。
  Next 16 不允许同时开两个 dev server，先把旧的 `taskkill` 掉。
  ⚠️ **启动时 `lib/scan-suppliers.ts` 会把用户本机 CLI 配置里的真实中转站和 Key
  导进这个临时库**，测试很可能真的花用户的钱。要么全程用假网关，要么先把导进来的
  provider 的 key 清掉。
- 想看「发出去的 payload 到底长什么样」，起一个假的 OpenAI 兼容网关
  （40 行 node http server，把收到的 body 写文件），比读代码可靠得多。
  聊天、摘要、生图都能用它接住。
- 要看真实界面：用 Electron 起一个**带 `electron-dist/preload.js`** 的窗口指向 dev server，
  `executeJavaScript` 点按钮 + `capturePage()` 截图。不加 preload 的话
  `window.allaiDesktop` 不存在，TitleBar 之类的组件会直接返回 `null`，白测一场。
  隐藏窗口（`show: false`）进 HTML 全屏会卡死，测全屏要 `show: true`。
- 写测试数据的文件时注意编码：Windows 控制台是 GBK，
  `python -c "print(...)" > file` 会把中文写坏，用 `io.open(..., encoding='utf-8')`。
- **用脚本改文件时一定要 `assert old in s`。** 字符串没匹配上时 `replace` 会
  安静地什么都不做，你还以为改了。本文件的版本号就这么陈旧了三个版本没人发现 ——
  我每轮都在替换一个早就不存在的字符串。改完顺手 grep 一下结果。

---

## 这是什么

Windows 桌面应用：一个窗口里聊天 + 本地编程 Agent。

- **聊天**：多个 OpenAI 兼容服务；Claude 可走本机 Claude Code 官方登录（和 Claude Code 共用订阅）。
- **Agent**：Grok Build / Claude Code / Codex，各自官方登录或第三方 API，和聊天的服务列表是两套东西。
- **创作**：生图/视频。侧栏是一条条创作对话，同一窗口里连续出图都记在这一条里。
- **Skills**：本机技能文件。

栈：Next.js 16 App Router + React 19 + Tailwind 4，Electron 44，Windows NSIS。

---

## 怎么跑

```bash
npm install
npm run desktop    # 开发：next dev :3000 + electron
npm run dist       # 编译 electron、next build、electron-builder、写快捷方式
```

### 打桌面包（改完桌面功能固定这四步）

用户日常打开的是**桌面快捷方式**，不是 `next dev`。**只改源码、只跑 next dev，用户看不见。**
「编译」在这个项目里指的是**打安装包**，不是 `next build`。

1. **先完全退出 AllAi**，还在跑就：

   ```powershell
   Stop-Process -Name AllAi -Force
   ```

   ⚠️ **不要 `taskkill /IM node.exe`** —— 会把用户正在用的 AllAi 本机服务杀掉。
2. **清掉 `dist/` 里的残留**：`dist/win-unpacked.tmp` 和 `dist/win-unpacked.tmp.lock`
   还在就删掉；**旧的 `AllAi-Setup-*.exe` 不要堆在 `dist/` 里**，会明显拖慢打包
   （每个约 228MB）。留最近一两个当回退就够了。
3. **在项目根目录**执行 `npm run dist`。
4. 让用户**再完全退出一次**，然后从桌面快捷方式 `C:\Users\7ipny\Desktop\AllAi.lnk` 打开。

**正常耗时（用户实测的基准，别把它当 10 分钟的活）**：
tsc 几秒、next build 约 8 秒、**整次 `npm run dist` 约 1.5–2 分钟**。
**超过四五分钟还没动静，多半是 AllAi 没退干净，或 `dist/` 里有上次没打完的临时目录** ——
回去查这两样，别傻等。

打包前至少跑这些（tsc 过了不代表能跑）：

```bash
node scripts/check-client-imports.cjs
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p electron/tsconfig.json
npx eslint components app lib
```

**只有动了 `mobile/` 或 `relay/` 才需要 `npm run remote:deploy`，不要每次都打桌面包。**
每一轮功能做完还要：**版本号 +1 → 写 `CHANGELOG.md` → 更新 `docs/HANDOFF.md` → 再 `npm run dist`。**

### 关于某些 AI 编码环境的“安全删除护栏”

不是项目的问题，但会表现出来。它拦的是 Next / electron-builder 清理**它们自己的**
缓存和临时目录（`.next/turbopack`、`packaging/standalone`、electron 解压临时目录），
症状是跑了很久才报：

```
[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED] {"count":51,"threshold":50,...}
[safe-delete] 操作失败: spawnSync ...\genie-trash\win32-x64.exe ETIMEDOUT
```

**按上面四步把 `dist/` 清干净、AllAi 退干净之后一般不会碰上** ——
0.16.41 那次连着被拦三次，根因是 `dist/` 里堆着旧安装包、还留着上次的 `win-unpacked.tmp`，
清理量一大就撞上阈值（`BULK_THRESHOLD` 默认 50 且**按回合累计**，
手工 `rm -rf` 一次就把额度撑爆了，之后同一回合的构建全被拦）。
真绕不开时再带上这两个环境变量（删除目标只有构建缓存）：

```bash
CODEBUDDY_SAFE_DELETE_ENABLED=0 CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD=500000 npm run dist
```

数据目录 `%USERPROFILE%\.allai\`（可用 `ALLAI_DATA_DIR` 改）：

- `db.json` —— 服务、Agent、prefs、skills、studio。**对话不在这里。**
- `conversations/<id>.json` + `conversations/index.json` —— 一条对话一个文件，侧栏列表读 index。见 `lib/conversations.ts`。老版本 db.json 里的对话首次启动自动搬过来。
- `usage.json` —— token 用量流水，只增不删（设置里手动清空才会没）。见 `lib/usage-store.ts`，纯类型和汇总在 `lib/usage.ts`（界面也要 import，别把 fs 混进去）。
- `history-cache.json` —— Agent 历史扫描的头部解析缓存，删了会自动重建。
- `uploads/`、`skills/`、`studio/`、`claude-chat/`、`grok-chat/`。

本机 CLI（Agent / 官方聊天依赖它们）：

| 产品 | 命令 | 常见路径 |
|------|------|----------|
| Grok Build | `grok` | `~\.grok\bin\grok.exe` |
| Claude Code | `claude` | `~\.local\bin\claude.exe` |
| Codex | `codex` | `%APPDATA%\npm\codex.cmd` → 实际是 npm 的 `codex.js` |

---

## 三条传输路径（聊天）

选模型后，发送走哪条由 `modelKey` 决定，**不要混**。

| 条件 | 路径 | 入口 |
|------|------|------|
| `claude-official::` / `grok-official::` / `chatgpt-official::` | 本机 CLI 单轮 print 模式，吃订阅额度 | `desktop.officialChat({kind})` → `electron/chat-run.ts` `mode: "chat"` |
| 其它服务（关闭联网） | HTTP `POST /api/chat` → `{baseUrl}/chat/completions` SSE | `app/api/chat/route.ts` |
| 其它服务（**开了联网**） | HTTP `POST /api/chat` → `{baseUrl}/responses` SSE | `lib/responses-api.ts` |
| `chatgpt-web` | Electron 内嵌网页（原生层，盖在窗口上） | `electron/chatgpt-view.ts` |

**官方登录聊天**统一在 `lib/official-chat.ts` 的 `OFFICIAL_CHATS` 里。加一个只要往那个数组加一行 + 在 `chat-run.ts` 的对应 kind 分支里加 chat 模式参数。目前三个：Claude 账号 / Grok 账号 / ChatGPT 账号。

- Claude：`claude -p --output-format stream-json --verbose --include-partial-messages --tools "" --disable-slash-commands --safe-mode --system-prompt <CHAT_SYSTEM>`
- Grok：`grok -p --output-format streaming-messages-json --include-partial-messages --tools "" --disable-web-search --no-subagents --no-plan --system-prompt-override <CHAT_SYSTEM>`
- ChatGPT：`codex exec --json --skip-git-repo-check --sandbox read-only -C <cwd> "<CHAT_SYSTEM>

<prompt>"`（codex 没有 --system-prompt，只能拼进 prompt；续会话是 `codex exec resume <id>`）

三者都跑在 `~/.allai/<kind>-chat/` 这个空目录里，`spawnEnv(_, oauthOnly)` 会把 ANTHROPIC_/XAI_/OPENAI_ 的 Key 和 BASE_URL 全删掉 —— 官方登录必须吃 OAuth 订阅额度。

`Provider.auth` 是 `"claude-official"` / `"grok-official"`，id 固定等于 `providerId`。没有 API Key，不要当 OpenAI 兼容接口去请求。

切走之后不要 `--resume` 旧 session。只在「上一轮也是同一个官方服务」时才 resume，且 id 必须是 CLI 自己返回的 `cliSessionId`，禁止用 AllAi 对话 id 冒充。

Claude `-p` + `stream-json` 必须带 `--verbose`，否则直接报错。Grok 的 `--tools ""` 用 node spawn 传没问题（PowerShell 里手测会报 "a value is required"，那是 PowerShell 吞了空参数，不是 CLI 的限制）。

---

## 创作

侧栏是**对话**，不是每张图一条。点「新创作」才另开；同一窗口连续出图都写进当前对话。

数据在 `db.json`：

- `studioConversations[]`：`id / title / createdAt / updatedAt`
- `studioJobs[]`：一次生成或一次换模型，必须带 `conversationId`
- 老数据没有 `conversationId` 的，启动时 `lib/studio.ts` 的 `migrateStudioConversations` 给每个旧 job 各开一条对话

| 路径 | 用途 |
|------|------|
| `components/Studio.tsx` | 创作主界面：左图右提示词、乐观「正在生成」、取消、参考图 |
| `components/MediaViewer.tsx` | 放大查看、滚轮缩放、下载、复制、用作参考 |
| `lib/studio.ts` | 标题、预览、旧数据迁移 |
| `lib/imagine.ts` | 调生图/视频接口；`readApiError` 把网关原文带出来；吃 `AbortSignal` |
| `app/api/imagine/route.ts` | 创建 job、真正生成、第一轮总结标题、取消时把 job 标成「已取消」 |
| `app/api/studio/conversations/` | 列表 / 读一条（含 jobs）/ 改名 / 删除 |
| `app/api/studio/conversations/[id]/title` | 手动再总结一次标题 |
| `app/api/studio/jobs/` | 换模型提示写入；`GET` 还在但界面不再用它列侧栏 |
| `app/api/studio/characters/` | 人物参考照片 |

界面约定：

- 布局：`md:grid-cols-[minmax(0,1fr)_16rem]`，图占大列，提示词是右上角小气泡，不要跟图一样高。
- 发送立刻 `onAddJob` 一条 `status: "running"` 的本地 pending，右侧出提示词，左侧 `GeneratingFrame`。不要等接口回来才出气泡。
- 生成中 `Composer` 的停止按钮要接到 `AbortController`；`/api/imagine` 必须看 `request.signal`，并传给 `generateImages` / `generateVideo`。
- 图：点击放大；悬停下载/放大；右键下载、复制、用作参考；拖到输入框走 `ALLAI_UPLOAD_DRAG`（`components/Composer.tsx`）。视频参考只要图片，不要把视频当参考图。
- 第一轮成功后 `summarizeWithAnyProvider`（`lib/title.ts`）起标题，借任意有 Key 的聊天模型。没有聊天模型就留 `studioTitle()` 的短标题。
- 换模型提示走 `SwitchBadge`，文案是 `型号 · 来源 → 型号 · 来源`，不要再写成「从 A」只在右侧标一个来源。

视频：`POST {base}/videos/generations`，轮询 `{base}/videos/{id}`，最多约 4 分钟。失败/超时时把接口 `error.message` 或最后状态写在左侧，不要只写「超时」。这条路径对所有网关未必都对，改之前先看用户实际报错原文。

---

## 官方额度

统计行和用量页的官方窗口在 `electron/quota.ts`，IPC `quota:official`。**必须本机 curl**，Node `fetch` 打 Anthropic / ChatGPT / grok.com 会被 TLS 指纹拦。令牌只从本机官方登录文件读，不要打印、不要让用户再贴。

| 家 | 令牌 | 接口 | 界面 |
|----|------|------|------|
| Claude | `~\.claude\.credentials.json` → `claudeAiOauth.accessToken` | GET `https://api.anthropic.com/api/oauth/usage` | `5h 已用% · 7d 已用%` |
| ChatGPT | `~\.codex\auth.json` → `tokens.access_token` + `ChatGPT-Account-Id` | GET `https://chatgpt.com/backend-api/wham/usage`；重置次数 GET `.../wham/rate-limit-reset-credits`（拼成 `limite` 是 404） | `5h % · 7d % · 重置 N` |
| Grok | `~\.grok\auth.json` 里 issuer 对应条目的 JWT `key` | 周已用：`cli-chat-proxy.grok.com/v1/billing?format=credits` 的 `creditUsagePercent`，或 POST 空 grpc-web 到 `GetGrokCreditsConfig`。重置次数：POST 空 grpc-web 到 `GetRemainingResets`。没有 5 小时窗口。 | `7d % · 重置 N` |

`GetGrokCreditsConfig` 的 protobuf：外层 field 1 是 config；config field 1 的 float 是周已用百分比（0–100，不是点数）；field 4/5 是本周起止。只读重置次数，不要去 redeem。

界面措辞一律「已用」，不要写「剩余额度」。重置次数可以写「重置 N」。

---

## Agent

- 配置在 `db.json` 的 `agents[]`，每个 Agent 有多个 `endpoints`：`official` 或 `api`。
- **全局提供商池在 `db.json` 的 `agentEndpoints[]`**（0.11.0）。三个 Agent 共用一份 key/地址，
  在「设置 → Agent 接口 → 全局提供商」里改。合并只发生在**发出去**的路上 ——
  `lib/agent-endpoints.ts` 的 `withGlobalEndpoints()`（给界面/服务端）和 `electron/db.ts`
  的 `readAgent()`（给运行器），合并结果带 `global: true`。**绝不写回 `agents[].endpoints`**，
  否则又变成三份各自的副本。`PATCH /api/agents/:id` 会把带 `global` 的项过滤掉；
  过滤后空了就不动本地那几个（不然官方登录那条会被抹掉）。
  模型是例外：同一个全局接口下各 Agent 可以用不同模型，记在 `agents[].model` 上。
- 模型列表只来自该 Agent 自己的接口，**不要**把聊天 `providers` 接到 Agent 选择器（接过会报错）。
- **Claude Code 官方登录和全局 Key 不能叠在同一轮环境变量里**（0.16.24）。
  `electron/launch.ts` 的 `childEnv` 先清掉父进程里的 `ANTHROPIC_*` / `CLAUDE_CODE_OAUTH_TOKEN`，再按这一轮接口写回去。
  有 Base URL 的第三方只设 `ANTHROPIC_AUTH_TOKEN`，没有（或官方 anthropic 地址）才设 `ANTHROPIC_API_KEY`，**不要两个一起设**。
  API 模式再加 `ENABLE_CLAUDEAI_MCP_SERVERS=false` 和 `--settings disableClaudeAiConnectors`。
  回归：`node scripts/test-launch-env.cjs`。
- 官方登录：`electron/cli-auth.ts`。状态/登录/退出/拉模型都走 pty-host IPC。
- Codex 在 Windows 上不要直接 `cmd /c "codex.cmd" ...` 再让 Node 加一层引号；用 `cliInvocation()` unwrap 到 `node.exe` + `codex.js`。
- Codex Agent 一轮默认：`codex exec --json --skip-git-repo-check --approve-for-me`。不要再加 `--sandbox`，codex 0.153+ 会和 `--approve-for-me` 互斥。只读改 `--sandbox read-only`，全部放行改 `--dangerously-bypass-approvals-and-sandbox`。聊天模式仍用 `--sandbox read-only`，不要带 `--approve-for-me`。
- Codex 历史：有 `item_completed` 就只认它（UserMessage / AgentMessage），不要再收一份 `response_item.message`，否则用户消息会写两遍。`thread_source` 为 `guardian_review` / `subagent` 的审批子会话不要进 Agent 列表。**同一会话会拆成多个 `rollout-…jsonl`（文件名带 `父id_子id`）**，列表必须按 `payload.id` 合成一条，打开时按 mtime 把文件拼起来；只盯最新那一个文件会漏掉后半段。Agent 页要定时再扫（Codex 桌面端的活跃时间在 `state_5.sqlite` 的 `recency_at_ms`，不是 jsonl 的 mtime）。
- Agent 权限模式在输入框思考强度右边，选项按 CLI 种类走，存在 `prefs.agentPermissionMode`。目录和默认值见 `lib/permission-mode.ts`。聊天不显示这个按钮。
- 官方模型目录：Codex `codex debug models`；Grok `grok models`；Claude 从 `claude.exe` 里解析具体 id（`claude-sonnet-5` 等）。
- 用户点「官方登录」保存后，mode 必须保持 `official`，不要因为残留 Key/地址改成第三方。

思考强度：

- Codex：low / medium / high / xhigh / max / ultra（界面：轻量、中、高、极高、Max、Ultra）
- Grok：low / medium / high / xhigh
- 按模型名 `lib/reasoning.ts` 自动识别，接口上可手写覆盖。

---

## 上下文上限与自动压缩（0.12.0）

各家模型能装的上下文差得很远，CLI 到自家上限的 83%–85% 会自己 compact。但
**AllAi 自己的记录是事实来源**（见产品约定 1），换模型 / 换 CLI / 走 HTTP 时
都是我们把整段历史重新喂过去的，所以压缩也得我们自己做。

- 上限表在 `lib/context-window.ts`，**这个文件必须保持纯函数**（不碰 fs/fetch），
  界面和服务端都引它。压缩的纯函数（`compactNotice` / `applyCompaction` /
  `clipToTokens` / `compactionTurns`）也在这儿。
- `lib/compact.ts` 是**服务端专用**（要读 db、要发请求）。界面引它会让浏览器包
  报 `Can't resolve 'fs'` —— `scripts/check-client-imports.cjs` 就是防这个的，
  已挂在 `npm run build` / `npm run dist` 前面。
- Codex 记的是 **272K 不是 400K**：标称的 400K 里 128K 留给输出。按 400K 算会压得太晚，
  压的时候内容已经超过压缩接口本身能吃下的量（openai/codex #19409）。
- 触发点：`prefs.compactPercent`（默认 80）。`prefs.autoCompact` 可整个关掉。
  `prefs.contextLimits` 是按 modelId 精确匹配的手填覆盖 —— **`/api/prefs` 里它有专门的
  分支，不能走 brandIcons 那个分支**，那里会把 key 转小写，而模型 id 大小写敏感。
- 压缩结果存在三处：`Conversation.compaction`、`agentWorks[id].compaction`、
  `StudioConversation.compaction`。字段是 `{summary, folded, tokensBefore/After}`，
  `folded` 是被折进摘要的**消息条数前缀**，发出去时用 `applyCompaction()` 套上。
- **对三条 CLI 路，压缩就是放弃 `--resume`、用摘要开新会话。** 旧会话里装的是
  没压过的全量，续下去只会更满。判定在 ChatApp 里（`mustCompact` / `agentMustCompact`），
  客户端先用估算判断，真正的压缩在服务端做。
- **占用量一律优先取 CLI / 接口自己报的数，别用字符估算**（0.12.2 修的 BUG）。
  估算看不见 CLI 内部已经 compact 过、看不见工具输出和系统提示占的量 ——
  实测一条 Codex 会话 CLI 报 101.6K，估算给出 456.7K，差 4.5 倍；而这个数还在
  驱动自动压缩，会把一条只用了 39% 的健康会话连同十万 token 缓存一起丢掉。
  - Agent：`electron/history.ts` 的 `readContextUsage(work)` 从会话文件里读。
    Codex `event_msg/token_count` → `info.last_token_usage.input_tokens`；
    Claude `message.usage` 的 `input + cache_read + cache_creation`；
    **Grok 不在会话文件里** —— `turn_completed.usage.inputTokens` 是一轮里
    **所有模型调用的输入量之和**（旁边就写着 `modelCalls`），拿它当占用会虚高好几倍
    （实测 9 次调用：每次 24K→47K，总和 313K）。要读
    `~/.grok/logs/unified.jsonl` 里最后一条 `shell.turn.inference_done` 的
    `ctx.prompt_tokens`，按 `sid` 对会话，见 `readGrokContext()`。
    走 IPC `agent:context`，每轮结束 `electron/watch.ts` 也会推一次。
  - 聊天：`lib/usage.ts` 的 `liveContextTokens()`，取 `UsageEvent.contextTokens`。
    **各家口径不同，必须在解析时分清**（`electron/chat-parse.ts` 的 `usageEvent`）：
    Anthropic（Claude Code）的 `input_tokens` **不含**缓存读（实测 input=2、
    cache_read=362818），要 `input + cacheRead + cacheWrite`；OpenAI（Codex）和 Grok 的
    **已经含了**，再加就翻倍。靠字段名 `cache_read_input_tokens` 区分。
    老记录没有 `contextTokens`，读的时候按 `cacheRead > input` 现推。
  - 官方登录的 Grok 聊天一轮也可能调多次模型，占用同样走 `readGrokContext()`。
  - 只有全新会话（CLI 还没报过）才退回 `estimateTokens` 估算，界面会标「（估算）」。
- **窗口大小也优先信 CLI**：Codex 报的是 `model_context_window: 258400`，
  不是文档上的 272000。内置表只在 CLI 没报时兜底；用户手填的覆盖值优先级最高。
- 估算器 `estimateTokens`（中文 1 字≈0.6、其它 4 字符≈1）只是兜底，**不是精确值**。
  没引 tokenizer：三家分词器各不相同，为一个进度条把 wasm 塞进包里不值当。

---

## 性能（0.13.0 之后的底线）

界面卡顿在这个项目里几乎只有一个来源：**输入框每敲一个字就让整棵树重渲染，
而树里挂着上百段 Markdown**。0.13.0 之前打字要 145ms 一个字符。

- **`Markdown` / `UserBubble` / `AssistantBubble` / `MessageList` / `AgentBubble` /
  `AgentMessageList` / `StudioTurn` 都是 `memo()` 的，别去掉。** 去掉一个，react-markdown
  就会在每次按键时把整条对话重新解析一遍。Agent 和创作曾经漏过（0.16.5）。
  远程快照 `buildRemoteSnapshot` 必须 `useMemo`，输入框的 draft 不能进 deps。
  `scanWorks` 合并结果没变化要交回原数组。**不要在扫描路径上同步 `tasklist`**（0.16.6
  量过：全进程列表 430ms+，Agent 页 4 秒一扫就会把主进程卡住）。输入文字必须留在
  `Composer` 内部，不能每键 `setState` 到 `ChatApp`。回归：`node scripts/test-typing-isolation.cjs`。
- **memo 只有在 props 稳定时才有用。** ChatApp 里的 `send` / `editUserMessage`
  每次渲染都是新函数，用 latest-ref（`sendRef` / `editRef` + `useCallback`）
  给它们稳定 identity 再往下传。**不要**在 JSX 里写
  `onRegenerate={() => send("regenerate")}` 这种内联箭头函数 —— 一写 memo 就废了。
- **不要用「设 height=0 再读 scrollHeight」做输入框自适应**，那是强制同步重排。
  用 CSS 的 `field-sizing: content`（Chromium 123+），JS 只在不支持时兜底。
- 用量记录只增不删（产品约定 25），凡是遍历 `usageEvents` 的派生值都要 `useMemo`。
- **怎么量**：起隔离 dev 实例 + 一条大对话（240 条消息 / 17 万字），用 Electron
  探针注入脚本，逐字符 dispatch `input` 事件、量到下一帧的耗时，
  同时用 `PerformanceObserver({entryTypes:['longtask']})` 数长任务。
  要找热点就用 `webContents.debugger` 的 `Profiler.start/stop` 抓 CPU profile，
  按 self time 汇总 —— 这次就是它直接指出了 micromark 和那次强制重排。
  基线：打字中位数 **< 10ms、长任务 0**；同样 15 次输入的 CPU 采样 **< 300**。

---

## 管理员 CLI（0.15.3，0.15.4 重做了链路）

聊天和 Agent 输入框各有一个「管理员」开关（`prefs.cliAdminChat` / `cliAdminAgent`）。
只影响本机 CLI（官方登录聊天 + Agent），第三方 HTTP `/api/chat` 不走这条路。

**全部逻辑在终端宿主（pty-host）里**，因为本机 CLI 都在那个进程 spawn：
`admin-client.ts` 的 `ensureAdminLink()` 开一条随机名字的命名管道 + 生成一次性密钥，
用 `Start-Process -Verb RunAs` 拉起 `resources/admin-host.js`（管道名和密钥放在它的命令行里），
宿主**连回来**，第一行报密钥，对上了才收养这条链路，然后立刻停止监听。
之后 `spawnCli()` 发现 `elevated` 且自己不是管理员，就经这条链路让宿主去 spawn。
主进程只算脚本路径（只有它有 `app` / `resourcesPath`），经环境变量
`ALLAI_ADMIN_HOST_SCRIPT` / `ALLAI_NODE_EXE` 交给终端宿主；IPC `admin:ensure` /
`admin:status` 只是转发。带 `elevated` 的聊天/Agent 请求，终端宿主会先自己 ensure。

| 文件 | 干什么 |
|------|--------|
| `electron/admin.ts` | 主进程：只算 admin-host.js 的真实路径 |
| `electron/admin-client.ts` | 终端宿主：开管道、弹 UAC、验密钥、多路复用、假 ChildProcess |
| `electron/admin-host.ts` | 提权后的**客户端**：连回来、报密钥、替 AllAi spawn；链路断就退出 |

**0.15.3 原版为什么启动不了（三个 bug 叠在一起，别再写回去）：**

1. **管道名两边对不上**：主进程拉宿主、终端宿主去连，各自拿 pid 拼名字 ——
   主进程没有 `ALLAI_MAIN_PID` 就退回 `ppid`，拼出来是主进程**父进程**的 pid。
2. **提权进程开的管道，没提权的 AllAi 写不进去**：默认 DACL 的 owner 是
   Administrators，没提权的令牌里 Administrators 是 deny-only，只剩 `Everyone => Read`。
   UAC 点了「是」、宿主也起来了，连接照样被拒。所以现在方向反过来：AllAi 开管道。
3. **失败静默**：开关失败直接 `return`，用户等 60 秒后按钮还是关的，一句提示都没有。

**不要给管道开 `writableAll`。** 看起来一行就能「修好」第 2 条，但它给 Everyone
读写 + 建实例权限：这台机器上任何账号都能连上来让管理员宿主替它跑任意命令，
管道名还能枚举。现在的做法是默认 DACL（只有当前用户和管理员能写）+ 一次性密钥
+ 收养后停止监听。

**UAC 点「否」**：Start-Process 抛 ERROR_CANCELLED(1223)，脚本以退出码 2 结束，
界面立刻提示，不等 60 秒。`adminLaunchCommand()` 单独导出就是为了能测它：
PowerShell 里同名函数会盖过 cmdlet，定义一个假 `Start-Process` 就能在不弹窗的前提下
验证引号和退出码。`ALLAI_ADMIN_NO_RUNAS=1` 让宿主以当前权限起来，只给自动化测试用。
**真正的 UAC 那一步没法自动测**，只能用户手点。
---

## 远程控制（0.16.0）

手机浏览器操控电脑上的 AllAi。用户文档和部署步骤在 `docs/REMOTE.md`（给用户看的，改功能要同步改它）。

```
mobile/（手机网页） ⇄ relay/（用户服务器上的中继） ⇄ electron/remote.ts（主进程） ⇄ 界面（useRemoteControl）
```

- **手机操控的是界面本身**：聊天/Agent 的操作由主进程转成 `remote:command` 交给界面执行
  （`components/useRemoteControl.ts` 的 `useRemoteBridge`），界面有手机连着时把状态
  （`buildRemoteSnapshot`）200ms 合并推一次给主进程，主进程按消息 id 做差量、加密发给手机。
  创作和文件不经界面：主进程直接调本机 `/api/imagine`、`/api/studio/*`、`/api/uploads`（白名单）。
- **加密**：`electron/remote-protocol.ts`，电脑和手机**同一份代码**（手机那边 esbuild 直接引）。
  配对 = 二维码 `#pair=` 里的一次性 secret → HKDF 派生配对密钥 → 电脑发给手机一把 32 字节长期密钥。
  每次连接双方各出 16 字节随机数，HKDF 派生会话密钥；IV = 方向 + 计数器，不上网，
  所以重放/乱序/篡改都会解密失败 → 电脑回 `reset`，手机重新握手。
- **中继**（`relay/server.ts`）：电脑带 `RELAY_TOKEN` 登记，手机不带 token 只能找已在线的电脑；
  只转发不存储；应用层 `ping/pong` 心跳（浏览器和 Node 的 WebSocket 都拿不到协议层 ping）。
  `npm run remote:build` 把中继和手机网页打进 `relay/dist/`（单文件 `server.cjs` + `public/`）。
- **电脑端连中继用 Node 自带的 WebSocket**，没有打包 `ws`（安装包的 files 只有 electron-dist）。
- 配置 `~/.allai/remote.json`（设备密钥和口令过 `safeStorage`），审计 `~/.allai/remote.log`（不记内容）。

| 文件 | 干什么 |
|------|--------|
| `electron/remote.ts` | 配置、连中继、配对、会话、RPC 分发、状态差量、审计 |
| `electron/remote-protocol.ts` | 加密协议（WebCrypto），两端共用 |
| `components/useRemoteControl.ts` | 界面侧：执行远程命令、构建并推送快照、`useRemoteStatus` |
| `components/RemoteSettings.tsx` | 设置 → 远程 |
| `relay/server.ts` / `Dockerfile` / `docker-compose.yml` | 中继 |
| `mobile/` | 手机网页：`link.ts`（连接/配对/文件）、`ui.tsx`、`views.tsx`（三个专区）、`App.tsx` |
| `scripts/build-remote.cjs` | 打包中继 + 手机网页 |
| `scripts/relay-push.ps1` + `relay/deploy.sh` | 一键部署中继（`npm run remote:deploy`）：SSH 公钥免密、上传、Docker 启动在 30778、首次自动生成口令并沿用。配置在 `scripts/relay-deploy.env`（不提交） |

**怎么测**：`scripts/test-remote-e2e.cjs`（说明在文件头；0.16.7 起手机打开 Agent 改成主进程直接盯真实会话文件，脚本里假的 Agent 工作没有文件、打不开历史，跑的时候加 `SKIP_AGENT=1` 跳过 Agent 那段，其余照常测）起中继 + 一个记录所有帧的代理，
电脑用真实界面 + 真实 `remote.js`（Agent 的 IPC 是假的），手机是第二个窗口加载真实手机网页。
覆盖配对、三个专区、图片上传、明文泄露检查、重放、错误口令、二维码复用、陌生设备、移除设备。
**真实环境状态（2026-09-11）**：用户的服务器已经用 `npm run remote:deploy` 部署好（1Panel 反代由用户自己配），
iPhone 主屏幕 App 里已经能看到「扫码配对」。**用真实手机扫码配对、杀后台后不用重配，用户还没明确确认过**，
接手后第一件事可以问一句。

**部署流程**：`npm run remote:deploy` = `scripts/relay-push.ps1`，配置在 `scripts/relay-deploy.env`（不提交，
用户已填好，SSH 端口 4622、目录 `/opt/allai-relay`、中继端口 30778，免密钥匙 `~/.ssh/allai_relay_deploy` 已装好）。
脚本会打包 → 上传 → 服务器上 `relay/deploy.sh up`（Docker）→ 打印口令（口令存在服务器 `.env`，重复部署沿用）。
部署完用 ssh 在服务器上 `curl 127.0.0.1:30778/version.json` 核对新版本真的上线了。
**改完 `mobile/`、`relay/` 或 `remote-protocol.ts` 都要自己跑这条，别让用户跑**（用户明确要求过）。
中继/手机网页的改动不需要 `npm run dist`，电脑端代码动了才需要。

---

## 产品约定（用户反复强调过）

1. **上下文的唯一事实来源是 AllAi 自己的对话记录，不是任何 CLI 的会话文件。** `--resume` 只是省 token 的优化，不承担正确性。每轮要比对三件事才允许续：上一轮是同一个官方账号（`Conversation.cliKind`）、有 `cliSessionId`、`cliDelivered` 和当前历史条数对得上。任一条不中就开新会话并重放「摘要 + 最近几轮」（`lib/chat-context.ts`）。**不要为了省事把这条退回成「有 session 就 resume」** —— 换模型丢记忆、模型开始编，就是这么来的（0.10.0 之前）。
2. **三个专区都要保上下文**，不只是聊天。Agent 换模型同样开新会话，要走 `/api/context` 交接。创作是无状态接口，没有 session 可续，它的上下文 = 此前几轮的提示词（文字）+ 上一张成品当参考图（视觉），每次现拼。
3. 创作的 `StudioJob.prompt` **只存用户原话**，不许存拼好上下文的 fullPrompt —— 下一轮会把它当历史读回去，一轮比一轮长，界面还会显示整段提示工程。
4. 参考图字段是 `images[].image_url`（data URI 字符串），**不是 `url`**。写错直接 400「images[].image_url is required」，而且是静默失效那种坏法。
5. 喂历史按各家能力选：Claude 用 `--input-format stream-json` 从 stdin 喂原生多轮；Grok / Codex 没有多轮输入，只能拼进 prompt 且必须标注「这是历史，不是此刻的问题」，否则它们会去重新回答旧问题。
6. 聊天服务和 Agent 接口分开。
7. 「官方登录」四个字只出现在用户真的加了官方登录的地方；默认种子是「默认接口」第三方。
8. 不要把 ChatGPT / Claude / Codex 的 OAuth 抄成聊天 API Key。
9. 不要扫描任意 `claude.exe` 进程来显示「运行中」（会误报 CC Switch）。
10. 不要把历史对话塞进用户消息再解析 jsonl（角色会乱）。
11. 用户删掉的模型列表，启动扫描不得再合并回去。同一 base URL 只用来避免重复添加服务，不要往已有列表里塞模型。
12. 生图模型不要进聊天选择器。`grok-imagine` 是生图，不是聊天。
13. 模型列表在设置里保存过一次，就打上 `Provider.modelsPinned`，之后启动扫描一律不碰它 —— 清空也算用户的意思。只有「从没被保存过、当前为空、有 Key」的服务才自动补一次目录。
14. Agent 的「工作」来自各家 CLI 自己的 session 文件，我们改不了那些文件。用户的改名/隐藏/换模型提示存在 `db.json` 的 `agentWorks` 里叠上去；删除是真去删 CLI 的 session 文件（`electron/history.ts` 的 `deleteWork`，有目录名/扩展名两道安全阀），删不掉才退回隐藏。换模型要当时就写一条 `notice` 进时间线。
15. 「思考过程」那一栏不许直接把工具参数 JSON 打出来。一律过 `electron/agent-tools.ts` 的 `describeTool()`。Claude 和 Codex 的会话记录里思考正文是空的/加密的，那种情况标题要写「执行过程」，别骗用户。
16. Grok 的工具调用是 `sessionUpdate === "tool_call"`（带 `rawInput` 和 `_meta["x.ai/tool"]`）。**不要**读 `hook_execution` 上的 `tool_name`，那是钩子，一次工具能刷好几条。
17. Codex 的正片在 `payload.item`，类型是 PascalCase（`CommandExecution` / `FileChange` / `McpToolCall` / `Extension`）。它的 reasoning 是加密的，只有 `summary[].text` 偶尔有一句人话。
18. **不要**在界面上写「剩余额度」，官方窗口一律写「已用」。令牌只从本机官方登录文件读，不要打印、不要让用户再贴；只读，不要去 redeem。三家的令牌位置、接口和字段见上面「官方额度」那一节。
19. Agent 的附件必须先复制进工作目录（`/api/agent-files` → `<cwd>/.allai-files/`）。放在 `~/.allai/uploads` 下 Agent 的沙箱读不到（codex 是 workspace-write）。
20. 流式期间的 `useEffect` **不能把 `active` 放进 deps**。它每来一个 token 就变一次，定时器/订阅会被反复重建 —— 0.9.0 之前的 token 速度就是这么坏掉的（快的流永远等不到定时器触发）。要读最新值用 ref。
21. **第三方接口的联网走 `/v1/responses`，不走 `chat/completions`**。xAI 已把 `chat/completions` 上的 Live Search 下线（`search_parameters` → 410，`tools:[{type:"web_search"}]` → 422，那个端点只认 `function` / `live_search`）。请求形状：`{model, stream:true, input:[...], tools:[{type:"web_search"}]}`。事件名见 `lib/responses-api.ts`，都是对着真实响应抓的：`response.output_text.delta`、`response.reasoning_summary_text.delta`、`response.web_search_call.*`、`response.completed`（带 usage）。
22. **AI 干活的过程和报错一律显示在对话里，不许弹窗。** 聊天走 `ChatMessage.steps`（`search`/`notice`/`error`），Agent 走 `trace`。弹窗只留给应用级操作（已删除、请选择目录…）。报错必须跟着消息落库 —— `/api/chat` 里出错**不要提前 return**，那会跳过保存，刷新后用户看不出这轮为什么是空的。
23. 联网请求成功但**一次 `web_search_call` 都没发生**时必须告诉用户「没有真的联网」。实测该网关的 gpt-5.5 就是这样：收下参数、不报错、也不搜。不说的话用户会把没查过网的答案当成查过的。
24. 图标 data URI 的大小上限在两处，必须一致：`app/api/brand-icon`（512KB）和 `app/api/prefs`（524288 字符）。不一致会出现「抓成功了但存不进去」。多分辨率 .ico 很大，deepseek 的就有 205KB。
25. 用量统计的数据**不会自动过期**，用户明确要长期看。只有他点「清空」才删。
26. 官方型号表只有 `electron/official-models.json` 一份。聊天（`lib/official-chat.ts`）、Agent 兜底（`lib/agent-models.ts`）、CLI 兜底（`electron/cli-auth.ts`）都引它。它放在 `electron/` 下是因为那个 tsconfig 用 `rootDir: "."`，反过来引用不了 `lib/`。
27. 创作侧栏是对话（`studioConversations`），job 挂 `conversationId`。同一窗口连续出图都写进当前对话，点「新创作」才另开。第一轮用聊天服务 `summarizeWithAnyProvider` 起标题。发送后立刻出右侧气泡和左侧「正在生成」；`/api/imagine` 吃 `request.signal`，可以取消。视频错误把接口原文带出来。换模型文案是 `型号 · 来源 → 型号 · 来源`。
28. **窗口没有系统边框**（`frame: false`）。最小化/最大化/关闭是 `components/TitleBar.tsx` 自己画的，走 IPC `window:minimize` / `window:toggle-maximize` / `window:close`，最大化状态由主进程 `window:state` 推过来。整条 `.titlebar` 是 `-webkit-app-region: drag`，按钮上必须显式 `no-drag`，否则点不动。TitleBar 在网页里（拿不到 `window.allaiDesktop`）返回 `null`；但只要桌面 API 在，就算 `windowState()` 失败也照样渲染 —— 不然窗口会没有关闭按钮。
29. **视频一律用 `components/VideoPlayer.tsx`，不要写 `<video controls>`。** Chrome 自带控件长得和皮肤两个世界，全屏按钮在我们这种多层 overflow 容器里还点不动。全屏是对播放器最外层容器（`[data-video-player]`）请求的，不是对 `<video>`。
30. **`next.config.ts` 的 `outputFileTracingExcludes` 必须同时写 `/*` 和 `/**`。** `/*` 只匹配一层，`/page` 之外的入口会漏掉，然后追踪去读 `dist/` 里几百 MB 的旧安装包，构建直接 `os error 1450`。
31. **上下文压缩按模型的真实上限来**，表在 `lib/context-window.ts`。交接（换模型）和到量压缩是同一件事，都走 `compactIfNeeded()`，别再写死「最近 N 条」。压缩说明显示在对话里，不弹窗（见约定 22）。
32. **`lib/context-window.ts` 必须保持纯函数**（不碰 fs / fetch）—— 界面引它。要读 db、要发请求的东西放 `lib/compact.ts`，那是服务端专用。客户端组件引到服务端模块时 tsc 和 eslint 都不报，只有真跑起来才炸 `Can't resolve 'fs'`；`scripts/check-client-imports.cjs` 挂在 build 前面防这个。
33. **共享 JSON 文件必须串行读改写并原子落盘。** `db.json` 已由 `lib/store.ts` 的队列保护；`uploads/meta.json`、`usage.json` 也不能写成各请求各自 `read → modify → write`。并行请求会静默覆盖彼此，上传曾实测 40 个只剩 1 个。解析失败也不能当空数组继续写，那等于把可恢复的数据主动清空。
34. **对话文件是事实来源，`conversations/index.json` 只是缓存。** 列侧栏时要核对磁盘上的会话 id，文件数或 id 对不上就重建；这样程序在“写会话成功、写索引前退出”后仍能自愈。完整保存对话时必须保留 `compaction`。
35. **联网的永久不支持与临时失败要分开。** 只有明确的协议/端点拒绝状态才写 `webSearchUnsupported`；超时、断网、鉴权、限流和 5xx 不缓存。Responses 流已经吐出正文后再失败时只能保留部分回答并结束，不能回退 `chat/completions` 再接一份答案。
36. **SSE 和 CLI 都不能假设最后有换行。** 三个 SSE 消费器要 flush decoder 和尾缓冲；Electron 子进程 stdout 用 `StringDecoder`，否则最后一帧会丢、中文/emoji 在 Buffer 边界会乱码。
37. **上下文占用量绝不能用字符估算当真值。** CLI 和接口都会报真实的输入量，一律以它为准（Agent 走 `readContextUsage`，聊天走 `liveContextTokens`）。估算只在全新会话时兜底，并且界面要标「（估算）」。这条不是为了好看 —— 估算虚高会误触发压缩，把健康会话和它的缓存一起丢掉（0.12.1 的真实故障）。**但"CLI 报的数"也要挑对字段**：一轮里多次模型调用的**总和**（Grok 的 `inputTokens`）和 Anthropic 那种**不含缓存读**的增量（Claude 的 `input_tokens`）都不是窗口占用，照抄会分别虚高 6 倍和缩水到个位数（0.12.2 的两个 BUG）。
38. **消息列表相关的组件必须保持 `memo()`，传给它们的回调必须稳定。** 这不是优化癖 —— 0.13.0 之前打字要 145ms 一个字符，因为每次按键都把整条对话的 Markdown 重新解析一遍。改这一块之后按「性能」那一节的方法量一遍，基线是打字中位数 < 10ms、长任务 0。
39. **操控电脑绝不能盲点。** 一次任务必须绑定一个目标窗口，每个输入动作前按句柄和进程重新激活、核对；当帧目标对不上就拒绝并重截。测这个功能时用假执行器或专门的无敏感测试窗口，别拿日常桌面当靶子。必要确认一律走横幅，不许弹窗。
40. **要交给外部进程执行的文件，必须是磁盘上的真实文件，不能在 app.asar 里。** `fs.existsSync` 会骗你（Electron 虚拟化了 Node 的 fs），但 PowerShell / node / 各家 CLI 都不认 asar。打包验证时光确认「文件在 resources 下」不够 —— 要确认**运行时实际选中的是哪一份**（0.14.4 就是栽在这儿）。
41. **用户提交电脑控制任务就是对任务内普通步骤和明确结果的授权。** 默认档不能在每次输入、按键、拖拽，或用户已经明确要求的发送/删除/关闭动作前重复确认。只有关键条件不清或动作超出原任务时才由模型标 `confirm:true`；需要逐步看动作请显式选“逐步审核”。
42. **电脑控制优先使用 Windows UI Automation 控件，坐标只作回退。** 控件编号是每张截图重新生成的临时值，执行必须带当帧目标信息；窗口切换只接受当帧 `windows` 列表里的句柄，失效就重截，不能猜。
43. **电脑控制的动作、完成和运行错误属于 AI 工作过程。** 去掉模型的 action JSON，把可读步骤落到对应助手消息；模型漏动作、动作失败、截屏失败和步数耗尽不能用 toast 代替历史记录。
44. **本机 CLI 的管理员权限走提权宿主，不要对每次 spawn 做 RunAs。** 开关在输入框；UAC 只在打开开关（或宿主已死再发）时弹一次。`admin-host.js` 必须是 `resources/` 下的真实文件，打包后运行时实际选中的路径不能落在 asar 里。
45. **管理员宿主的链路：AllAi 开管道、提权宿主连回来，一次性密钥认证，绝不开 `writableAll`。** 反过来（提权进程开管道）没提权的 AllAi 写不进去；`writableAll` 等于把「以管理员跑任意命令」开放给这台机器上所有账号。整套逻辑必须在终端宿主里（CLI 在那边 spawn），别拆到两个进程各算各的管道名。
46. **输入框里只有图标的按钮，说明写在 `data-tip` 里（样式在 globals.css 的 `.composer-tool[data-tip]`），不要用原生 `title`** —— 那是系统样式的提示框，和皮肤对不上。按钮别再加文字标签，加了发送键会被挤到下一行。
47. **操控电脑一轮里的消息都带同一个 `computerRun`，只有第一条用户消息带 `computerGoal`（用户原话）。** 循环替用户发的「已执行…新截图」是给模型的上下文，不是用户说的话 —— `MessageList` 按 `computerRun` 把整轮合并成一条用户目标 + 一条回复（`mergeRun` / `RunBubble`），每步说的话、动作、截图进「执行过程」。别再让这些显示成用户气泡；发给模型的上下文照旧全带。
48. **动画关键帧别和 Tailwind 的 translate 类混用同一方向。** Tailwind 4 的 `-translate-x-1/2` 写的是 CSS `translate` 属性，和 `transform` 是叠加的：关键帧里再写 `translate(-50%, …)` 就会在动画期间偏两倍、结束后跳回（提示条「瞬移」就是这么来的）。居中交给类，关键帧只动另一个方向。
49. **远程控制时手机永远碰不到本机 Next 服务。** 那个服务没有鉴权。手机能做的事只有 `electron/remote.ts` 里写死的 op，参数（文件编号、对话编号）都要校验。加远程能力就在那里加一个 op，**不许**做成通用的 HTTP 转发。
50. **远程加密协议两端共用 `electron/remote-protocol.ts`，只准用 WebCrypto。** 收到密文后、调用 `channel.open()` 之前**不能有 await** —— 计数器依赖收到的顺序。IV 不许改成随机或随帧传输，那会丢掉重放保护。配对密钥只能放在链接的 `#` 后面。改协议必须两端一起改，并提醒用户重新 `remote:build` 部署中继。
51. **远程命令执行的是界面本身，用最新闭包。** ChatApp 每次渲染把最新函数放进 `remoteApiRef`；手机发来的消息**不读也不清**电脑上的输入框（`send()` 的 override、`sendAgent(remote)`）。远程 Agent 请求必须过 `remotePermission()` 和 `caps.allowAdmin`，别绕开 —— 管理员身份放给远程等于从手机绕过 UAC。「操控电脑」不开放给远程。**`agent.open` 在主进程处理**：给这台手机盯那条工作的会话文件，不调用界面 `selectWork`，所以两台手机可以看不同的工作。
52. **没有手机连着时不构建、不推快照。** `remoteLive` 为假时 `useRemoteBridge` 收到 `null`，平时零开销；有手机时 200ms 合并一次。别把它改成每次渲染都推，也别在快照里塞整条长对话（最多 120 条、trace 截断）。
53. **手机网页的配对密钥存成 base64 字符串，IndexedDB 和 localStorage 各一份（`mobile/link.ts`）。** 别改回把 CryptoKey 对象存进 IndexedDB —— WebKit 的主屏幕 App 里那种对象进程重启后读不回来，iPhone 用户杀后台就得重配（0.16.0 的 BUG）。扫码入口只在触屏（`pointer: coarse`）显示，扫出来的链接必须和当前页面同源才接受。**iPhone 主屏幕 App 无视 no-cache**：手机网页的资源地址必须带打包编号（`build-remote.cjs` 注入 `?v=` 和 `__ALLAI_BUILD__`），`index.html` / `version.json` 必须 no-store，`main.tsx` 的 `checkForUpdate()` 别删。改完手机网页或中继要自己跑 `npm run remote:deploy`，别让用户去跑。
54. **消息列表的滚动一律用 `components/useStickToBottom.ts`（回调 ref + 对话编号），桌面三个专区和手机网页共用。** 别再在挂载时绑一次 scroll 监听：滚动区经常是后来才出现的（手机先是列表、Agent 没消息时不渲染滚动区），会绑空，打开对话就停在前面（0.16.8 修的）。换对话要把「贴底」复位，否则上一条翻过就一直不回底部。
55. **Agent 改文件的差异在主进程解析（`electron/diff.ts`），`loadMessages` 最后用 `elideOldDiffs` 只给最近 40 条消息留内容。** 实测全量差异让长会话从 836KB 涨到 1378KB（Grok 603KB → 1476KB），盯文件时每次变动整份发给界面，打字会卡。手机不显示差异，`remote.ts` 的 `packAgentMessages` 发之前把 diff 去掉。别把全量差异往界面或手机上塞。
56. **Claude Code 在线 = `~/.claude/sessions/<pid>.json` 里登记的进程还活着；`status: "busy"` 才算运行中（`electron/live.ts`）。** 约定 9 仍然有效：不扫 claude.exe 进程名，也不跑 tasklist（0.16.6 量过，430ms 以上）。只有 7 天内更新过的登记才认，防进程号被回收。
57. **本机 CLI 更新用各家自己的命令（`claude update` / `codex update` / `grok update`），主进程里异步排队跑（`electron/cli-update.ts`）。** 启动 20 秒后自动更新一次，设置 → 关于里能关，结果存在 `~/.allai/cli-update.json`。别自己去猜是 npm 装的还是原生安装包。
58. **设置对话框固定高度（`h-[min(92vh,820px)]`），别改回 `max-h`。** 各页内容高度不同、有的还是异步读出来的，对话框跟着伸缩时后面的页面会露出来，看着像闪了一下（0.16.9 修的「切到远程闪一下」）。
59. **Agent 差异的行号靠 hunk 头（`@@@ -旧起始,行数 +新起始,行数 @@`，界面按它逐行编号）。** Claude 用 user 行 `toolUseResult.structuredPatch`（按 `tool_use_id` 对回那次调用）；Codex 的 unified_diff 自带；Grok 记录里没有行号，用 `anchor`（改完的原文）去当前文件找唯一一处，找不到就不标 —— 不许猜。`anchor` 只在主进程用，`elideOldDiffs` 必须去掉它再发给界面。
60. **用量记录的型号要从回复里拿。** chat-parse 在 assistant 消息上发 `{ type: "model" }`，ChatApp 的 `sessionModels` 记住，记用量时优先用它。选「默认型号」时 modelKey 里没有型号，CLI 的 result 也可能不带，不兜底就会记成空、统计里显示「未知模型」。
61. **偏好里的数组字段（比如 `statsFields`）要在 `app/api/prefs` 的 `cleanPrefs` 里单独放行。** 那里的对象分支会把数组当脏数据丢掉，新加数组偏好不加这一段就永远存不进去。数字写法统一走 `lib/format-count.ts`。
62. **Codex 里「从别的 Agent 导入」的会话（turn_id 是 `external-import-turn-N`），对方的工具调用和输出是带标记的 AgentMessage 文字，必须过 `electron/external-agent.ts` 的 `parseExternalAgentText` 再显示。** 调用变成工具行、输出（`[external_agent_tool_result]`，出错时带 `: error`）丢掉，剩下的才是正文。history.ts（item 路径和老的 message 路径）和 chat-parse.ts 的 agent_message 都要过；原样显示就是满屏命令加 GBK 乱码（0.16.10 修的）。回归在 `scripts/test-agent-history.cjs`。
63. **「接续到新对话」的交接摘要由这条工作正在用的模型写（真实的一轮，续同一个会话），写完开新工作，摘要放进输入框、不自动发送（用户定的）。** 接续关系存在覆盖层 `continuedFrom` / `continuedTo`：新工作一开始是临时编号，发第一条或 Codex 报出会话编号时 `followHandoff` 要把关系补存到 `种类:真实会话编号` 上，查找时两个编号都认，不然重启后两头就断了。等摘要靠 `handoffWaiter` 在这一轮的 done 里兑现，`stopAgent` 必须把它结掉。传给 AgentWorkspace 的回调用 `useLatestCallback`，别写内联箭头函数（会打破 memo，拖慢流式和打字）。 进度面板见约定 67。
64. **左边 Agent 列表的接续链：ChatApp 的 `workChains`（工作 id → 链头 id）传给 Sidebar，Sidebar 按链分组画（`renderWork` + `chainChildren`）。** 链头不在列表里（被隐藏）的就当普通对话；搜索时一律平铺；整组按组内最新活动排；当前工作所在的链自动展开，手动展开 / 收起存 localStorage `allai-chain-collapsed`。别把接续出来的对话在顶层再画一次。
65. **Agent 向用户提问（Claude Code 的 AskUserQuestion）画成卡片；回答发给 CLI，但不许显示成用户的消息。** 工具行上的 `ask` 字段由 `electron/agent-tools.ts` 的 `askFromInput` 解析（history.ts 的 claudeBlocks 和 chat-parse 的 assistant tool_use 两处），界面在 `components/AgentQuestions.tsx`。AllAi 用非交互模式跑 CLI，没人能在终端里答，所以不许只显示一行「问用户」就完事。回答那条开头带 `lib/agent-answer.ts` 的 `ANSWER_MARK`（`electron/remote.ts` 有一份同样的常量），列表、快速跳转、手机同步都把它藏起来，只在卡片里写「你的选择：…」—— 那句话不是用户打的，用户明确不接受以他的名义出现（0.16.13）。没点卡片、自己发了别的消息的算「已继续」。
66. **手机的会话会反复重建，watcher 必须跟着收。** 手机锁屏 / 切后台就断线，回前台是一次重新握手 —— `onHello` 会给同一台手机建一个全新的 `Session`。所以两件事：(a) 清空会话一律走 `clearSessions()`，**不要直接 `sessions.clear()`**，那只丢引用、`agentWatch` 还开着，每切一次后台漏一份，漏多了 Agent 每写一次文件就有一堆解析同时跑，电脑越用越卡；(b) 重新握手要把上一个会话的 `agentWorkId` 接回来并重新 `watchSessionAgent`，否则手机还停在那条工作的界面上，却再也收不到新消息，得退回列表重点一次（0.16.16 修的）。回归：`node scripts/test-remote-sessions.cjs`，用假的 electron / history / live / watch 驱动真实的 `remote.js`，不用中继也不用开窗口。
67. **「接续到新对话」的进度面板挂在 ChatApp 最外层（`components/HandoffPanel.tsx`），不许再塞回 AgentWorkspace 里。** 这件事要跑几十秒到几分钟，用户会切走去看别的工作 —— 挂在工作区里一切走就卸载，关掉之后也没有入口回来（0.16.15 的写法）。配套四条：(a) 顶栏那个按钮在 `handoffBusy` 时是「查看进度」，**不能跟着 `streaming` 一起禁用**，否则关掉面板就再也打不开；(b) 「已运行 N 秒」要面板自己 `setInterval` 走 —— 这一轮是静默的，界面上没有别的东西在变，不自己 tick 就一直停在打开的那一秒；(c) 进度来自真实事件流：`onChat` 里按 `handoffRef.current.sessionId` 分流，**必须放在 `sessionId !== activeWorkId` 那个 return 之前**（用户多半已经切走了），分流之后要 `return`，不然这一轮没有自己的助手气泡，正文会落到**上一轮**那条回复后面把它弄脏；(d) 摘要用 `desktop.loadMessages(那条工作)` 取，不能只信 `agentMessagesRef` —— 那里装的是界面当前这条工作的消息。回归：`scripts/test-handoff-ui.cjs`（假 IPC + 真 preload + 真界面，19 项；跑法在文件头）。
68. **`extraResources` 里的 `node_modules` 会被 electron-builder 过滤掉，要在 `scripts/after-pack.cjs` 里手工补。** `packaging/<名字>/node_modules` → `resources/<名字>/node_modules`，名单在 `NEEDS_MODULES`（standalone、pty-host）。漏了的后果是终端宿主 `require("node-pty")` 失败、一启动就挂，界面上只剩一句「无法联系终端宿主」。**在开发机上永远看不出来**：`dist/win-unpacked/resources/pty-host` 就在仓库里面，require 会一路往上找到仓库自己的 `node_modules` —— 只有别人装的安装包才会废掉（0.16.18 修的）。所以 `check-packaged-runtime.cjs` 的 `checkPtyHost` 必须**先拷到临时目录再启动**，就地跑等于没检查。同理：终端宿主判活要看 `connected` 不是 `killed`，它的 stderr 必须落到 `~/.allai/desktop.log`（`electron/log.ts`），不然崩溃原因一个字都不留。
69. **`child.send()` 的返回值是背压，不是成败，绝不能当失败处理。** 队列攒到约 256KB 就返回 `false`，消息照样送到（实测 500KB/2MB 的帧返回 false，子进程照收，`connected` 一直 true）。真失败只有一个来源：`send(msg, cb)` 的 **cb 收到 error**。这条坑了很久：`list` / `attach` / `kill` 都是小消息永远碰不到，只有 `agent:prompt` 会 —— 它带着整段历史，Claude Code 续上下文时几百 KB，**会话越长越必然**报「无法联系终端宿主」（0.16.19 修的）。同理，别在这里「发不出去就重起宿主再试」：消息其实已经送到了，重试等于把正在干活的宿主杀掉再发一遍。回归：`node scripts/test-pty-bridge.cjs`。
70. **Agent 工作上用户改过的东西一律要进 `agentWorks` 覆盖层，内存里改不算数。** `works` 每次启动都是重新扫各家 CLI 的会话文件得来的，里面的 `model` 是**上一轮 CLI 实际用的**那个，不是用户选的。`changeAgentModel` 以前只改内存 + 记一条时间线提示，于是「选完没发就重启」选择就退回去了（0.16.19 修的：存 `AgentWorkOverride.modelKey`，在 `visibleWorks` 里连 `model` / `endpointId` 一起叠回去）。**存盘要放在写时间线提示之前** —— 那段有个 `if (!from) return;` 的提前返回。回归：`scripts/test-agent-model-persist.cjs`。
71. **prompt 绝不能无脑当命令行参数传给 CLI。** Windows 整条命令行上限 32767 字符，Agent 换会话要重放整段历史，实测一条普通长度的历史就 62121 字符 —— 直接 `spawn ENAMETOOLONG`。三家各有各的入口（都对着本机 `--help` 核过、实跑验证过）：Grok `--prompt-file <文件>`；Claude `-p` **不带参数**时从 stdin 读；Codex `codex exec` **省略 PROMPT 参数**时从 stdin 读 —— **别又给参数又给 stdin**，codex 会把 stdin 当成额外的 `<stdin>` 块追加上去。怎么交 prompt 全在 `buildArgs()` 一处决定（它单独导出就是为了能测）。0.16.20 之前的坑：`long` 判断和 `writePromptFile` 都写了，可 claude 那一支又把文件读回来塞进 argv，codex 压根没管 —— 只有 Grok 是对的。回归：`node scripts/test-cli-args.cjs`。
72. **交接摘要只认这一轮自己的产出，绝不能退回「最后一条 assistant」。** 交接常常要开一条新的 CLI 会话（上下文满了、换了模型），而本地记的 `messagesFile` 要等下次扫描才更新 —— 那几秒读到的是**上一条会话**，最后一条 assistant 是上一轮的普通回复。真出过事：用户拿到的「交接摘要」是一段「改好了，已经打成 0.16.13……晚安，辛苦啦～」。顺序：这一轮的事件流（`handoffReply`）→ 会话文件里**新增**的助手消息（按开始前的 id 集合筛）→ 都没有就报错。回归：`scripts/test-handoff-summary.cjs`。
73. **`mergeAgentWorkLists` 要把扫描结果里的 `source` 接回来。** `sendAgent` 开新 CLI 会话时把工作标成 `source: "new"`，而 CLI 把会话文件写出来之后它就不是新的了。不接这一行它永远停在 "new"，`canResume()` 一直为假，顶栏「复制恢复命令」按钮**开过一次新会话就再也不回来**（换模型、自动压缩、刚接续出来的工作都会中招）。注意：**重命名不会影响这个按钮**，它完全不碰 `cliSessionId` / `source` —— 别被「我一重命名就没了」带偏。回归：`node scripts/test-work-merge.cjs`。
74. **交接那一轮必须续当前 CLI 会话（`sendAgent` 的 `keepSession`），并且带 `HANDOFF_MARK` 标记。** 两件事都踩过坑：(a) 它触发的时机恰恰是上下文快满 —— 也就是 `agentMustCompact` 为真，按常规逻辑会另起一条会话，于是整段历史被重放一遍、磁盘上多一个会话文件、**用户的 Agent 列表里凭空多一条对话**；而这一轮要做的事就是「看着现在这段会话写摘要」，本来就该待在原地。(b) 它是真实的一轮，会落进 CLI 会话文件，所以这条工作以后每开一条新会话，「请写一份交接摘要…」都会被重放进去 —— 看着像凭空跑到别的 Agent 对话里，模型还可能照着再总结一遍。因此 `lib/agent-handoff.ts` 的 `stripHandoffTurns()` 要在**历史重放前**把这一轮连同它写的摘要一起丢掉（摘要已经原样交给新对话了），界面和手机也都按 `isHandoffPrompt()` 藏掉这条。改标记要同时改 `electron/remote.ts` 里那份副本（那边引不到 lib/），和 `ANSWER_MARK` 一样。回归：`scripts/test-handoff-summary.cjs`。
75. **Claude Code 的「在跑没在跑」以它自己的登记表为准，不许再 OR 上按文件时间的猜测。** 登记表是 `~/.claude/sessions/<pid>.json`（`sessionId` + `status: busy/idle`，进程正常退出时删掉），`-p` 非交互模式也会登记（`entrypoint: "sdk-cli"`，实测过）。**没登记 = 没在跑**；`idle` = 在线但没在跑；只有登记表整个读不出来（`claudeRegistryReadable()` 为假）才退回 `looksRunning()` 那个 3 分钟的猜测。以前是「登记 || 猜测」，于是**直接关掉终端窗口后还会显示运行中整整三分钟**（0.16.23 修的）。Grok / Codex 没有登记表，继续按时间猜。约定 9 仍然有效：不扫进程名、不跑 tasklist。回归：`node scripts/test-agent-live.cjs`。
76. **AllAi 自己 spawn 的那一轮，运行状态由 AllAi 自己说了算（ChatApp 的 `localRunning`）。** 扫描是 4 秒一轮，而按下发送的那一刻我们就知道它在跑了 —— `sendAgent` 里 `markRunning(id, true)`，`done` / 起不来 / `stopAgent` 时撤掉，在 `visibleWorks` 里叠到 `running` 上。别改回「等扫描」：那会让绿点慢半拍，用户会以为没发出去。
77. **Claude Code 一轮里只能有一种鉴权。** 官方登录：环境里不许留 `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN`（`childEnv` 先清父进程再按接口写）。全局 Key：第三方只设 Token，官方 Key 只设 API Key，不要两个一起设；并关掉 claude.ai connectors。叠在一起就会在对话里报「connectors are disabled because ANTHROPIC_API_KEY…」（0.16.24）。回归：`node scripts/test-launch-env.cjs`。
78. **同一条 Agent 工作里换的是后端型号，不是换 CLI。** Claude Code 里选 grok-4.6 仍 spawn `claude`，靠 `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_MODEL`（以及 DEFAULT_SONNET/OPUS/HAIKU）和 `--model` 换网关型号，和 CC Switch 一样。不要用型号名推断去 spawn Grok Build。没超新窗口就 `--resume` 当前会话。Base URL 末尾不要带 `/v1`。回归：`node scripts/test-agent-session.cjs`、`node scripts/test-launch-env.cjs`。
79. **同一模型和 CLI 到量压缩：侧栏还是这一条，进度写在当前对话的「压缩上下文」里。** 能续会话时先跑这家自己的 `/compact`（Claude / Grok `/compact`，Codex 也是 `/compact` 但不带参数），再发用户那一句；续不上才退回 AllAi 的 HTTP 摘要。斜杠指令翻译在 `lib/cli-commands.ts`，原样当 prompt，禁止再拼 Skills / 历史（`chat-run` 里以 `/` 开头的 prompt 不走 withHistoryPrompt）。回归：`node scripts/test-cli-commands.cjs`。
80. **Agent 输入框打 `/` 弹出当前 CLI 的指令列表（中文名 + 用法）。** 目录在 `slashCommandCatalog` / `matchSlashCommands`，界面在 `components/SlashCommandMenu.tsx`，只给 Agent 的 Composer 传 `agentKind`。整段还停在 `/指令`（没有空格）才弹；Enter 填入，完整且不用参数的指令再按 Enter 就发出去。键盘弹出的列表不要动画。回归：`node scripts/test-cli-commands.cjs`。
81. **附件（`~/.allai/uploads`）要有人负责回收。** 删创作一直会删掉它生成的图，删聊天对话以前什么都不删 —— 发过的图、聊天里生成的图永远留着，也没有入口能清（实测用户机器上 67 个 4.88MB 全是孤儿，0.16.32 修的）。现在两条路：删对话时删掉它**独占**的，开机再扫一次没人引用的。**引用面有四处，少算一处就会删掉还在显示的图**：消息的 `attachments`、正文和 steps 里的 `/api/uploads/<id>` markdown 链接（聊天里生成的图在这儿，不在 attachments 里）、`studioJobs[].outputs`、`characters[].imageIds`。Agent 不用算：它的附件是复制进 `<cwd>/.allai-files/` 的，消息里不挂 upload。安全阀一条都不能省：**有对话文件读不出来（`complete` 为假）就整轮不做**，24 小时内动过的不碰。回归：`node scripts/test-upload-cleanup.cjs`。
82. **手机网页要跟着桌面一起补，尤其是「不补就走不下去」的那种。** 已经补上的（0.16.33）：Agent 向用户提问的卡片 —— `packAgentMessages` / `remoteAgentMessage` 里 **trace 的 `ask` 必须带过去**，丢了手机上就只剩一行「问用户」，整条工作卡死只能回电脑答；回答文字用 `lib/agent-answer.ts` 的 `answerText()`，桌面和手机共用一份，别各拼各的。斜杠指令菜单复用 `lib/cli-commands.ts`（纯函数，手机能直接 import）。上下文占用走快照里的 `chat.context` / `agent.context`。**电脑离线时整屏换成 `Disconnected`**：以前只挂一条顶栏小字，底下还是上次同步的旧界面，点什么都报错；offline 立刻换，单纯连不上要拖过 4 秒再换（每次重连都先经过 connecting，不然整屏一直跳）。改完手机网页记得 `npm run remote:deploy`，别让用户去跑。回归：`scripts/test-remote-e2e.cjs`（27 项）。
83. **凡是跟着「当前这条 Agent 工作」走的字段，发给手机前都要在 `metaOf()` 里换成这台手机自己打开的那条。** 手机和电脑各看各的（约定 51：只有 `agent.open` 在主进程按手机分开处理），**漏一个就会露馅** —— 电脑上一换对话，手机上那一格跟着变，可手机的消息还停在原来那条。已经踩过三个：`activeId`、`context`（右上角进度条跟着电脑跑）、`modelKey`（显示成电脑那条的型号，而且在手机上换模型会改到电脑那条工作上去）。做法：per-work 的数据放进 `agent.list[]`（`modelKey` / `contextLimit`），`metaOf` 按 `session.agentWorkId` 挑出来替换；占用用这台手机自己那条 watcher 报的 `session.agentContext`。改这类 op（`agent.model` 之类）要带 `threadId`，界面那边照着改**指定的**工作，别用 activeWork。回归：`node scripts/test-remote-sessions.cjs`（9 项）。
84. **本机 Agent 用量靠增量扫各家 CLI 的会话文件（`electron/usage-scan.ts`），不要再在界面里另记一份。** 两边都记会翻倍：界面拿到的是一轮的合计，会话文件里是同一轮每次请求的明细。三家的坑：Claude 取 `type:"assistant"` 的 `message.usage`（`<synthetic>` 那种要跳过）；Codex 取 `token_usage_record`，型号在前面的 `thread_settings_applied` 里，**`input_tokens` 已含缓存读**；Grok 取 `turn_completed.usage`，那是**一轮里所有模型调用的总和** —— 算上下文占用时绝不能用（约定里写死了），但算用量要的正是它，`modelUsage` 还能拆到型号。`~/.allai/*-chat` 下的会话是 AllAi 的官方登录聊天，已经按「聊天」记过账，必须跳过。420MB 文件不可能全读：按字节偏移增量，而且**每个文件的账单独记**（`files[路径].days`），文件被重写/截断时把它自己那份清掉重读就行，不会重复计。几万次请求按「天 × 来源 × 型号」汇总存 `usage-rollups.json`，读的时候由 `lib/usage-rollups.ts` 折成 UsageEvent（49764 次请求只变成 268 条），别塞进只增不删、整份读写的 `usage.json`。回归：`node scripts/test-usage-scan.cjs`。
85. **CC Switch 的历史用量可以导入（`electron/cc-switch.ts`），只读它的库。** 它的账在 `~/.cc-switch/cc-switch.db` 的 `usage_daily_rollups`，`provider_id` 以 `_` 开头的那几条（`_session` / `_codex_session` / `_grok_session` / `_opencode_session`）就是它扫会话文件得来的，占绝大多数（35020 次里 34689 次）；其余 UUID 来自它自己那个本地代理。导入整份替换，重复点不翻倍。**同一天同一来源本机已扫到的以本机为准**，否则两边会重复计。打开库一定要 `readOnly: true`，别动用户还在用的那个应用的数据。
86. **用量的 `input` 一律表示「送进去的全部输入」，缓存读写是其中的明细。** 三家报的口径根本不一样，不统一就是一张表里两种意思，合计（输入+输出）没法看：Anthropic 的 `input_tokens` **不含**缓存（实测 input=2 / cache_read=33849），Codex 和 Grok 的**含**。判别看字段名 `cache_read_input_tokens`（只有 Anthropic 用这个名字，`chat-parse.ts` 里的 `anthropicWire` 就是干这个的）。扫描器和 chat-parse 两条路都要补齐；**CC Switch 导进来的是第三种**（纯新增输入，缓存另算），也要补。算钱时记得先把 cacheRead + cacheWrite 扣掉再按全价算（`lib/model-pricing.ts`）。
87. **Claude Code 会把一次 API 响应的多个内容块拆成多行写进会话文件，每行都带同一份 usage。** 按行累加就把同一次请求算好几遍（实测 11003 行里 5009 行是这种，虚高 1.83 倍）。这些重复行**永远相邻、usage 完全相同**，所以记住上一条的 `requestId` 跳过就够了（`FileState.lastId`，要跨增量批次保留，一组重复行可能正好被读取边界切开）。Codex（`response_id`）和 Grok（`prompt_id`）实测没有重复。
88. **界面文案走 `lib/i18n.ts`，用中文原文当 key。** `const t = useT()` 之后 `t("新对话")`、`t("共 {n} 段", { n })`；没翻的自动回落中文，不会出现空白或 `missing.key`。原文改了就是新 key，漏翻会直接看见。`LangProvider` 挂在 `app/page.tsx` 最外层（标题栏和确认框也能翻）。OptionSelect / ConfirmDialog 会自己翻选项和按钮。手机网页同样包 `LangProvider`，跟系统语言或 `allai-lang`。**下面这些绝对不能进词典，翻了直接弄坏功能**：协议标记（`ANSWER_MARK` / `HANDOFF_MARK`，桌面和手机要逐字一致）、斜杠指令的中文别名（`lib/cli-commands.ts` 里 `压缩`/`清空` 是**输入**不是显示）、存进 db.json 的枚举值、发给模型的提示词。语言存 localStorage（`allai-lang`）不进 prefs —— 首屏那段防闪烁脚本要在读 db 之前就用上。回归：`scripts/test-i18n-ui.cjs`（12 项，含主题和顶栏换行）。
89. **深浅色存的是「模式」不是「颜色」。** `allai-theme` 只会是 `light` / `dark` / `system`；选了 `system` 之后用户在 Windows 里改深浅色要**当场**跟着变，所以真正的深浅每次现算（`resolveTheme`）并订阅 `prefers-color-scheme`。存最终颜色就做不到这一点。老版本只存 light / dark，`readThemeMode` 照旧认。
90. **跑回归时给 dev server 带上 `ALLAI_NO_SUPPLIER_SCAN=1`。** AllAi 每次启动都会扫本机 CLI 配置、把真实中转站和 Key 导进 `db.json`（对用户是省事）—— 拿临时 `ALLAI_DATA_DIR` 跑测试时，这个目录里就白白躺一份真凭据。开关在 `lib/store.ts`。测完把目录删掉。
91. **凡是 `await desktop.xxx()`（IPC），都要接住异常。** preload 里是 `ipcRenderer.invoke`，终端宿主没起来、宿主中途掉线、invoke 超时都会 **reject**，不是返回 `{ok:false}`。0.16.41 修的两处卡死都是漏了这一手，而且位置很阴：
    - 官方登录聊天的 `await desktop.officialChat()` 在 HTTP 那条 `try/finally` **外面**（`official` 分支提前 `return`），一抛就跳过 `finally`，`streamingRef.current` 永远是 true —— 界面一直转圈，之后每次发送都被它挡掉。
    - `sendAgent` 的 `firePrompt()` 干脆没有兜底，`agentStreaming` / `markRunning(true)` 都收不回来，而 `sendAgent` 开头那句 `|| agentStreaming` 会让**这条工作**再也发不出消息。

    两处的共同点：异常路径不会复位「进行中」的标志，用户只能重启软件。报错要走原来的失败分支落进对话流（约定 22），不许弹窗。**写新的 IPC 调用时先问一句：这个 await 抛了会怎样。**
92. **拿到异步结果先对一下还是不是当前那条。** `selectConversation` / `selectWork` 都栽过：点了 A 又马上点 B，A 的结果后到就把界面整块换成 A（侧栏还高亮着 B），连模型和思考档位都被改成 A 的。大对话 / 长会话加载慢的时候很容易撞上。做法是用一个 ref 记住最近一次点的是哪个 id，`await` 之后先比一次，不是它就丢掉。凡是「点一下 → 异步拉数据 → 整体 setState」的路径都要这么对一次。
93. **认模型牌子只有 `lib/brand.ts` 一份规则，别在别处再抄一份。** 抄一份的下场是两边会漂移：0.16.42 之前 `components/BrandMarks.tsx` 里有个 `brandOfModel`，`lib/brand.ts` 修了 `xai` 的误伤它没修，结果 `MiniMaxAI/MiniMax-M2` 因为 "mini**maxai**" 含 `xai`，在模型切换条上被画成 **Grok 的 logo**。现在 `BrandMarks` 只管「怎么画」（`BrandGlyph`：有矢量图用矢量图，其余画品牌色块），认不认得出全问 `brandFor()`。**规则表的顺序有意义**：越具体的越靠前（`nvidia` 在 `llama` 前、`gpt`/`^o[134]` 在最后）。认不出的牌子**宁可留白也别硬画**。
94. **抓站点图标：根路径 favicon 并行先抓，页面 `<link rel="icon">` 同时开。** 国内站点（硅基流动 / 智谱 / 火山方舟 / 阿里百炼）常把图标写在 `<link>` 或 CDN 上。**不要拿接口路径（`/v1`）当网页读**，去 origin；`api.x.ai` 顺带试 `x.ai`。超时 2–2.5 秒，谁先到用谁。错误信息只提用户填的那个域名。`ProviderIconField` 必须 `key={ownerId}`，切提供商要拆掉整棵，抓到一半 abort，禁止把结果写到当前那条。
95. **模型图标和供应商图标是两回事。** 模型名前面只看「这只模型自己配的 → 这一家厂商」
   （`iconFor` / `ModelIcon`）。供应商自己的图只出现在那条服务上（`serviceIcon` /
   `ServiceIcon`），**不要盖到旗下模型上** —— 聚合站上 DeepSeek / 通义 / GPT 还是各画各的。
   key 仍是 `provider:<id>`。抓图时丢掉过小或空的图（1×1、空 SVG），同一波里挑最大的。
96. **翻译只翻「显示」，不翻「数据」，更不翻发给模型的东西。** 词典用中文原文当 key，
   没翻的自动回落中文，所以界面不会出现空白。这三条绝对不能进词典（翻了会直接弄坏功能）：
   协议标记、斜杠指令的中文别名（`lib/cli-commands.ts` 里 `压缩`/`清空` 是**输入**不是显示）、
   发给模型的提示词（操控电脑那一整套、`lib/chat-context.ts` 的历史包装）。
   `AgentTrace.tsx` 里 `读`/`写`/`改`/`删` 那些单字是用来**匹配**工具名的，翻了就匹配不上。
   预设模板（`lib/templates.ts`）的名称在**应用模板的那一刻**按当前语言写进表单 ——
   那是存进 db 的用户数据，之后就不再跟着界面语言变。
97. **界面上拼出来的中文要先拆成「模板 + 变量」再翻。** `` `${limit.note}（估算）` `` 这种写法
   拼出来的是个全新字符串，词典里永远对不上。改成 `t("{note}（估算）", { note: t(limit.note) })`
   这样两层：模板能翻，里面那段（数据表里的中文）也单独翻一次。
   `lib/context-window.ts` 的 `compactNotice` 就是照这个拆的（`COMPACT_NOTICE` + `compactNoticeVars`），
   服务端不知道界面语言，直接调 `compactNotice()` 拿中文；界面调 `t(COMPACT_NOTICE, vars)`。
   同理，新增带变量的文案时**别把数字拼进模板**。

---

## 目录

| 路径 | 用途 |
|------|------|
| `app/page.tsx` | 入口，挂 `LangProvider` + `ConfirmProvider` + `TitleBar` + `ChatApp` |
| `components/I18n.tsx` | 界面语言上下文：`useT()` / `LangProvider`，挂在 page 最外层 |
| `lib/i18n.ts` | 中文原文当 key 的词典；语言存 `allai-lang` |
| `components/ChatApp.tsx` | 聊天/Agent/创作总控，发送分支 |
| `components/SettingsDialog.tsx` | 设置外壳 + 标签页（通用/聊天/Agent/生图/Skills/用量） |
| `components/AgentSettingsDialog.tsx` | 单个 Agent 的接口/登录/同步模型 |
| `components/GlobalEndpoints.tsx` | 全局提供商池的编辑界面（`/api/agent-endpoints`） |
| `components/TitleBar.tsx` | 自己的标题栏（窗口是 `frame: false`） |
| `components/SearchPalette.tsx` | Ctrl+K 全局搜索，跳到聊天 / Agent / 创作 |
| `lib/search.ts` / `app/api/search/route.ts` | 搜聊天正文和创作提示词 |
| `electron/notify.ts` | Agent 做完、额度到点的 Windows 通知 |
| `components/VideoPlayer.tsx` | 自己的视频播放器，创作和放大预览都用它 |
| `components/UsageHeatmap.tsx` | 用量热力图，跨度年/季/月 |
| `lib/official-chat.ts` | 官方登录聊天（Claude / Grok / ChatGPT 账号）的 id、型号、判断函数 |
| `lib/conversations.ts` | 对话按文件存取 + index |
| `scripts/test-upload-cleanup.cjs` | 附件回收：独占才删、扫不全不删 |
| `electron/official-models.json` | 官方型号兜底表，**三处共用，只改这一份** |
| `lib/usage.ts` / `lib/usage-store.ts` | 用量：纯汇总 / 落盘。界面只能引前者 |
| `electron/usage-scan.ts` | 扫本机所有 CLI 会话文件的用量（增量） |
| `electron/cc-switch.ts` | 导入 CC Switch 的历史用量（只读它的库） |
| `lib/usage-rollups.ts` | 日汇总 → 统计页认识的事件；定价在 lib/model-pricing.ts |
| `lib/agent-resume.ts` | 各家 CLI 的恢复会话命令 |
| `lib/chat-context.ts` | **换模型时的上下文**：交接 = 压缩，走 lib/compact.ts |
| `lib/context-window.ts` | 模型上限表 + token 估算 + 压缩纯函数。**纯函数，界面也引** |
| `lib/compact.ts` | 压缩本体（要读 db、发请求）。**服务端专用，界面不许引** |
| `components/ContextSettings.tsx` | 自动压缩开关 / 阈值 / 模型上限覆盖 |
| `scripts/check-client-imports.cjs` | 防客户端组件引服务端模块，挂在 build 前 |
| `app/api/context/` | 通用上下文组装，聊天 / Agent / 创作共用 |
| `app/api/chat/route.ts` | HTTP 聊天主路径：压缩 → 拼 payload → SSE |
| `app/api/agent-endpoints/` | 全局提供商池的读写（含 `/models` 同步） |
| `lib/agent-endpoints.ts` | `withGlobalEndpoints()`：全局池并进单个 Agent |
| `components/AgentWorkspace.tsx` | Agent 主界面：消息、trace、输入框 |
| `components/HandoffPanel.tsx` | 「接续到新对话」的进度面板，ChatApp 顶层渲染 |
| `lib/agent-handoff.ts` | 交接那一轮的标记；重放历史前整轮剔掉 |
| `components/Composer.tsx` | 输入框（附件、拖拽、联网/管理员/操控电脑/推理/权限开关） |
| `electron/admin.ts` | 主进程拉起提权 CLI 宿主 |
| `electron/admin-host.ts` | 提权后的 CLI 宿主，连回 AllAi 开的管道（extraResources 真实文件） |
| `electron/admin-client.ts` | pty-host 经 named pipe 把 CLI 交给宿主 |
| `electron/db.ts` | 运行器读 db（**独立一份类型**，rootDir 限制导致不能引 lib/） |
| `electron/watch.ts` | 盯住当前工作的会话文件，实时把新消息推给界面 |
| `components/ConfirmDialog.tsx` | 自己的确认弹窗，**不许再用 window.confirm** |
| `electron/agent-tools.ts` | **工具调用翻译成人话**，三家共用。放 electron/ 是 rootDir 限制 |
| `components/UsageStats.tsx` | 设置里的「使用统计」页，折线图是手写 SVG |
| `components/StatsBar.tsx` | 输入框下面那行调试信息 |
| `components/GeneralSettings.tsx` | 设置 →「通用」：统计行、联网、模型图标 |
| `lib/studio.ts` | 创作对话的标题、预览、旧 job 迁到 conversation |
| `lib/brand.ts` | **认牌子唯一的规则表**（28 家）：`brandFromModel` / `brandFromHost` / `brandFor` / `iconFor`，外加品牌色 `BRAND_COLOR` 和缩写 `BRAND_SHORT`。**别在别处再抄一份规则** |
| `components/BrandMarks.tsx` | `BrandMark`（Anthropic / xAI / OpenAI 三家的矢量图）+ `BrandMonogram`（其余牌子画品牌色块）+ `BrandGlyph`（二选一）。`ModelIcon` 和 `ModelSwitch` 都走 `BrandGlyph` |
| `components/ModelIcon.tsx` | 模型名前面的图标：用户配的图 → 矢量图 → 品牌色块 → 留白 |
| `app/api/brand-icon/` | 填域名/图片网址抓图标存成 data URI。**先读页面 `<link rel="icon">`**，再试标准路径，最后第三方服务 |
| `components/BrandIconSettings.tsx` | 设置 →「通用」→ 模型图标：按牌子/模型 id 配图，支持粘贴网址自动抓 |
| `lib/responses-api.ts` | `/v1/responses`（联网搜索走这条），事件名是抓真实响应得来的 |
| `components/MessageList.tsx` | 聊天气泡 + `steps`（联网/报错显示在对话里） |
| `components/ModelSwitch.tsx` | 换模型提示：`型号 · 来源 → 型号 · 来源`。当时就写入时间线 |
| `components/Studio.tsx` | 创作主界面 |
| `components/MediaViewer.tsx` | 创作图/视频放大、下载、复制、参考 |
| `electron/quota.ts` | 官方 5h/7d/重置次数，curl 本机令牌 |
| `lib/imagine.ts` | 生图/视频 HTTP，取消和错误原文 |
| `electron/history.ts` | 扫各家 CLI 的会话、读消息、删会话 |
| `app/api/agent-files/` | 把附件复制进 Agent 工作目录 |
| `lib/scan-suppliers.ts` | 启动扫描本机 CLI 配置；**禁止改已有模型列表** |
| `lib/models.ts` | chat / image / video 分类 |
| `lib/reasoning.ts` | 思考档位 |
| `lib/permission-mode.ts` | Agent 权限模式（Claude / Grok / Codex 各一套） |
| `lib/store.ts` | `~/.allai/db.json` |
| `electron/pty-host.ts` | 终端宿主，所有 CLI 调用 |
| `electron/log.ts` | `~/.allai/desktop.log`：路径、ALLAI_DATA_DIR、4MB 轮转 |
| `electron/cli-auth.ts` | 官方登录状态/登录/退出/拉模型 |
| `electron/chat-run.ts` | Agent 一轮 + 官方登录聊天的 print 模式（三家的参数都在这） |
| `electron/detect.ts` | 找 CLI，`cliInvocation` 处理 `.cmd` |
| `types/desktop.d.ts` | preload 暴露的桌面 API |
| `lib/format-count.ts` | 数字写法：简略 2.6K / 精确 2,614 / 中文 ≈32 亿，统计页、热力图、统计行共用 |
| `components/AgentQuestions.tsx` | Agent 向用户提问的卡片（AskUserQuestion），回答作为下一条消息发出去 |
| `components/TurnRail.tsx` | 长对话左侧快速跳转（聊天 / Agent / 创作共用，目标元素标 `data-turn`） |
| `components/useStickToBottom.ts` | 消息列表滚动：打开 / 换对话到最新，往上翻不打扰（桌面和手机共用） |
| `components/FileChanges.tsx` | Agent 回复下面「改了哪些文件 +N −M」和展开的差异 |
| `electron/diff.ts` | 从三家会话记录里解析改文件的差异，`elideOldDiffs` 控制体积 |
| `electron/cli-update.ts` / `components/AboutSettings.tsx` | 设置 → 关于：本机 CLI 列表、手动 / 启动自动更新 |
| `electron/remote.ts` | 远程控制（电脑端），见「远程控制」一节 |
| `components/useRemoteControl.ts` | 远程控制（界面侧） |
| `mobile/` / `relay/` | 手机网页 / 中继（`npm run remote:build`） |
| `mobile/Questions.tsx` | 手机上的 Agent 提问卡片 |
| `scripts/test-remote-sessions.cjs` | 远程会话生命周期回归（watcher 不泄漏、重连接回 Agent） |
| `scripts/test-handoff-ui.cjs` | 「接续到新对话」进度面板的界面回归 |
| `scripts/test-pty-bridge.cjs` | 终端宿主 IPC：背压不算失败 |
| `scripts/test-cli-args.cjs` | 三家 CLI 的 prompt 入口，长 prompt 不进 argv |
| `scripts/test-handoff-summary.cjs` | 交接摘要来自这一轮，不是上一轮的回复 |
| `scripts/test-work-merge.cjs` | 扫描合并保住 `source`，恢复命令按钮不丢 |
| `scripts/test-agent-live.cjs` | Claude 判活：登记表为准，关掉终端就不再是运行中 |
| `scripts/test-agent-model-persist.cjs` | Agent 选的模型重启后还在 |

IPC 名字在 `electron/preload.ts` / `electron/main.ts` / `electron/pty.ts`。加能力三处一起改。

---

## 已知坑

- **认牌子的规则只能有一份（`lib/brand.ts`）。** 0.16.42 之前 `components/BrandMarks.tsx`
  里另抄了一份 `brandOfModel`，两套规则各走各的：`lib/brand.ts` 修了 `xai` 的误伤、
  它没修，于是 `MiniMaxAI/MiniMax-M2` 因为 "mini**maxai**" 里含 `xai`，
  在模型切换条上被画成 **Grok 的 logo**。**改了认牌规则，记得两边一起改 —— 或者干脆只有一边。**
  现在只有 `lib/brand.ts` 一份，`BrandMarks` 只负责「怎么画」。
  规则表里**顺序有意义**（越具体越靠前）：`nvidia` 必须排在 `llama` 前面
  （Nemotron 是 Llama 改的），`gpt` / `^o[134]` 必须排最后（别抢 `gpt-oss` 这种社区模型）。
- **`\bxai\b` 的 `\b` 不能省。** 裸 `xai` 会命中任何含 "maxai" 的 id。
- **别用裸 `seed` 认字节。** `seed-1.6` 这类会被误伤，只认 `seed-oss` / `doubao` / `skylark`。
  `^yi[-_]` 也必须锚开头，不然 `qinyi` / `zhanyi` 会被判成零一万物。
- **抓图标别只试 `/favicon.ico`。** 国内站点（硅基流动 / 智谱 / 火山方舟 / 阿里百炼）基本
  把图标声明在 `<link rel="icon">` 里、还常挂 CDN，只试标准路径要么 404 要么抓到糊图。
- **别把第三方服务的 host 写进错误信息。** 以前兜底用 Google 的 `s2/favicons`，
  墙内必超时（10s），最后报「www.google.com 连不上」—— 用户填的是 `qianfan.baidubce.com`，
  完全看不懂。现在错误只提用户填的域名，且兜底服务只给 4 秒。
- **打包**：`dist/win-unpacked` 若被 AllAi.exe 锁住会 `EBUSY`，先杀进程。
- **Next 16**：以 `node_modules/next/dist/docs/` 为准，不要按旧 Next 习惯改。
- **同一中转地址**：OpenAI 和 SpaceXAI 可能指向同一 host。扫描曾把 Grok 模型写进第一个服务；0.4.18 后不再写。
- **第三方 `/v1/models`**：有的网关返回全站模型，不等于当前分组能用。用户主动点「从接口同步」仍会看到网关全集 —— 那是用户主动要的，同步后要确认再保存。自动回填已经不会覆盖用户维护的列表（0.4.20）。
- **db.json 写放大**：仍然是整份读+整份写，但对话已经搬出去了，剩下的内容很小。
- **`electron/history.ts`**：列表只读文件头（mtime+size 缓存）。打开一条会话读全文，不要只读末尾，Grok 的 updates.jsonl 很大，截断会丢开头。
- **ChatGPT 两条路**：「ChatGPT 账号」走本机 codex（AllAi 自己的界面）；「ChatGPT 网页版」是 Electron 的 `WebContentsView` 盖在窗口上 —— 那是原生层，永远画在 DOM 之上，所以打开下拉菜单时必须先把它藏起来，这个没法用 CSS 解决。
- **语音输入已经拿掉**（0.9.14）。`Composer` 没有麦克风；`/api/transcribe` 已删。`prefs.speechModelKey` / `voiceInput` 还留在类型里是为了旧 `db.json` 能读，不要再把按钮加回去。
- **额度请求**：Windows 用 `curl.exe`。空 grpc-web 是 5 字节 `[0,0,0,0,0]`。临时文件名必须带随机后缀，Grok 的 credits 和 resets 会并行打。
- **用量口径**：合计 = 输入 + 输出。缓存读的 token 本身算在输入里，不重复计。第三方网关要开 `stream_options.include_usage` 才会回 usage，已经默认带上；个别网关可能不认这个字段，那种就统计不到。
- **幽灵对话**：Claude 请求失败则没有 session，禁止用对话 UUID resume（0.4.16）。
- **git**：仓库目前几乎只有 Initial commit，历史版本看 `CHANGELOG.md` 和 `dist/AllAi-Setup-*.exe`。

**0.16.41 审查发现、这一轮没动（按值得动手的程度排）：**

- **`electron/usage-scan.ts` 的增量偏移只靠「文件变小」判断重写。** 现在只有
  `stat.size < state.offset` 才复位。会话文件被**截断后重写成更大或等大**时偏移不复位，
  于是从半行垃圾开始解析，这段用量静默丢掉或错位重记，之后一直对不上。
  要修得加内容校验（比如记文件头 512 字节的哈希），但**误判的代价是重复计数**，
  比丢数据更难发现，所以没动。动手前先想清楚怎么判「真重写」。
- **`usage.json` 只增不删、整份读写。** 约定 25 是用户明确要长期看，不能自动清；
  但每记一条都要读+写整个文件，用上几年（几万条）之后会明显拖慢每轮消息的收尾。
  真要治得按月分文件，或走 `usage-rollups.json` 那种汇总。现在还没到痛的时候。
- **`electron/pty-host.ts` 的 `sessions` 也只增不删。** 终端退出后只把 status 改成 `exited`，
  LiveSession 连同 buffer 一直留着（`chats` 这次已经修了）。数量取决于手动开了多少终端，
  比 `chats` 慢得多。没动是因为界面还要显示「已退出」和退出码，得先定好它什么时候允许消失。
- **Agent 工作区的 memo 其实是失效的。** `reasoningOptions` / `agentPermissionOptions`
  每次渲染都新建、`onDraft` 是内联箭头函数，全都传给了 `memo(AgentWorkspace)`，
  所以流式每个 token 都会重渲染整棵 Agent 子树。约定 38 的底线在聊天那边守住了，Agent 这边漏了。
  要修得改成 `useMemo` / `useLatestCallback`。**没实测到卡顿就没动** —— 按「性能」那节量过再改。
- **盯 Agent 文件的 useEffect，deps 里不含 `workOverrides`。** 回调读的是挂载那一刻的值，
  工作运行中改了模型之后，文件回读不会再打模型切换标记。只影响显示，不影响功能。

---

- **杀进程别按名字、也别让匹配条件匹配到自己。** 永远别 `taskkill /IM node.exe`（会杀掉用户正在用的 AllAi 本机服务）。
  按命令行找 dev server 时要限定 `Name = 'node.exe'` 并排除 `$PID` —— 有一次按 `*--port 4672*` 匹配，
  把执行这条命令的 PowerShell 自己也匹配上了，`/T` 连带杀掉自己，后面的清理和打包都没跑。
- **测远程控制的隔离实例**：dev server 启动时会把用户本机 CLI 配置里的真实中转站和 Key 导进临时数据目录，
  测完一定删掉那个目录（`$TEMP/remote-e2e`）。端到端脚本 `scripts/test-remote-e2e.cjs` 用的是本机假网关，不花钱。
- **截图偶尔报 `UnknownVizError`**（Electron `capturePage`），和功能无关，测试脚本里截图失败已经不会中断。
- **Git Bash 里的 `tar` 是 GNU tar**，会把 `C:\...` 的冒号当远程主机；部署脚本已固定用 `System32\tar.exe`。

## 用户环境备忘

- Windows + PowerShell。
- 自己有一台 Linux 服务器（Ubuntu/Debian），装了 1Panel（占 80/443），反向代理和 HTTPS 用户自己在 1Panel 里配。
  远程控制中继跑在上面的 Docker 里（127.0.0.1:30778）。用户手机是 iPhone，把手机网页加到主屏幕当 App 用。
- 已登录：Claude Code、Codex（ChatGPT）、Grok OAuth。
- 聊天里除 Claude 账号外，OpenAI / SpaceXAI 接的是同一第三方兼容接口，不是官方 xAI。该接口分组里没有 grok-4.6 时，切 Grok 会 404，这是接口本身，不是 Claude Code 把请求吃掉。
- Claude 官方聊天：设置 → 聊天模型 → 添加服务 → Claude 账号 → 登录 → 保存。

---

## 下一轮可以从这里接着

当前发版 **0.16.47**，安装包 `dist/AllAi-Setup-0.16.47.exe`，桌面快捷方式已更新。
没有排期，按用户下一句话走。
接手时先读本文件 + `CHANGELOG.md` 最近几条，再读对应源码。Next 16 以 `node_modules/next/dist/docs/` 为准。

**最近刚做完（0.16.47）：** 预设图标（`public/brand/presets/` + `lib/preset-icons.ts` 打分匹配）；思考过程不再自动合上；主界面去掉重复版本号；启动画面跟日夜间；Agent 接口模型列表可折叠。

**更早（0.16.46）：** 供应商图标不盖旗下模型；抓图丢掉空白小图。模型走 `ModelIcon`，服务走 `ServiceIcon`。

**更早（0.16.45）：** 抓图标并行、切提供商不串状态；「模型图标」里的接口组已删。`ProviderIconField` 必须 `key={ownerId}`，抓到一半要 abort。

**更早（0.16.44）：** 添加聊天服务 / Agent 接口时在本条设置里配图标。组件 `components/ProviderIconField.tsx`，仍走 `/api/brand-icon` 和 `provider:<id>`。

**更早（0.16.42）：认国内模型 + 图标导入。** 用户原话：「对国外大模型识别能力很强，
但是对国内的模型和国内的聚合平台导出来的模型识别能力很差」+「用户只需要输入网址或者导入图片，
软件自动识别网站的 icon」。四件事：
① `lib/brand.ts` 从 13 家扩到 **28 家**（补了 DeepSeek / 通义 / Kimi / 智谱 / 豆包 / 混元 /
文心 / 星火 / MiniMax / 阶跃 / 零一万物 / 百川 / 书生 / 商汤 / 昆仑万维 / LongCat + 三个聚合平台）；
② 认 HuggingFace 风格 id（`deepseek-ai/DeepSeek-R1`、`zai-org/GLM-4.6`）；
③ 新增 `BrandMonogram`，认得出但没矢量图的牌子画「品牌色 + 缩写」色块；
④ `app/api/brand-icon` 改成先读页面 `<link rel="icon">`。
顺带**修掉两个真 bug**：`MiniMaxAI/MiniMax-M2` 被认成 xAI（`BrandMarks.tsx` 里另抄了一份规则，
已删，见「已知坑」第一条）、`nvidia/…nemotron` 被认成 Meta。
验证方式：临时脚本跑了 **83 条**认牌子用例（全过）+ **15 个真实国内 AI 站点**抓图标（13 个成功），
跑完即删；失败路径耗时从 ~14s 降到 ~5s。细节见 `CHANGELOG.md` 的 0.16.42。

**最近刚做完（0.16.43）：英文翻译补完 + 接口图标 + 几处界面文案。** 五件事：
① 英文词典 900 → **1004 条**，Model limits 的小字、Model icons 整页、**预设内容**（模板名按当前语言
写进表单）、确认框/通知/导出 CSV 表头这些漏网的都翻了（约定 96：只翻显示，不翻数据和提示词）；
② 拼出来的中文拆成「模板 + 变量」再翻，`compactNotice` 拆成 `COMPACT_NOTICE` + `compactNoticeVars`
（约定 97）；③ 图标查找改成**单个模型 → 接口 → 厂商**，设置里多一组「接口」图标（约定 95）；
④ 生图模型下拉、`使用统计 → 按模型` 都补上了模型图标；⑤ 英文下 Agent 输入框的推理/权限下拉
只显示档位名，发送按钮不再被挤到下一行；聊天空状态改画当前模型的图标。
验证：`check-client-imports` + 两套 tsc + eslint + `next build` 全过，临时脚本 25 条用例
（认牌子回归 14 条 + 图标优先级 5 条 + 压缩提示 3 条 + 词典完整性 3 条）全过，跑完即删。

**0.16.41 这个包是怎么来的（留个教训）：** 7 处改动全部改完，两套 tsc + eslint +
`check-client-imports` + 13 个回归脚本全过；但 `npm run dist` **一次都没跑到头** ——
前几次卡在七八分钟被环境的删除护栏打断，最后两次是用户嫌慢叫停。
最后一次 shell 被杀后，electron-builder 的残留进程把 NSIS 包打完了（21:53，228MB）。
补跑 `scripts/check-packaged-runtime.cjs` 四项全 PASS（Electron 运行时能加载首页/服务/偏好、
操控电脑宿主 DPI+UIA 正常、提权宿主能 spawn、终端宿主在仓库外能起来并应答 IPC），
`make-shortcut.cjs` 已更新桌面快捷方式。**所以包是可用的。**

但它是**没走完整条 `npm run dist`** 的产物：**如果下一轮动了 `packaging/`、`electron/`
的运行时部分或打包配置，别偷懒，按「怎么跑」那四步老老实实重打一次。**
好消息是那两个收尾脚本很快：`check-packaged-runtime` + `make-shortcut` 一共约 7 秒，
可以单独补跑，不用为了它们重打整个包。

**再上一轮（0.16.41）：** 接手后的第一轮审查。改的全是**异常路径和资源清理** ——
正常用时看不见，但踩上就是「卡死」或「越用越卡」。五处：
① 官方登录聊天和 Agent 的 IPC 调用没有兜底，一抛异常界面就永久停在「进行中」，
这条工作再也发不出消息（约定 91）；② 快速切换对话 / 工作时旧结果覆盖新内容（约定 92）；
③ `electron/watch.ts` 建到一半失败漏关 `fs.watch`；④ 终端宿主 `chats` 只增不删；
⑤ 远程 `onRelay` / `handleRpc` 没有 catch。细节见 `CHANGELOG.md` 的 0.16.41。
**审查时还发现、但这一轮没动的两条**（都写在「已知坑」里了，接手时可以先从这两个下手）。

**再上一轮（0.16.40）：** 英文界面覆盖设置各页、确认框、统计、创作、远程和手机网页。见约定 88。发给模型的提示词和斜杠中文别名仍不进词典。

**更早（0.16.39）：** 补充英文词典；主界面左下角主题开关改到设置 → 通用。

**更早（0.16.38）：** 界面中英切换 + 深浅色三档（日间/夜间/跟随系统）+ Agent 顶栏窄窗口整组换行。见约定 88、89。

**更早（0.16.31）：** Agent 输入框打 `/` 弹出当前 CLI 的指令列表（中文名 + 用法）。见约定 80。`node scripts/test-cli-commands.cjs`。

**更早（0.16.30）：** Agent 斜杠指令按 Claude / Grok / Codex 各自语法翻译；到量压缩优先用 CLI 自己的 `/compact`。见约定 79。`node scripts/test-cli-commands.cjs`。

**更早（0.16.29）：** 同一模型和 CLI 到量压缩留在当前对话，并实时显示压缩进度。见约定 79。

**更早（0.16.28）：** Claude Code 工作里选 Grok 4.6 仍跑 Claude Code，只换网关和 ANTHROPIC_MODEL（CC Switch 同款）。见约定 78。

**更早（0.16.27）：** 换模型不再自动开新对话；没超新窗口就留在当前条。见约定 78。

**更早（0.16.26）：** 在 Claude Code 工作里选 Grok 4.6 会真正开 Grok Build 会话，不再给 claude 传 `--model grok-4.6` 落到 Opus 5。见约定 78。`node scripts/test-agent-session.cjs`。

**更早（0.16.25）：** Agent 换模型会开新会话（Claude Code 的 `--resume` 不换型号）；切到更小窗口按新模型压上下文，避免 Grok 自己另开一条。见约定 78。`node scripts/test-agent-session.cjs`。

**更早（0.16.24）：** Claude Code 从官方账号切到全局 Key 不再把 claude.ai connectors 冲突警告写进对话。见约定 77。`node scripts/test-launch-env.cjs`。手机网页没改。

**✅ 已完成（0.16.12，用户 2026-09-11 晚提的两项，下面是当时的方案，实现和它一致）：**

1. **左边 Agent 列表显示「接续」关系**（依附于主对话）。
   - 数据已经有了：覆盖层 `continuedFrom` / `continuedTo`（`lib/types.ts` 的 `AgentWorkOverride`），
     值是工作 id 或 `种类:会话编号`，ChatApp 里 `workByKey()` 两种都认（见约定 63）。
   - 设计：一条接续链画成一组 —— 链头（最早那条）是主对话照常显示；接续出来的排在它下面，缩进 + 左边一条竖线，
     每条前面标「↳ 接续 1 / 接续 2」；接续的接续拉平到同一组，按创建先后排。整组在列表里按组内最新活动排序。
     主对话右边「共 N 段」+ 折叠箭头；当前打开的工作所在的组自动展开，其它组默认收起；折叠状态存 localStorage。
   - 改哪里：ChatApp 算出 `workParent: Record<workId, 链头 workId>`（只用 visibleWorks 里找得到的，找不到就当普通对话）传给
     `components/Sidebar.tsx`；Sidebar 里 Agent 工作列表那段（`work.running ? ...` 附近，约 405–440 行）按组渲染。
     传给 Sidebar 的东西要稳定（useMemo），别拖慢流式。

2. **Claude Code 的 AskUserQuestion（Agent 向用户提问）适配。**
   - 现状：AllAi 用 `-p` 非交互模式跑 CLI，这个工具在界面上只是一行「问用户」（`electron/agent-tools.ts` 里 `askuserquestion` 的 detail 是空的），
     问题和选项都看不见。
   - 设计：tool 类 trace 上加 `ask` 字段（`{ questions: { question, header?, multiSelect?, options: { label, description? }[] }[] }`），
     在 `electron/history.ts` 的 `claudeBlocks` 和 `electron/chat-parse.ts` 的 assistant tool_use 两处解析；类型改三处：
     `electron/history.ts`、`electron/chat-parse.ts`（ChatEvent 的 tool）、`lib/types.ts` + `types/desktop.d.ts`。
     界面 `components/AgentWorkspace.tsx` 的 AgentBubble：这一条是最后一条回复、不在流式时，在回复下面画「提问卡片」
     （标题 chip + 问题 + 选项按钮，多选可勾多个 + 确定，另有「其它…」自己填）；点了就把回答当下一条消息发出去
     （ChatApp 里走 `sendAgent({ text, attachments: [], caps: { followPermission: true, allowAdmin: true } })`，续同一个会话）。
     后面已经有用户消息的卡片显示成「已回答」灰色状态。
   - 手机网页暂不做；Codex / Grok 以后有同类工具按同一个 `ask` 字段接。

每做完一项：`npx tsc --noEmit -p tsconfig.json` + `npx tsc --noEmit -p electron/tsconfig.json` + `npx eslint components lib electron/...`，
用隔离 dev server + Electron 探针验证（参考 scratchpad 里 ui-handoff.js 的写法：假 IPC，`agent:messages` 返回带 `ask` 的消息），
然后版本号 +1、写 CHANGELOG、把上面这段改成「已完成」、`npm run dist`。测完删掉临时数据目录（启动时会把用户的真实 Key 导进去）。

**最近刚做完（0.16.13）：** 回答 Agent 提问不再显示成用户自己的消息（带标记发给 CLI，界面只在卡片里写「你的选择」），见约定 65。手机网页和中继没动。

**0.16.12：** 左边 Agent 列表把接续链画成一组（主对话 +「接续 1 / 2」缩进挂在下面，可折叠）；Claude Code 的提问画成卡片、回答作为下一条消息发出去。见约定 64–65。手机网页和中继没动。

**0.16.11：** Agent「接续到新对话」：当前模型写交接摘要 → 开新工作 → 摘要放进输入框不发送；两条工作互相链接、重启不丢；上下文快满时提醒。见约定 63。手机网页和中继没动。

**0.16.10：** 修 Codex 里从别的 Agent 导入的会话显示成一堆乱码（带标记的工具调用 / 输出被当成正文），见约定 62。手机网页和中继没动，不用 `remote:deploy`。

**0.16.9：** 修设置里切到「远程」闪一下（对话框固定高度）；使用统计「简略 / 精确」数字；「未知模型」查实是 claude-sonnet-5 并补上记录、以后从回复里读型号；统计行加缓存命中率 / 输入输出 / 模型来源并可自选显示项；去掉创作台两个模型设置；Agent 差异带行号；聊天空白页「XX 愿意为您提供帮助」和对话开头「使用 XX 开始对话」。手机网页和中继没动，不用 `remote:deploy`。

**0.16.8：** 长对话左侧快速跳转（三个专区）；Agent 历史显示改了哪些文件和差异；Claude 在线状态改读 `~/.claude/sessions/<pid>.json`；打开对话直接到最新（手机 + 桌面）；设置里「模型与接口」二级菜单和「关于」（CLI 列表、手动 / 启动自动更新）；副标题「高效地与AI工作」。手机网页已 `remote:deploy`。
Codex 边跑边看不到差异（`codex exec --json` 的流里只有文件名），这一轮结束后从会话文件读回来才有。

**0.16.7：** 全局搜索（Ctrl+K）、Agent 做完 / 额度 80%·90% 的 Windows 通知、手机各自盯不同的 Agent 工作。建议 3「固定项目上下文」没做。手机网页没改，不用 `remote:deploy`。

**更早（0.16.6）：** 打字卡顿真正量出来了：`tasklist` 同步扫描 430ms+（已去掉），
输入框不再每键抬到 ChatApp。扫描 440ms → 12ms。

**更早（0.16.5）：** Agent / 创作打字卡顿：消息列表 memo、远程快照不再跟输入框重算、scanWorks 无变化不重渲染。`node scripts/test-typing-isolation.cjs`。

**更早（0.16.4）：** 手机网页补联网/推理/权限、列表改名删除、抽屉和进出对话动画。电脑端加了对应远程操作（`prefs.patch`、`chat/agent.rename|delete`、`studio.rename|delete`）。需 `npm run dist` 和 `npm run remote:deploy`。

**更早（0.16.3）：** Codex 同一会话多个 rollout 文件合并成一条历史；盯目录里新写的文件；运行中同时看 sqlite recency。回归：`node scripts/test-agent-history.cjs`。

**更早（0.16.2）：**
- Remote Control 手机网页重新整理了视觉基底：渐变背景、面板层次、触控反馈；移动端只挂载当前 Tab，避免聊天、Agent、创作三个大型面板同时渲染。
- 手机端远程导航与电脑端视图解耦：手机打开聊天、Agent、创作不会强制切换电脑当前专区。
- 修复 Agent 远程同步回归：手机切换 Agent 工作后，即使电脑停留在聊天或创作页面，桌面端仍继续监听该工作会话文件，消息和运行状态可以继续推送。
- 桌面版已执行 `npm run dist`，Electron/运行时/Computer Use/管理员宿主检查通过，桌面快捷方式已更新。
- 网页版已执行 `npm run remote:build` 和 `npm run remote:deploy`，服务器上的 `allai-relay` Docker 容器已重建、重启，健康检查通过。

**更早完成：**
- 手机网页加「扫码配对」（jsQR，触屏才显示，相机不行可从相册选图）；
- 修 iPhone 主屏幕 App 杀后台要重配（密钥改存字符串 + IndexedDB/localStorage 双份）；
- 修 iPhone 主屏幕 App 一直用旧版本（资源地址带打包编号、页面 no-store、启动时 `checkForUpdate()`）；
- 一键部署脚本 `npm run remote:deploy`（见「远程控制」一节）。已部署到用户服务器，用户确认看到了扫码按钮。

**还没闭环的事（接手时留意）：**
1. 本轮 Remote Control 的真实手机验收还需要用户确认：手机切换 Claude Code / Codex / Grok Build 的多条工作时，列表、完整历史、运行中状态、工具调用和流式最终回复是否都持续同步；同时确认电脑停在聊天/创作页时，手机 Agent 仍能更新。
2. 当前远程协议仍以桌面端 React 快照为事实来源，每个连接的手机共享桌面端当前活动工作；如果要让多台手机同时各自打开不同 Agent 工作，需要继续把工作详情改成按设备独立订阅。
3. Codex / Claude / Grok 的本地工作从各自会话目录扫进 Agent 列表。AllAi 官方登录聊天（`~/.allai/claude-chat` 等）不进 Agent。Codex 的 `guardian_review` / `subagent` 审批子会话也不进列表。
4. 真实手机上扫码配对 → 聊天 / Agent / 创作 → 杀后台再进，整条用户还没确认过。出问题先看 `docs/REMOTE.md` 的排错表。
5. 管理员模式真实的 UAC 那一下还没经用户手点验证（0.15.4 起）。
6. 如果用户手机上还是旧页面：那是旧缓存，让用户删掉主屏幕图标、
   用 Safari 重新「添加到主屏幕」，再在 App 里扫码配一次。

**0.16.0：** 远程控制 —— 手机网页经用户自己服务器上的中继操控电脑上的
AllAi（聊天/Agent/创作），端到端加密，多设备。本机端到端测过；**真实手机 + 真实服务器还没跑过**，
用户部署后第一次用时留意 1Panel 反代有没有开 WebSocket（见 docs/REMOTE.md）。

**更早（0.15.5）：** 提示条动画不再瞬移；操控电脑整轮合并成一条回复（执行过程带截图）；
统计行通栏底色；热力图重做（撑满宽度、下方统计卡、月视图日历）。

**更早（0.15.4）：** 输入框三个开关只留图标、悬浮说明；管理员模式重做链路
（原版三个 bug：管道名对不上、提权管道写不进、失败静默）。**真实 UAC 那一步还没经用户手点验证。**

**更早（0.15.3，2026-09-10）：** 输入框「管理员」开关（UAC 一次，CLI 经提权宿主）；
Agent 专区也可以操控电脑。

**更早（0.15.2，2026-09-10）：** 修操控电脑第二步空转、超时后命令对错位、动作 JSON 认不全。

**更早（0.15.1，2026-09-10）：** 修 0.15.0 发送后立即“截屏失败”。不再依赖
Electron 窗口源 ID/标题，PowerShell 宿主直接按已验证 HWND 物理矩形截图；修正目标聚焦的
线程连接、Shell 激活和短时重试；截图/IPC/上传错误分别透传，宿主输出固定 UTF-8。隔离
WinForms 窗口真实截图回归由失败变为连续 3 次成功（960×630、28–30KB JPEG）。

**更早（0.15.0，2026-09-10）：** 重构「操控电脑」。AllAi 最小化后绑定目标窗口，
只截该窗口并提高到 1600×1200；每个动作前重激活并核对句柄/进程；加入 Windows UI
Automation 控件定位、已打开窗口显式切换、合并输入与提交、截图变化检测和按动作动态等待。
默认确认改成尊重原始任务授权，普通步骤和任务明确要求的结果连续完成，只有信息不清或超出
任务才确认。action JSON 和控制错误改成可读的历史步骤。安装包检查会真正启动输入宿主并验
BOM/DPI/UIA。协议纯函数、PowerShell 宿主和窗口枚举均已测试；真实多应用任务仍需要用户验收。

**更早（0.14.0–0.14.4，2026-09-10）：** 新增「操控电脑」的第一版——整屏截图 +
PowerShell/user32 模拟输入 + 视觉模型动作循环，零新增原生依赖；随后修了官方登录模型看不到图、
返回值/陈旧闭包竞态和安装版从 app.asar 启动脚本等问题。

**更早（0.13.0，2026-09-10）：** 性能 —— 打字从 145ms/字降到 6.7ms、长任务 25→0。
全面 memo 化 + 稳定回调 + 输入框改用 CSS `field-sizing`。

**更早（0.12.2–0.12.3，2026-09-10）：** 上下文占用改成读 CLI / 接口自报的真实值。
先修了字符估算虚高 4.5 倍并误触发压缩，又修了 Grok 挑错字段（`inputTokens` 是一轮里
多次调用的总和）虚高 6 倍、以及 Claude 聊天占用缩水成个位数（没算缓存读）。

**更早（0.12.1，2026-09-09，另一个 AI 做的）：** 数据与稳定性审计：并发上传、
对话索引自愈、压缩字段保存、SSE/CLI 尾帧与中文、联网临时/永久失败及半流中断、
官方聊天重新生成、删除路径和外链协议安全、初始化局部容错。

**更早（0.12.0，2026-09-09）：** 按模型真实上限自动压缩上下文，三个专区都有；
统计行显示「已用/上限·百分比」；设置里可调阈值和手填模型上限；加了防客户端误引
服务端模块的构建检查。

**更早（0.11.0，2026-09-09）：** 自己的标题栏、Agent 全局提供商池、
自己的视频播放器（全屏/倍速/下载都能用）、用量热力图、修「(未知模型)」、
修 `next build` 读 `dist/` 旧安装包 OOM。

**更早（0.9.11–0.9.16，都在 2026-09-09）：**

- 官方额度：Claude / ChatGPT 5h+7d 已用%；Grok 周已用%；ChatGPT / Grok 重置次数。
- 创作改成对话；去掉语音输入。
- 创作布局（左图右小气泡）、放大下载参考、发送立刻出气泡、可取消、视频错误带原文。
- 换模型文案：`型号 · 来源 → 型号 · 来源`。
- 创作改成真正的聊天布局（提示词在右、产出在左、上下排），图按高度封顶 26rem。

**真的还没做 / 没验证过（这些是可以接着干的）：**

- **Codex 的联网开关没实测过。** `-c tools.web_search=true` 是照 codex 的 config 约定写的，
  而 `-c` 接受任意键、不认识的会被忽略，所以写错了也不报错、只是不生效。
  要验证得用 ChatGPT 账号问一个必须联网才知道的问题。
  （Claude 和 Grok 的工具名是验证过的：给 grok 传假工具名它会卡住，传 `web_search` 干净退出。）
- **官方登录聊天的联网没端到端验证过**，只验证了 CLI 层面接受参数。
- **上下文压缩没在真实长对话上跑过**（0.12.0 是用假网关 + 人造 4000 token 上限验的，
  逻辑链路全通，但没验过真的聊到 200K 时摘要质量如何）。
- **「操控电脑」0.15.0 的真实任务成功率仍没有数据。** 目标窗口截图、焦点校验、UIA 控件和
  窗口切换已经从结构上处理了第一版的主要问题，但不能用开发者的日常桌面做自动化回归。
  用户验收时重点观察：自绘/Electron 应用不暴露 UIA 时坐标回退是否准确、同进程模态窗口、
  跨应用 `switch`，以及执行后变化率阈值是否太敏感。
- **`electron/computer.ps1` 的 `key` 动作走 SendKeys，没做过按键覆盖测试。**
  组合键写法（`^c`、`%{F4}`、`+{TAB}`）只在文档层面对过，没逐个实测。
- **Windows 的 UIPI 没处理**：如果目标窗口是以管理员身份运行的，
  普通权限的 AllAi 发过去的鼠标键盘事件会被系统静默丢弃 —— 现象和这次的 asar bug
  一模一样（AI 一直说话、电脑没反应），但原因完全不同。真遇到了先查这个。
- `ChatApp.tsx` 仍然很大（2000+ 行），状态全在一个组件里。真要动就抽 `useChatSession`，
  别做半截。
- 只能改最后一条用户消息；改中间那条要重跑整段，还会和 CLI 的会话对不上。
- 用量只在「一轮结束」时记一次，中途停掉的不计。
- 打包没有代码签名证书，Windows 首次运行有 SmartScreen 提示。
- `dist/` 里堆了 20 多个历史安装包（每个约 210MB）。构建已经不会去读它们了，
  但占空间，用户想清可以清。

**已经踩过的坑（别再踩一遍）：**

- **视频（实测 ai.yp.mk 的 grok-imagine-video，0.9.17）**：`POST /videos/generations` 返回
  `{request_id}`，轮询 `GET /videos/<id>` 期间是 `202 {"status":"pending","progress":N}`，
  完成是 `200 {"status":"done","video":{"url":"/v1/videos/<id>/content"}}`。注意三点：
  成片地址在 **`video.url`**（不是 `url`/`data[0].url`）、是**相对路径**、
  下载**要带 Authorization**（不带 401）。这三条任缺一条都表现为「一直超时」。
- 创作里放媒体的那一列必须有**确定宽度**（`w-full max-w-[75%]`）。只写 `max-w-` 的话
  这一列会收缩到内容宽度，里面的 `w-full` 就没有参照 ——「正在生成」的占位框会塌成
  0 高（DOM 里有、屏幕上看不见），图也会按原始像素乱跳。占位框只按宽度定尺寸，
  别再给它 `h-`，那会和 `aspect-*` 打架把宽度算到列外面去。
- 创作 pending job 的 id 和服务器 job id 不是同一个；成功/取消后靠 `onThreadChanged`
  整表重载。不要在本地把 pending 和服务器 job 拼成两条。
- 上下文长度是按字符估的（中文 0.6/字、英文 4 字符/token），**不是精确 token 数**。
  只用来决定「该压了没」和画进度条，别拿它当账单依据。

**联网现状（对 ai.yp.mk 实测，2026-09-09）：**

| 模型 | `/v1/responses` + `web_search` | 说明 |
|------|------|------|
| grok-4.6 / 4.5 | ✅ 真的搜 | 答出了 x.ai 首页当时的标题 |
| gpt-5.5 | ⚠️ 看问题 | 有时会搜、有时收下参数不搜；不搜时界面会明说 |

`chat/completions` 上的联网**已经彻底走不通**，别再回去试参数（见产品约定 21）。

## 手测清单

改完 UI 记得 `npm run dist` 再从快捷方式打开，`next dev` 看到的不算数。

1. 聊天开「联网」问一个要查实时信息的问题 → 回答上方应出现「🌐 联网搜索」，不是弹窗。
2. 故意用一个不存在的模型发一条 → 报错显示在对话里（红色），**刷新后还在**，旁边有「重新生成」。
3. 设置 → 通用：统计行开关、模型图标（给 DeepSeek 填 `deepseek.com` 抓图标）。
4. Agent 里拖一张图发送 → 会复制到 `<工作目录>/.allai-files/`，展开「执行过程」看它有没有读图。
5. 创作台：发出去后右侧立刻出提示词、左侧「正在生成」；点停止能取消。图能放大、下载、拖进输入框当参考。换模型文案是 `型号 · 来源 → 型号 · 来源`。
6. 中文输入法打字按回车是选词，不是发送。
7. 「操控电脑」：模型选第三方接口里的视觉模型（官方登录那几个开关应该是灰的）→
   打开计算器 → 点亮开关 → 说「算 123 乘 456」→ 手不要碰鼠标键盘。
   安全档位先调到「每步都问」。**动作没反应时先看 `computerInfo().script`
   指向哪儿**（不能是 app.asar 里那份），再看目标窗口是不是管理员权限（UIPI）。
8. 长对话里打字不该卡。感觉顿了就按「性能」那节的方法量一遍，
   基线是中位数 < 10ms、长任务 0。
9. **异常路径要能自己恢复**（0.16.41 修的就是这批，以前踩上只能重启软件）：
   - 聊天 / Agent 发一条，中途把终端宿主弄挂（任务管理器结束它）或断网 →
     报错应该出现在**对话里**，并且**能继续发下一条**，不是一直转圈（约定 91）。
   - 快速连点两条不同的对话（或两条不同的 Agent 工作）→ 界面显示的内容得是你**最后点的**
     那条，不会串台，顶上的模型也不会被改成前一条的（约定 92）。
10. **认国内模型**（0.16.42）：配一个国内服务（DeepSeek / 通义 / Kimi / 智谱 / 豆包都行），
    模型列表里每个模型前面应该有图标。**没配图标的牌子应该是一块「品牌色 + 缩写」的色块**
    （DeepSeek 蓝底 D、通义紫底 Q、Kimi 黑底 K），不是空白也不是错的 logo。
    重点试两个反例：
    - `MiniMaxAI/MiniMax-M2`（或任何 MiniMax 模型）→ 应该是 **MiniMax 的色块**，
      **不能是 Grok 的 logo**（0.16.42 修的就是这个）。
    - `nvidia/llama-3.1-nemotron-70b` → 应该是 **NVIDIA 的色块**，不是 Meta 的。
    随便起个认不出的名字（比如 `my-custom-model`）→ 应该**什么都不画**（画错比不画更糟）。
    换模型时那行提示 `型号 · 来源 → 型号 · 来源` 前面的小图标也应该跟着对。
11. **图标导入**（0.16.42）：设置 → 通用 → 模型图标，给某个牌子填**域名**（不要带 `https://`）
    试试 `bigmodel.cn` / `volcengine.com` / `dashscope.aliyun.com` / `moonshot.cn` ——
    应该都能抓到图标（这几个的图标都在 `<link rel="icon">` 里或 CDN 上，不是 `/favicon.ico`）。
    也可以直接**粘贴**一个网址，粘完自动就抓。填一个确实没有图标的域名
    （比如 `qianfan.baidubce.com`）→ 报错应该说**「qianfan.baidubce.com 上没找到图标」**，
    **不能出现 google.com**，而且 5 秒左右就该返回。
12. **英文界面扫一遍**（0.16.43）：设置 → 通用 → 语言切 English，然后逐页看还有没有漏网的中文。
    重点四处：
    - **Model limits**（设置 → 用量/上下文那一块）模型下面的小字 —— 原来全是
      「及更早」「（可输入部分）」「认不出型号，按保守值算」。
    - **模型图标**整页（含新加的「接口」那一组）。
    - **新建接口时的预设按钮**（通义千问→Qwen、智谱 GLM→Zhipu GLM、硅基流动→SiliconFlow）。
    - **Agent 输入框**：推理 / 权限两个下拉**只显示档位名**（Balanced），
      而且**发送按钮必须还和它们在同一行**，不能被挤到下一排（窗口拉窄也一样）。
    已知还留着中文的地方（**不用改**）：服务端返回的错误提示、发给模型的提示词。
13. **服务图标**（0.16.45）：设置 → 聊天模型 → 添加服务 / 点进一条服务里配；Agent 接口和全局提供商每条也有。通用 → 模型图标只剩厂商和认不出的模型，没有「接口」那一组。切提供商时图标和网址不得跟着跑。
    给一个接口配图标后，这个接口下面的**所有模型**（模型列表、使用统计「按模型」表、
    聊天空状态）都应该换成它；再给其中**某一个模型**单独配一张 → 那个模型用自己那张，
    其余的仍用接口那张（约定 95 的优先级）。
    没配图标的接口行显示的是**灰色服务器图标**，不是它第一个模型的厂商图标。




