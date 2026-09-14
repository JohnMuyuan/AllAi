<p align="center">
  <img src="public/logo.png" width="96" height="96" alt="AllAi">
</p>

<h1 align="center">AllAi</h1>

<p align="center">
  一个窗口里：聊天、本地编程 Agent、生图视频。<br>
  把你已经买的订阅和接口接到一起，不必再开一堆终端。
</p>

<p align="center">
  <a href="https://github.com/JohnMuyuan/AllAi/releases/latest"><img alt="最新版本" src="https://img.shields.io/github/v/release/JohnMuyuan/AllAi?style=flat-square"></a>
  <img alt="Windows" src="https://img.shields.io/badge/Windows-10%2F11-0078D4?style=flat-square&logo=windows&logoColor=white">
  <img alt="Electron 44" src="https://img.shields.io/badge/Electron-44-47848F?style=flat-square&logo=electron&logoColor=white">
  <img alt="Next.js 16" src="https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=nextdotjs&logoColor=white">
</p>

<p align="center">
  <a href="https://github.com/JohnMuyuan/AllAi/releases/latest"><strong>下载安装包</strong></a>
  ·
  <a href="#接入">接入账号</a>
  ·
  <a href="#从源码运行">从源码运行</a>
  ·
  <a href="CHANGELOG.md">更新日志</a>
</p>

---

## 这是什么

AllAi 是 **Windows 桌面应用**。聊天走 OpenAI 兼容接口，也可以用本机已经登录的 **Claude Code / Codex / Grok** 吃订阅额度。编程 Agent 收进同一个窗口，不用自己开 PowerShell。

密钥、对话、用量都在这台电脑上，默认目录是用户主目录下的 `.allai`。

## 能做什么

| | |
| --- | --- |
| **聊天** | 多个 OpenAI 兼容服务；同一段对话中途可换模型。官方登录：Claude 账号、ChatGPT 账号、Grok 账号（走本机 CLI，和官方工具共用订阅）。支持联网、思考强度、斜杠指令、附件。可选「操控电脑」：模型截屏并操作鼠标键盘。 |
| **Agent** | [Grok Build](https://github.com/xai-org/grok-cli)、[Claude Code](https://docs.anthropic.com/en/docs/claude-code)、[Codex CLI](https://github.com/openai/codex) 跑在内嵌终端里。官方 OAuth 或第三方 API，工作目录自选，权限和思考档位可调。切回聊天也不会把正在跑的任务关掉。 |
| **创作** | 生图、视频按「创作对话」记，同一窗口连续出图都在这一条里。 |
| **用量** | 设置里看使用统计；官方账号还有 **额度监控**（消耗节奏、预计用完、整周额度折合多少），按这周实际在用的时间估，不按 24 小时不停跑去外推。 |
| **溯源** | 设置 → 溯源。用 [ModelTrace](https://github.com/xqy2006/ModelTrace) 的数字指纹，探测 HTTP 或官方 CLI 上的 OpenAI / Claude 是不是被路由到别的型号。 |
| **远程** | 手机浏览器操控电脑上的 AllAi（聊天 / Agent / 创作）。自建中继，端到端加密。说明见 [`docs/REMOTE.md`](docs/REMOTE.md)。 |
| **其它** | 中 / 英界面、浅色 / 深色、本机 Skills、后台自动更新（退出时安装，不弹向导）。 |

## 安装

1. 打开 [Releases](https://github.com/JohnMuyuan/AllAi/releases/latest)，下载 `AllAi-Setup-*.exe`。
2. 按向导选：装给谁、装到哪、要不要桌面 / 开始菜单快捷方式。
3. 装完可直接运行。之后有新版本会在后台下载，**退出 AllAi 时自动装上**，不会再走一遍向导。

也可以在设置 → 关于里手动检查更新，或立刻重启安装。

> 开发时 `npm run dist` 生成的桌面快捷方式指向解包目录，和安装版不是同一份。自动更新只对安装到系统目录的那份生效。

## 接入

### 官方登录（推荐，走订阅）

本机先装好对应命令行，AllAi 会检测：

| 产品 | 命令 |
| --- | --- |
| Claude Code | `claude` |
| Codex CLI（ChatGPT） | `codex` |
| Grok Build | `grok` |

设置 → 聊天模型 → 添加服务，选 **Claude 账号 / ChatGPT 账号 / Grok 账号** → 登录 → 保存。聊天和 Agent 都可以用这一套登录。

### OpenAI 兼容接口

同一页添加服务，填：

1. 接口地址（需带版本路径，例如 `https://api.openai.com/v1`）
2. API Key
3. 模型 ID，或点「从接口同步」

内置模板包括 SpaceXAI、OpenAI、DeepSeek、通义、Kimi、智谱，以及常见聚合平台。服务和模型都可以自己配图标。

## 数据在哪

都在本机，默认 `%USERPROFILE%\.allai\`（可用环境变量 `ALLAI_DATA_DIR` 改）：

- 服务、Agent、偏好、Skills、创作索引 → `db.json`
- 每条聊天一个文件 → `conversations/`
- 用量流水、额度采样、溯源记录各有自己的文件

密钥不上传。官方登录的令牌只从各家 CLI 自己的本地文件读取，软件里不会再让你粘贴。

## 从源码运行

需要 Node.js（与仓库里的 Electron 44 / Next.js 16 匹配即可）。

```bash
npm install
npm run desktop
```

会起 `next dev :3000` 再打开 Electron 窗口。

打 Windows 安装包：

```bash
# 先退出正在运行的 AllAi
npm run dist
```

安装包在 `dist/AllAi-Setup-<version>.exe`。版本号取自 `package.json`。

栈：Next.js 16 App Router、React 19、Tailwind 4、Electron 44、NSIS。

## 致谢

模型溯源的指纹方法与指纹库来自 [ModelTrace](https://github.com/xqy2006/ModelTrace)（MIT）。
