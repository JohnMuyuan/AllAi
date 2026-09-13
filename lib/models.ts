import type { ModelKind, ModelRef } from "./types";

export function classifyModel(id: string): ModelKind {
  const value = id.toLowerCase();
  if (
    /imagine-video|video-1|veo|kling|runway|luma|minimax-video|sora|wanx-video|cogvideox/.test(
      value,
    )
  ) {
    return "video";
  }
  if (
    /imagine-image|grok-imagine|dall-e|dall•e|dalle|gpt-image|flux|stable-diffusion|sdxl|midjourney|recraft|ideogram|imagen|kolors|wanx|cogview/.test(
      value,
    )
  ) {
    return "image";
  }
  return "chat";
}

export function withModelKind(model: ModelRef): ModelRef {
  const detected = classifyModel(model.id);
  if (detected !== "chat") return { ...model, kind: detected };
  return { ...model, kind: model.kind || "chat" };
}

export function isChatModel(model: ModelRef) {
  return (model.kind || classifyModel(model.id)) === "chat";
}

export function isImageModel(model: ModelRef) {
  return (model.kind || classifyModel(model.id)) === "image";
}

export function isVideoModel(model: ModelRef) {
  return (model.kind || classifyModel(model.id)) === "video";
}

export function mediaKindFromMime(mime: string): "image" | "video" | "audio" | "file" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "file";
}
