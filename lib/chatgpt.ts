export const CHATGPT_WEB_KEY = "chatgpt-web";

export function isChatGptWeb(modelKey: string) {
  return modelKey === CHATGPT_WEB_KEY;
}
