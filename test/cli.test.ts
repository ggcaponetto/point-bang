import { describe, it, expect, vi } from "vitest";
import { DEFAULT_PAGE_URL } from "../lib/qr.ts";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCli, buildParser, resolveAssets, type CliDeps } from "../lib/cli.ts";
import type { ServerOptions, RunningServer } from "../server.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, "..", "public");

/** Captures what the CLI would have booted, without booting anything. */
function spyDeps(extra: CliDeps = {}) {
  const logs: string[] = [];
  const errors: string[] = [];
  let opts: ServerOptions | null = null;
  const deps: CliDeps = {
    start: (async (o: ServerOptions) => {
      opts = o;
      // Echo the requested port as the bound one — post-bind consumers (adb)
      // must use the RESOLVED port, and this keeps their assertions natural.
      return { httpPort: o.port ?? 1, key: null, close: async () => {} } as RunningServer;
    }) as CliDeps["start"],
    log: (l) => logs.push(l),
    error: (l) => errors.push(l),
    adb: () => ({ ok: true, detail: "adb ok" }),
    appDir: "/app",
    env: {},
    ...extra,
  };
  return { deps, logs, errors, seen: () => opts as ServerOptions | null };
}

describe("serve defaults", () => {
  it("boots on 8443 with the default pause combo", async () => {
    const { deps, seen } = spyDeps();
    expect(await runCli([], deps)).toBe(0);
    const o = seen()!;
    expect(o.mode).toBe("all");
    expect(o.port).toBe(8443);
    // the default port may degrade to a free one when busy…
    expect(o.portFallback).toBe(true);
    expect(o.pauseCombo).toBe("shift+space");
  });

  it("treats a bare invocation and an explicit `serve` identically", async () => {
    const bare = spyDeps();
    const explicit = spyDeps();
    await runCli([], bare.deps);
    await runCli(["serve"], explicit.deps);
    expect(bare.seen()!.port).toBe(explicit.seen()!.port);
  });
});

describe("serve flags", () => {
  it("accepts every option, long form", async () => {
    const { deps, seen } = spyDeps();
    await runCli(
      [
        "serve",
        "--mode",
        "wifi",
        "--port",
        "9000",
        "--pause-combo",
        "ctrl+f9",
        "--buttons",
        "/b.json",
      ],
      deps,
    );
    const o = seen()!;
    expect(o).toMatchObject({
      mode: "wifi",
      port: 9000,
      // …but an explicitly pinned one refuses instead of moving
      portFallback: false,
      pauseCombo: "ctrl+f9",
      buttonsFile: "/b.json",
    });
  });

  it("passes --input and a parsed --screen through to the server", async () => {
    const { deps, seen } = spyDeps();
    await runCli(["--input", "none", "--screen", "2560x1440"], deps);
    expect(seen()).toMatchObject({ input: "none", screen: { w: 2560, h: 1440 } });
  });

  it("defaults to auto input and no assumed screen", async () => {
    const { deps, seen } = spyDeps();
    await runCli([], deps);
    expect(seen()!.input).toBe("auto");
    expect(seen()!.screen).toBeUndefined();
  });

  it.each([
    ["--screen", "huge"],
    ["--monitor", "leftmost"],
    ["--key", "way too short"],
  ])("refuses an unparsable %s instead of booting with a guess", async (flag, value) => {
    const { deps, errors, seen } = spyDeps();
    expect(await runCli([flag, value], deps)).toBe(1);
    expect(errors.join("\n")).toContain(flag);
    expect(seen()).toBeNull();
  });

  it("parses --monitor and defaults it to primary", async () => {
    const dflt = spyDeps();
    await runCli([], dflt.deps);
    expect(dflt.seen()!.monitor).toEqual({ kind: "primary" });

    const idx = spyDeps();
    await runCli(["--monitor", "2"], idx.deps);
    expect(idx.seen()!.monitor).toEqual({ kind: "index", index: 2 });

    const all = spyDeps();
    await runCli(["--monitor", "all"], all.deps);
    expect(all.seen()!.monitor).toEqual({ kind: "all" });
  });

  it("supports the -m/-p short flags", async () => {
    const { deps, seen } = spyDeps();
    await runCli(["-m", "adb", "-p", "1234"], deps);
    expect(seen()).toMatchObject({ mode: "adb", port: 1234 });
  });

  it("generates a session key by default, loopback exempt", async () => {
    const { deps, seen } = spyDeps();
    await runCli([], deps);
    expect(seen()!.key).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(seen()!.keyLoopbackExempt).toBe(true);
  });

  it("--key off disables the gate; an explicit key passes through", async () => {
    const off = spyDeps();
    await runCli(["--key", "off"], off.deps);
    expect(off.seen()!.key).toBeNull();
    const fixed = spyDeps();
    await runCli(["--key", "my-fixed-key.01"], fixed.deps);
    expect(fixed.seen()!.key).toBe("my-fixed-key.01");
  });

  it("runs adb reverse only in adb mode, on the port the server BOUND", async () => {
    const ports: number[] = [];
    const adb = (p: number) => {
      ports.push(p);
      return { ok: true, detail: `adb ${p}` };
    };
    const { deps, logs } = spyDeps({ adb });
    await runCli(["--mode", "adb", "--port", "7000"], deps);
    expect(ports).toEqual([7000]); // spyDeps echoes the requested port back
    expect(logs).toContain("adb 7000");

    // busy-port fallback: the server bound elsewhere — adb must follow it
    const fell = spyDeps({
      adb,
      start: (async () => ({ httpPort: 9999, httpsPort: null, close: async () => {} })) as never,
    });
    await runCli(["--mode", "adb"], fell.deps);
    expect(ports).toEqual([7000, 9999]);

    // a server that never bound must not get an adb mapping
    const dead = spyDeps({
      adb,
      start: (async () => {
        throw new Error("nope");
      }) as never,
    });
    await runCli(["--mode", "adb"], dead.deps);
    expect(ports).toEqual([7000, 9999]);

    const wifi = spyDeps({ adb });
    await runCli(["--mode", "wifi"], wifi.deps);
    expect(wifi.logs.some((l) => l.startsWith("adb"))).toBe(false);
  });

  it("rejects unknown flags and invalid modes instead of ignoring them", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);
    const { deps } = spyDeps();
    await expect(runCli(["--nope"], deps)).rejects.toThrow();
    await expect(runCli(["--mode", "warp"], deps)).rejects.toThrow();
    err.mockRestore();
    exit.mockRestore();
  });
});

