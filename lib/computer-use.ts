/**
 * Computer Use 的动作协议。
 *
 * 为什么是「模型输出 JSON 块」而不是 function calling：这个软件接的是各种第三方
 * 中转站，tools 参数的支持程度参差不齐（联网那次已经领教过，见产品约定 21）。
 * 让模型在正文里吐一段 ```action 代码块，任何能读图的模型都能干，网关不认也不会挂。
 *
 * 这个文件必须是纯函数、不碰 fs / fetch —— 界面和服务端都要引它。
 */

export type ComputerActionMeta = {
  /** 只有真正会造成外部副作用的提交点才标记。普通输入/点击不应打断任务。 */
  confirm?: boolean;
  /** 为什么需要用户确认，直接显示在确认横幅里。 */
  reason?: string;
};

export type ComputerOp = ComputerActionMeta & (
  | { op: "switch"; id: string }
  | { op: "element"; id: number; action?: "invoke" | "focus" | "toggle" | "expand" | "select" }
  | { op: "click"; x: number; y: number; button?: "left" | "right" | "middle"; double?: boolean }
  | { op: "move"; x: number; y: number }
  | { op: "drag"; x: number; y: number; toX: number; toY: number }
  | { op: "scroll"; x?: number; y?: number; amount: number }
  /** x/y 可选；有坐标时一次完成“点输入框 + 输入”，submit 再顺带回车。 */
  | { op: "text"; text: string; element?: number; x?: number; y?: number; submit?: boolean }
  | { op: "key"; keys: string }
  | { op: "wait"; ms: number }
  | { op: "foreground" }
  | { op: "done"; summary: string }
);

export type SafetyLevel = "confirm-all" | "confirm-risky" | "auto";

/**
 * 哪些动作要拦下来问用户。
 *
 * 用户发送“帮我完成某任务”已经授权了完成该任务所需的普通输入和点击。
 * 是否要在提交点暂停由模型结合原始任务语义显式标 confirm。按键本身没有可靠语义：
 * Delete 既可能删一个字符，也可能删除文件，所以不能靠字符串写死。
 */
export function isRisky(action: ComputerOp): boolean {
  return action.confirm === true;
}

export function needsConfirm(action: ComputerOp, level: SafetyLevel): boolean {
  if (action.op === "done" || action.op === "foreground") return false;
  if (level === "confirm-all") return true;
  if (level === "auto") return false;
  return isRisky(action);
}

/** 给用户看的一句话描述。动作确认框和对话里的记录都用它，口径统一。 */
export function describeAction(action: ComputerOp): string {
  switch (action.op) {
    case "click": {
      const button = action.button === "right" ? "右键" : action.button === "middle" ? "中键" : "";
      return `${action.double ? "双击" : "点击"}${button} (${action.x}, ${action.y})`;
    }
    case "element":
      return `${action.action === "focus" ? "聚焦" : "操作"}控件 #${action.id}`;
    case "switch":
      return `切换到窗口 ${action.id}`;
    case "move":
      return `移动鼠标到 (${action.x}, ${action.y})`;
    case "drag":
      return `从 (${action.x}, ${action.y}) 拖到 (${action.toX}, ${action.toY})`;
    case "scroll":
      return `${action.amount > 0 ? "向上" : "向下"}滚动 ${Math.abs(action.amount)} 格`;
    case "text":
      return `${action.x === undefined ? "输入文字" : "定位输入框并输入"}${action.submit ? "后提交" : ""}：${action.text.length > 40 ? `${action.text.slice(0, 40)}…` : action.text}`;
    case "key":
      return `按键：${action.keys}`;
    case "wait":
      return `等待 ${action.ms}ms`;
    case "foreground":
      return "查看当前前台窗口";
    case "done":
      return action.summary || "任务完成";
    default:
      return "未知动作";
  }
}

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function meta(row: Record<string, unknown>): ComputerActionMeta {
  return {
    ...(row.confirm === true ? { confirm: true } : {}),
    ...(typeof row.reason === "string" && row.reason.trim()
      ? { reason: row.reason.trim().slice(0, 160) }
      : {}),
  };
}

