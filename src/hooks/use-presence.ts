"use client";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client";

const KEY = "sl:presence-id";
function myId(): string {
  try {
    let id = sessionStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return "anon-" + Math.random().toString(36).slice(2, 12);
  }
}

/** how many people are on this market right now (you included). heartbeats every 20 s while the tab is open. */
export function usePresence(coin: string | undefined): number | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => setId(myId()), []);
  const q = useQuery({
    queryKey: ["presence", coin, id],
    queryFn: () => api<{ watching: number }>("/api/presence", { method: "POST", json: { coin, id } }).then((r) => r.watching),
    enabled: !!coin && !!id,
    refetchInterval: 20_000,
    refetchIntervalInBackground: false,
  });
  return q.data ?? null;
}
