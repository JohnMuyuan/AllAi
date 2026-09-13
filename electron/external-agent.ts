/**
 * Codex 可以「导入」别的 Agent（比如 Claude Code）的会话，turn_id 形如 external-import-turn-N。
 * 导入时对方的每一次工具调用和工具输出，都被写成一段带标记的 AgentMessage 文字：
 *
 *   [external_agent_tool_call: Bash]
 *   description: List files
 *   command: ls -la "D:/..."
 *   [/external_agent_tool_call]
 *
 *   [external_agent_tool_result]            ← 出错时是 [external_agent_tool_result: error]
 *   ……命令输出……
 *   [/external_agent_tool_result]
 *
 * 原样当成回复显示，就是满屏的命令、目录列表和脚本输出；输出里还常有 GBK 被当 UTF-8 读出来的乱码
 * （用户看到的「一堆乱码」就是这个）。这里拆开：工具调用变成执行过程里的一行，输出丢掉
 * （和其它会话一样不显示原始输出），剩下的才是真正写给用户的话。
 */

export type ImportedTool = { name: string; fields: Record<string, string> };

const RESULT = /\[external_agent_tool_result(?::[^\]\n]*)?\][\s\S]*?(?:\[\/external_agent_tool_result\]|$)/g;
const CALL = /\[external_agent_tool_call:\s*([^\]\n]+)\][ \t]*\n?([\s\S]*?)(?:\[\/external_agent_tool_call\]|$)/g;

/** 调用块里出现过的字段名。只认这些，免得多行命令里长得像「xxx: yyy」的代码行被当成新字段。 */
const KEYS = new Set(["description", "command", "file", "input", "path", "pattern", "url", "query", "prompt"]);
/** 值可以跨多行的字段：进了这些字段就一直收到块结束。 */
const MULTILINE = new Set(["command", "input", "prompt"]);

function parseFields(body: string) {
  const fields: Record<string, string> = {};
  let key = "";
  for (const line of body.replace(/\r\n?/g, "\n").split("\n")) {
    const head = /^([a-z_]+):[ \t]?(.*)$/.exec(line);
    if (head && KEYS.has(head[1]) && !MULTILINE.has(key)) {
      key = head[1];
      fields[key] = head[2];
      continue;
    }
    if (key) fields[key] += `\n${line}`;
  }
  for (const name of Object.keys(fields)) fields[name] = fields[name].trim();
  return fields;
}

/**
 * 拆一段 AgentMessage 文字。
 * - tools：里面的工具调用（按出现顺序）；
 * - text：去掉标记块之后剩下的正文（可能是空的）；
 * - stripped：原文里有没有标记块。没有就是普通回复，调用方照旧处理。
 */
export function parseExternalAgentText(text: string): { text: string; tools: ImportedTool[]; stripped: boolean } {
  if (!text.includes("[external_agent_tool_")) return { text, tools: [], stripped: false };
  const tools: ImportedTool[] = [];
  const rest = text
    .replace(RESULT, "")
    .replace(CALL, (_match, name: string, body: string) => {
      tools.push({ name: name.trim(), fields: parseFields(body) });
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text: rest, tools, stripped: true };
}
