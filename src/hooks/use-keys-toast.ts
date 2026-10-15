"use client";
/** the keys section's one-line toast: confirmations, wallet prompts and errors, in the preview and live alike */
import { useSyncExternalStore } from "react";

export type KeysToast = { id: number; text: string; tone: "ok" | "busy" | "error" } | null;

let toast: KeysToast = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());

/** show `text`; busy toasts stay until replaced, the rest clear themselves */
export function keysToast(text: string, tone: "ok" | "busy" | "error" = "ok") {
  if (timer) clearTimeout(timer);
  toast = { id: Date.now(), text, tone };
  emit();
  if (tone !== "busy") timer = setTimeout(() => ((toast = null), emit()), tone === "error" ? 6500 : 4200);
}

export function useKeysToast(): KeysToast {
  return useSyncExternalStore(
    (f) => (listeners.add(f), () => void listeners.delete(f)),
    () => toast,
    () => null,
  );
}