describe("public tunnel", () => {
  /** Captures the tunnel request without ever spawning an agent. */
  function tunnelDeps(behaviour: "ok" | "fail" = "ok") {
    const asked: { port: number; url?: string }[] = [];
    const stops: number[] = [];
    let shutdown: (() => void) | null = null;
    const deps: CliDeps = {
      tunnel: (async (port: number, o: { url?: string } = {}) => {
        asked.push({ port, url: o.url });
        if (behaviour === "fail") throw new Error("ERR_NGROK_4018: authtoken required");
        return { url: "https://x.ngrok-free.app", adopted: false, stop: () => stops.push(1) };
      }) as CliDeps["tunnel"],
      onShutdown: (fn) => {
        shutdown = fn;
      },
    };
    return { deps, asked, stops, fire: () => shutdown?.() };
  }

  it("stays off unless asked", async () => {
    const t = tunnelDeps();
    const { deps } = spyDeps(t.deps);
    await runCli([], deps);
    expect(t.asked).toHaveLength(0);
  });

  it("tunnels the port the server actually bound, and prints how to use it", async () => {
    const t = tunnelDeps();
    const { deps, logs } = spyDeps({
      ...t.deps,
      // The bound port, not the requested one — :0 and a busy port both differ.
      start: (async () => ({ httpPort: 12345, httpsPort: null, close: async () => {} })) as never,
    });
    expect(
      await runCli(["--tunnel", "ngrok", "--tunnel-url", "https://mine.ngrok-free.app"], deps),
    ).toBe(0);
    expect(t.asked).toEqual([{ port: 12345, url: "https://mine.ngrok-free.app" }]);
    expect(logs.join("\n")).toContain("https://x.ngrok-free.app");
  });

  it("kills the agent on shutdown — it does not die with its parent", async () => {
    const t = tunnelDeps();
    const { deps } = spyDeps(t.deps);
    await runCli(["--tunnel", "ngrok"], deps);
    t.fire();
    expect(t.stops).toHaveLength(1);
  });

  it("drops the loopback exemption — ngrok forwards the internet to loopback", async () => {
    const t = tunnelDeps();
    const { deps, seen } = spyDeps(t.deps);
    await runCli(["--tunnel", "ngrok"], deps);
    expect(seen()!.keyLoopbackExempt).toBe(false);
    const plain = spyDeps();
    await runCli([], plain.deps);
    expect(plain.seen()!.keyLoopbackExempt).toBe(true);
  });

  it("prints the tunnel URL with the server's session key in the fragment", async () => {
    const t = tunnelDeps();
    const { deps, logs } = spyDeps({
      ...t.deps,
      start: (async () => ({
        httpPort: 12345,
        httpsPort: null,
        key: "abc123-XY",
        close: async () => {},
      })) as never,
    });
    await runCli(["--tunnel", "ngrok"], deps);
    expect(logs.join("\n")).toContain("https://x.ngrok-free.app#key=abc123-XY");
  });

  it("keeps serving when the tunnel fails, and says why", async () => {
    const t = tunnelDeps("fail");
    const { deps, errors } = spyDeps(t.deps);
    expect(await runCli(["--tunnel", "ngrok"], deps)).toBe(0);
    expect(errors.join("\n")).toContain("ERR_NGROK_4018");
    expect(errors.join("\n")).toContain("serving anyway");
  });
});

