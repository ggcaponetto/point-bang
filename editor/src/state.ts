// The editor's whole state: the parsed buttons.json, the selected slot, and
// the save status. All edits are local until Save — reload discards, which
// is why nothing here asks for confirmation. The pure helpers in model.ts
// ARE the reducer; this hook only wires them to React.

import { useCallback, useEffect, useMemo, useState } from "react";
import { normalizeButtonRect } from "../../public/math.js";
import { configProblems, nextFreeRect, resetButton, updateButton } from "./model";
import { loadConfig, saveConfig, sessionKey } from "./api";
import type { ButtonsConfig, Rect } from "./types";

export type Status =
  | { k: "loading" }
  | { k: "editing" }
  | { k: "saving" }
  | { k: "saved"; rev: number | string }
  | { k: "refused"; status: number; detail: string | null }
  | { k: "failed"; error: string }
  | { k: "loadFailed"; error: string };

export function useEditorState() {
  const [cfg, setCfg] = useState<ButtonsConfig | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ k: "loading" });

  useEffect(() => {
    let alive = true;
    loadConfig()
      .then((c) => {
        if (!alive) return;
        setCfg(c);
        setStatus({ k: "editing" });
      })
      .catch((e: unknown) => {
        if (alive) setStatus({ k: "loadFailed", error: String(e) });
      });
    return () => {
      alive = false;
    };
  }, []);

  const problems = useMemo(() => (cfg ? configProblems(cfg) : []), [cfg]);

  const patchButton = useCallback((id: string, patch: Record<string, unknown>) => {
    setCfg((c) => (c ? updateButton(c, id, patch) : c));
  }, []);

  const patchSelected = useCallback(
    (patch: Record<string, unknown>) => {
      if (selected) patchButton(selected, patch);
    },
    [selected, patchButton],
  );

  const resetSelected = useCallback(() => {
    if (selected) setCfg((c) => (c ? resetButton(c, selected) : c));
  }, [selected]);

  /** Gives a button a fresh free rect (and optionally more) and selects it. */
  const placeOnCanvas = useCallback((id: string, extraPatch: Record<string, unknown> = {}) => {
    setCfg((c) => {
      if (!c) return c;
      const rects = c.buttons
        .map((b) => normalizeButtonRect(b.rect))
        .filter((r): r is Rect => r !== null);
      return updateButton(c, id, { rect: nextFreeRect(rects), ...extraPatch });
    });
    setSelected(id);
  }, []);

  const save = useCallback(async () => {
    if (!cfg) return;
    setStatus({ k: "saving" });
    try {
      const result = await saveConfig(cfg, sessionKey());
      setStatus(
        result.ok
          ? { k: "saved", rev: result.rev }
          : { k: "refused", status: result.status, detail: result.detail },
      );
    } catch (e) {
      setStatus({ k: "failed", error: String(e) });
    }
  }, [cfg]);

  return {
    cfg,
    setCfg,
    selected,
    setSelected,
    status,
    problems,
    patchButton,
    patchSelected,
    resetSelected,
    placeOnCanvas,
    save,
  };
}