/** 把模型给的一个对象收成合法动作。字段不对就返回 null，宁可让它重来也别乱点。 */
export function parseAction(raw: unknown): ComputerOp | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const op = typeof row.op === "string" ? row.op : "";
  switch (op) {
    case "switch": {
      if (typeof row.id !== "string" || !/^\d+$/.test(row.id)) return null;
      return { op: "switch", id: row.id, ...meta(row) };
    }
    case "element": {
      const id = num(row.id);
      if (id === null || id < 0) return null;
      const allowed = new Set(["invoke", "focus", "toggle", "expand", "select"]);
      const action = typeof row.action === "string" && allowed.has(row.action) ? row.action : "invoke";
      return {
        op: "element",
        id,
        action: action as "invoke" | "focus" | "toggle" | "expand" | "select",
        ...meta(row),
      };
    }
    case "click":
    case "move": {
      const x = num(row.x);
      const y = num(row.y);
      if (x === null || y === null) return null;
      if (op === "move") return { op: "move", x, y, ...meta(row) };
      const button = row.button === "right" ? "right" : row.button === "middle" ? "middle" : "left";
      return { op: "click", x, y, button, double: Boolean(row.double), ...meta(row) };
    }
    case "drag": {
      const x = num(row.x);
      const y = num(row.y);
      const toX = num(row.toX);
      const toY = num(row.toY);
      if (x === null || y === null || toX === null || toY === null) return null;
      return { op: "drag", x, y, toX, toY, ...meta(row) };
    }
    case "scroll": {
      const amount = num(row.amount);
      if (amount === null || amount === 0) return null;
      const x = num(row.x);
      const y = num(row.y);
      return {
        op: "scroll",
        amount: Math.max(-10, Math.min(10, amount)),
        ...(x !== null && y !== null ? { x, y } : {}),
        ...meta(row),
      };
    }
    case "text": {
      if (typeof row.text !== "string" || !row.text) return null;
      const x = num(row.x);
      const y = num(row.y);
      const element = num(row.element);
      if ((x === null) !== (y === null)) return null;
      return {
        op: "text",
        text: row.text.slice(0, 2000),
        ...(element !== null && element >= 0 ? { element } : {}),
        ...(x !== null && y !== null ? { x, y } : {}),
        ...(row.submit === true ? { submit: true } : {}),
        ...meta(row),
      };
    }
    case "key": {
      if (typeof row.keys !== "string" || !row.keys) return null;
      return { op: "key", keys: row.keys.slice(0, 120), ...meta(row) };
    }
    case "wait": {
      const ms = num(row.ms);
      return { op: "wait", ms: Math.max(100, Math.min(10_000, ms ?? 500)), ...meta(row) };
    }
    case "foreground":
      return { op: "foreground", ...meta(row) };
    case "done":
      return { op: "done", summary: typeof row.summary === "string" ? row.summary : "", ...meta(row) };
    default:
      return null;
  }
}

/**
 * 从模型的回答里抠出动作。
 *
 * 认三种写法：```action 代码块、光秃秃的 ```json 代码块、以及整段就是一个 JSON。
 * 模型不听话是常态，多认几种比反复重试省事。
 */
function pushAction(raw: unknown, out: ComputerOp[], seen: Set<string>) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const row = raw as Record<string, unknown>;
    if (row.action && typeof row.action === "object") {
      pushAction(row.action, out, seen);
      return;
    }
  }
  const action = parseAction(raw);
  if (!action) return;
  const key = JSON.stringify(action);
  if (seen.has(key)) return;
  seen.add(key);
  out.push(action);
}

function parseActionPayload(body: string, out: ComputerOp[], seen: Set<string>) {
  const trimmed = body.trim().replace(/,\s*$/, "");
  if (!trimmed) return;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) parsed.forEach((item) => pushAction(item, out, seen));
    else pushAction(parsed, out, seen);
    return;
  } catch {
    // 整段不是 JSON，再按花括号抠对象
  }
  for (let index = 0; index < trimmed.length; index++) {
    if (trimmed[index] !== "{") continue;
    if (!/"op"\s*:/.test(trimmed.slice(index, index + 120))) continue;
    let depth = 0;
    for (let end = index; end < trimmed.length; end++) {
      const ch = trimmed[end];
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          try {
            pushAction(JSON.parse(trimmed.slice(index, end + 1)) as unknown, out, seen);
          } catch {
            // 这段不是合法动作
          }
          index = end;
          break;
        }
      }
    }
  }
}

export function extractActions(text: string): ComputerOp[] {
  const out: ComputerOp[] = [];
  const seen = new Set<string>();
  const fences = [...text.matchAll(/```(?:action|json)?[ \t]*\r?\n?([\s\S]*?)```/gi)];
  for (const fence of fences) parseActionPayload(fence[1], out, seen);
  if (out.length) return out;
  parseActionPayload(text, out, seen);
  return out;
}

