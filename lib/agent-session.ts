/**
 * Agent 这一轮要不要续 CLI 会话。纯函数，方便测。
 *
 * 同一条工作、同一家 CLI 里换后端型号（CC Switch 那套）：续当前会话，
 * 靠这一轮进程的 ANTHROPIC_MODEL / --model 换型号，不要另开一条对话，
 * 更不要因为型号名叫 grok-4.6 就改去 spawn Grok Build。
 */

/** 用户刚在界面换了模型，但还没发出去，CLI 会话仍是旧型号。 */
export const PENDING_SESSION_MODEL = "__pending_switch__";

export function agentModelSwitched(wanted: string, runningOn: string) {
  const next = wanted.trim();
  const current = runningOn.trim();
  if (!next || !current) return false;
  return next !== current;
}

export function agentContinueSession(opts: {
  keepSession?: boolean;
  resumable: boolean;
  mustCompact: boolean;
  sourceNew: boolean;
  hasAssistant: boolean;
}) {
  if (opts.keepSession && opts.resumable) return true;
  if (opts.mustCompact || (opts.sourceNew && !opts.hasAssistant)) return false;
  return opts.resumable;
}