describe("tunnel command", () => {
  /** As above, but for the standalone command — still no agent is spawned. */
  function tunnelDeps(behaviour: "ok" | "adopt" | "fail" = "ok") {
    const asked: { port: number; url?: string }[] = [];
    const stops: number[] = [];
    let shutdown: (() => void) | null = null;
    const deps: CliDeps = {
      tunnel: (async (port: number, o: { url?: string } = {}) => {
        asked.push({ port, url: o.url });
        if (behaviour === "fail") throw new Error("ngrok is not installed");
        return {
          url: "https://y.ngrok-free.app",
          adopted: behaviour === "adopt",
          stop: () => stops.push(1),
        };
      }) as CliDeps["tunnel"],
      onShutdown: (fn) => {
        shutdown = fn;
      },
      // A tunnel must never boot a server as a side effect.
      start: (async () => {
        throw new Error("the tunnel command must not start a server");
      }) as CliDeps["start"],
    };
    return { deps, asked, stops, fire: () => shutdown?.() };
  }

  it("exposes the default port without touching the server", async () => {
    const t = tunnelDeps();
    const { deps, logs } = spyDeps(t.deps);
    expect(await runCli(["tunnel"], deps)).toBe(0);
    expect(t.asked).toEqual([{ port: 8443, url: undefined }]);
    expect(logs.join("\n")).toContain("https://y.ngrok-free.app");
    // it cannot know the server's key — say so instead of implying safety
    expect(logs.join("\n")).toContain("will NOT require its session key");
  });

  it("takes --port and --url, and honours PORT so it matches a running serve", async () => {
    const explicit = tunnelDeps();
    await runCli(
      ["tunnel", "--port", "9000", "--url", "https://mine.ngrok-free.app"],
      spyDeps(explicit.deps).deps,
    );
    expect(explicit.asked).toEqual([{ port: 9000, url: "https://mine.ngrok-free.app" }]);

    const fromEnv = tunnelDeps();
    await runCli(["tunnel"], spyDeps({ ...fromEnv.deps, env: { PORT: "8000" } }).deps);
    expect(fromEnv.asked[0].port).toBe(8000);
  });

  it("kills the agent it started when interrupted", async () => {
    const t = tunnelDeps();
    await runCli(["tunnel"], spyDeps(t.deps).deps);
    t.fire();
    expect(t.stops).toHaveLength(1);
  });

  it("explains itself when it borrows an agent and therefore exits at once", async () => {
    const t = tunnelDeps("adopt");
    const { deps, logs } = spyDeps(t.deps);
    expect(await runCli(["tunnel"], deps)).toBe(0);
    expect(logs.join("\n")).toMatch(/already running/);
  });

  it("fails the command when the tunnel fails — here it is the whole job", async () => {
    const t = tunnelDeps("fail");
    const { deps, errors } = spyDeps(t.deps);
    expect(await runCli(["tunnel"], deps)).toBe(1);
    expect(errors.join("\n")).toContain("not installed");
  });
});

describe("environment fallbacks", () => {
  it("honours PORT/PAUSE_COMBO when no flag is given", async () => {
    const { deps, seen } = spyDeps({
      env: { PORT: "8000", PAUSE_COMBO: "alt+p" },
    });
    await runCli([], deps);
    expect(seen()).toMatchObject({
      port: 8000,
      // env-pinned counts as explicit: busy = refuse, never silently move
      portFallback: false,
      pauseCombo: "alt+p",
    });
  });

  it("lets an explicit flag win over the environment", async () => {
    const { deps, seen } = spyDeps({ env: { PORT: "8000" } });
    await runCli(["--port", "9999"], deps);
    expect(seen()!.port).toBe(9999);
  });

  it("ignores non-numeric environment values rather than passing NaN down", async () => {
    const { deps, seen } = spyDeps({ env: { PORT: "banana" } });
    await runCli([], deps);
    expect(seen()!.port).toBe(8443);
  });
});

