# AllAi

把你买的多个 AI 订阅接到同一个窗口。网页聊天随时换模型；Windows 桌面版还能把 Grok Build、Claude Code、Codex CLI 收进同一个软件，不用再自己开 PowerShell。

## 网页版

```bash
npm install
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。

## 接入模型

左下角 **接入模型**，填三项：

1. 接口地址（OpenAI 兼容，需带版本路径，例如 `https://api.x.ai/v1`）
2. API Key
3. 模型 ID，或点「从接口同步」

内置模板：SpaceXAI、OpenAI、DeepSeek、通义千问、Kimi、智谱、硅基流动、OpenRouter、Groq。

密钥只保存在本机，默认路径是用户目录下的 `.allai/db.json`。

可选：在 `.env.local` 里写 `XAI_API_KEY`，第一次启动会自动加入 SpaceXAI。

## Windows 桌面版

本机需已安装对应 CLI（AllAi 会自动检测）：

- Grok Build：`grok`
- Claude Code：`claude`
- Codex CLI：`codex`

双击桌面上的 **AllAi** 即可打开。

如果还没有图标，在项目里执行一次：

```bash
npm run dist
```

会生成安装包 `dist/AllAi-Setup-<版本号>.exe`（版本号取自 `package.json`），并在桌面和开始菜单创建快捷方式。之后都不用再输入命令。

打安装包：

```bash
npm run dist
```

生成的安装程序在 `dist/`。

在软件里切到 **Agent**：选工作目录，点 **官方登录**（浏览器走各家 OAuth）或在设置里改成 **API / 第三方** 后启动。会话跑在内嵌终端里，切回聊天页也不会被关掉。

## 使用

- 新对话、历史记录、重命名、删除
- 顶部切换模型，同一段对话中途可换
- 流式输出、停止生成、重新生成、复制、Markdown
- `Ctrl/Cmd + Shift + O` 开新对话
- 桌面版聊天可选 Claude 官方登录（走本机 Claude Code，和 Code 共用额度）
- 桌面版 Agent：Grok Build / Claude Code / Codex，官方登录或第三方 API
