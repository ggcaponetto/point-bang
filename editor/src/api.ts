// The wire contract with the PC server — same-origin, exactly what the old
// editor.html inline script did. The session key rides in the URL fragment
// (never the query) and is presented in the POST body only.

import { parseFragment } from "../../public/transport.js";
import type { ButtonsConfig } from "./types";

/** The session key from the page's own fragment (#key=...), or null. */
export const sessionKey = (): string | null => parseFragment(location.hash).key;

export async function loadConfig(): Promise<ButtonsConfig> {
  const res = await fetch("./buttons.json");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as ButtonsConfig;
}

export type SaveResult =
  { ok: true; rev: number | string } | { ok: false; status: number; detail: string | null };

/** Rejects only on network failure; HTTP refusals resolve as {ok:false}. */
export async function saveConfig(cfg: ButtonsConfig, key: string | null): Promise<SaveResult> {
  const res = await fetch("/buttons", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(key ? { key, config: cfg } : { config: cfg }),
  });
  const body = (await res.json().catch(() => null)) as {
    rev?: number | string;
    problems?: string[];
  } | null;
  if (res.ok) return { ok: true, rev: body?.rev ?? "?" };
  return { ok: false, status: res.status, detail: body?.problems?.join("; ") ?? null };
}