describe("other commands", () => {
  it("ip prints one line per LAN address", async () => {
    const { deps, logs } = spyDeps();
    expect(await runCli(["ip"], deps)).toBe(0);
    expect(logs.every((l) => typeof l === "string")).toBe(true);
  });

  it("wifi reports through the platform probe and returns its exit code", async () => {
    const { deps, logs } = spyDeps({
      platform: "linux",
      exec: () => "yes:CasaMia:100:5500 MHz:78",
    });
    expect(await runCli(["wifi"], deps)).toBe(0);
    expect(logs[0]).toBe("SSID:    CasaMia");
  });

  it("check validates the real public/ files", async () => {
    // loadNative is injected: the suite must never touch a real input device.
    const { deps, logs } = spyDeps({
      loadNative: async () => ({ getScreenSize: () => ({ width: 800, height: 600 }) }) as never,
      env: { DISPLAY: ":0" },
    });
    const code = await runCli(["check", "--public", PUBLIC], deps);
    expect(code).toBe(0);
    expect(logs.some((l) => l.startsWith("asset index.html"))).toBe(true);
    expect(logs).toContain("input: ready — screen 800x600");
  });
});

describe("failure handling", () => {
  it("returns 1 and reports when the server cannot start", async () => {
    const { deps, errors } = spyDeps({
      start: (async () => {
        throw new Error("EADDRINUSE");
      }) as CliDeps["start"],
    });
    expect(await runCli([], deps)).toBe(1);
    expect(errors.join("\n")).toContain("EADDRINUSE");
  });

  it("prints a busy pinned port as one line, not a stack trace", async () => {
    const { deps, errors } = spyDeps({
      start: (async () => {
        throw Object.assign(new Error("port 9000 (http) is already in use — is another …"), {
          code: "EADDRINUSE",
        });
      }) as CliDeps["start"],
    });
    expect(await runCli(["--port", "9000"], deps)).toBe(1);
    expect(errors.join("\n")).toContain("already in use");
    expect(errors.join("\n")).not.toContain(" at "); // no stack frames
  });
});

describe("default dependencies", () => {
  it("falls back to the console and the real process environment", async () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    // No log/env/platform/exec injected: every default path is exercised.
    expect(await runCli(["ip"], {})).toBe(0);
    expect(out).toHaveBeenCalled();
    out.mockRestore();
  });
});

describe("monitors command", () => {
  it("lists monitors through the injected seams and exits 0", async () => {
    const { deps, logs } = spyDeps({
      platform: "linux",
      exec: () => "eDP-1 connected primary 1920x1080+0+0 (normal)",
    });
    expect(await runCli(["monitors"], deps)).toBe(0);
    expect(logs[0]).toContain("eDP-1");
    expect(logs.join("\n")).toContain("--monitor all");
  });

  it("exits 1 with the reason when nothing is detected", async () => {
    const { deps, logs } = spyDeps({
      platform: "linux",
      exec: () => {
        throw new Error("xrandr: not found");
      },
    });
    expect(await runCli(["monitors"], deps)).toBe(1);
    expect(logs.join("\n")).toContain("xrandr unavailable");
  });
});

describe("buildParser", () => {
  it("documents every command in --help", async () => {
    const help = await buildParser([], {}).getHelp();
    for (const cmd of ["serve", "tunnel", "ip", "wifi", "monitors", "check"])
      expect(help).toContain(cmd);
  });
});

describe("resolveAssets", () => {
  it("prefers an explicit --public directory over everything", async () => {
    const src = resolveAssets({ isSea: true, getAsset: () => new ArrayBuffer(0) }, PUBLIC);
    expect((await src.read("math.js"))?.length).toBeGreaterThan(0);
  });
  it("reads embedded assets when running as a single executable", async () => {
    const src = resolveAssets({
      isSea: true,
      getAsset: (k) => new TextEncoder().encode(`asset:${k}`).buffer as ArrayBuffer,
    });
    expect((await src.read("index.html"))?.toString()).toBe("asset:index.html");
  });
  it("falls back to public/ next to the program", async () => {
    const src = resolveAssets({}, undefined, path.join(HERE, ".."));
    expect((await src.read("index.html"))?.toString()).toContain("Lightgun");
  });
});

describe("setup QR flags", () => {
  it("defaults to the hosted page", async () => {
    const { deps, seen } = spyDeps();
    await runCli([], deps);
    expect(seen()!.pageUrl).toBe(DEFAULT_PAGE_URL);
  });

  it("--page-url passes through", async () => {
    const { deps, seen } = spyDeps();
    await runCli(["--page-url", "https://my.site/phone/"], deps);
    expect(seen()!.pageUrl).toBe("https://my.site/phone/");
  });
});