/** 把动作块从正文里拿掉 —— 用户要看的是它在说什么，不是 JSON。 */
export function stripActions(text: string): string {
  return text
    .replace(/```(?:action|json)?\s*\n[\s\S]*?```/g, "")
    .replace(/\{[^{}]*"op"\s*:\s*"[a-z]+"[^{}]*\}/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 给模型的操作说明。截图尺寸和当前目标窗口每轮都可能变，所以现拼。 */
export function computerSystemPrompt(shot: {
  width: number;
  height: number;
  targetTitle?: string;
  changedRatio?: number;
  controls?: { id: number; type: string; name: string; x: number; y: number; width: number; height: number }[];
  windows?: { id: string; title: string }[];
}): string {
  const controls = (shot.controls ?? []).slice(0, 100);
  return [
    "你正在连续操作一台 Windows 电脑。用户发送任务本身已经授权普通的定位、点击、输入、滚动和快捷键；不要在普通步骤中询问用户是否执行。",
    `当前目标窗口是「${shot.targetTitle || "未知窗口"}」。截图只包含这个目标窗口，尺寸 ${shot.width}×${shot.height}。`,
    "所有坐标都必须使用这张图里的相对像素，左上角是 (0, 0)。运行器会绑定并校验目标窗口、换算 DPI。",
    ...(typeof shot.changedRatio === "number"
      ? [`与上一次截图相比，约 ${(shot.changedRatio * 100).toFixed(1)}% 的采样像素发生了变化。`]
      : []),
    ...(controls.length
      ? [
          "可访问控件（编号只对当前截图有效，优先按编号操作，比猜坐标准）：",
          ...controls.map(
            (item) =>
              `#${item.id} ${item.type} “${item.name || "(无名称)"}” @ ${item.x},${item.y} ${item.width}×${item.height}`,
          ),
        ]
      : ["当前窗口没有提供可访问控件，只能按截图坐标操作。"]),
    ...((shot.windows ?? []).length
      ? [
          `已打开的其它窗口：${(shot.windows ?? [])
            .slice(0, 20)
            .map((item) => `[${item.id}] ${item.title}`)
            .join("；")}`,
        ]
      : []),
    "",
    "只输出一个动作代码块，不要解释、不要复述任务：",
    "",
    "```action",
    '{"op": "click", "x": 640, "y": 400}',
    "```",
    "",
    "可用的动作：",
    '- `{"op":"switch","id":"窗口编号"}` 切换到上面列出的另一个已打开窗口',
    '- `{"op":"element","id":12,"action":"invoke"}` 按控件编号操作；action 可用 focus/toggle/expand/select',
    '- `{"op":"click","x":..,"y":..}` 点击，可加 `"button":"right"` 或 `"double":true`',
    '- `{"op":"move","x":..,"y":..}` 只移动鼠标',
    '- `{"op":"drag","x":..,"y":..,"toX":..,"toY":..}` 拖拽',
    '- `{"op":"scroll","amount":-3,"x":..,"y":..}` 滚动，负数向下',
    '- `{"op":"text","text":"内容","element":7}` 聚焦编号控件后输入；没有编号再用 x/y；可加 `"submit":true`',
    '- `{"op":"key","keys":"{ENTER}"}` 按键，SendKeys 写法：^=Ctrl %=Alt +=Shift，如 `^c`、`{TAB}`、`%{F4}`',
    '- `{"op":"wait","ms":800}` 等页面加载',
    '- `{"op":"foreground"}` 问一下现在哪个窗口在前台',
    '- `{"op":"done","summary":"做完了什么"}` 任务结束',
    "",
    "规矩：",
    "1. 一次只给一个动作；优先使用控件编号。输入时把 element 和 text 合成一步，没有控件编号再使用坐标。",
    "2. 运行器会在每个动作前重新激活目标窗口。截图没有明显变化时重新观察和定位，不要重复盲点同一坐标。",
    '3. 普通步骤不要设置 confirm。原始任务明确要求的发送、删除、关闭、安装等结果也已经获得授权，不要重复确认。只有动作会产生原始任务没有明确要求的外部影响、缺少关键对象/金额等必要信息，或后果明显超出任务时，才加 `"confirm":true,"reason":"需要补充确认的原因"`。',
    "4. 看不清或无法完成就给 done 说明原因，不要碰运气；不要操作 AllAi 自己。",
  ].join("\n");
}
