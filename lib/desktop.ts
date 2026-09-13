import type { AllAiDesktop } from "@/types/desktop";

export function getDesktop(): AllAiDesktop | null {
  if (typeof window === "undefined") return null;
  return window.allaiDesktop ?? null;
}
