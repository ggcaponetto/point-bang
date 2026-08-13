// Smoke-level render tests: they prove the import graph and the load/save
// wiring, not the widget behavior — that logic lives in model.ts where it is
// unit-tested. Kept out of the coverage gate on purpose.

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { App } from "../src/App";
import "../src/i18n";

const CFG = {
  "//": "doc",
  buttons: [
    {
      id: "b0",
      label: "LEFT",
      action: "mouse:left",
      visible: true,
      rect: { x: 2, y: 30, w: 44, h: 30 },
    },
    { id: "b1", label: "B1", action: "", visible: false },
  ],
};

// RTL's auto-cleanup needs a GLOBAL afterEach, which vitest only provides
// with globals:true — register it explicitly instead.
afterEach(cleanup);

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(CFG), { status: 200 })),
  );
});

describe("App", () => {
  it("mounts, loads the config, and renders the canvas + save button", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText("LEFT")).toBeTruthy());
    expect(screen.getByRole("button", { name: /save|speichern|salva/i })).toBeTruthy();
  });
  it("lists a problem and disables save when the config is broken", async () => {
    const bad = { buttons: [{ id: "b0", action: "key:nope", visible: true }] };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(bad), { status: 200 })),
    );
    render(<App />);
    await waitFor(() =>
      expect(screen.getAllByText('button b0: unknown action "key:nope"').length).toBeGreaterThan(0),
    );
    const save = screen.getByRole("button", { name: /save|speichern|salva/i });
    expect((save as HTMLButtonElement).disabled).toBe(true);
  });
});
