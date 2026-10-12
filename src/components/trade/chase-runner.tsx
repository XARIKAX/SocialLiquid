"use client";
import { useEffect } from "react";
import { ensureChaseRunner } from "@/lib/chase";

/** mount once: keeps chase orders re-pricing while any page of the app is open */
export function ChaseRunner() {
  useEffect(() => ensureChaseRunner(), []);
  return null;
}
