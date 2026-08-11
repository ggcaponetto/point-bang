import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import http from "node:http";
import type { spawn as nodeSpawn } from "node:child_process";
import { pickTunnel, summarizeNgrokOutput, formatTunnelReport, startNgrok } from "../lib/tunnel.ts";

/** A stand-in for the ngrok agent process — nothing is ever really spawned. */
function fakeAgent() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: () => void;
    killed: boolean;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
  };
  const calls: { cmd: string; args: string[] }[] = [];
  const spawn = ((cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    return child;
  }) as unknown as typeof nodeSpawn;
  return { child, spawn, calls };
}

const api = (url: string, port: number, proto = "https") => ({
  tunnels: [{ public_url: url, proto, forwards_to: `http://localhost:${port}` }],
});

describe("pickTunnel", () => {
  it("finds the https endpoint forwarding to our port", () => {
    expect(pickTunnel(api("https://a.ngrok-free.app", 8443), 8443)).toBe(
      "https://a.ngrok-free.app",
    );
  });

  it("reads the older config.addr shape too", () => {
    const body = {
      tunnels: [
        { public_url: "https://b.app", proto: "https", config: { addr: "localhost:8443" } },
      ],
    };
    expect(pickTunnel(body, 8443)).toBe("https://b.app");
  });

  it("ignores http endpoints — WebXR needs a secure context", () => {
    expect(pickTunnel(api("http://a.ngrok-free.app", 8443, "http"), 8443)).toBeNull();
  });

  it("ignores tunnels for someone else's port", () => {
    expect(pickTunnel(api("https://a.app", 3000), 8443)).toBeNull();
    // A suffix match must not treat 84431 as 8443.
    expect(pickTunnel(api("https://a.app", 84431), 8443)).toBeNull();
  });

  it("survives anything the agent might return", () => {
    for (const junk of [null, undefined, {}, { tunnels: "nope" }, { tunnels: [{}] }, 42])
      expect(pickTunnel(junk, 8443)).toBeNull();
  });
});

describe("summarizeNgrokOutput", () => {
  it("surfaces the err field, which is where the real reason lives", () => {
    const lines = [
      JSON.stringify({ lvl: "info", msg: "starting" }),
      JSON.stringify({ lvl: "eror", msg: "failed to auth", err: "ERR_NGROK_105: bad authtoken" }),
    ];
    expect(summarizeNgrokOutput(lines)).toBe("ERR_NGROK_105: bad authtoken");
  });

  it("falls back to the message of error-level records, skipping chatter", () => {
    const lines = [
      JSON.stringify({ lvl: "info", msg: "started tunnel" }),
      JSON.stringify({ lvl: "crit", msg: "limited to 1 simultaneous session" }),
    ];
    expect(summarizeNgrokOutput(lines)).toBe("limited to 1 simultaneous session");
  });

  it("ignores err on non-error records — info carries them routinely", () => {
    // Verbatim from agent 3.39: benign, and naming it as the failure would lie.
    const noise = JSON.stringify({
      lvl: "info",
      msg: "ignoring default config path",
      err: "stat /home/u/.config/ngrok/ngrok.yml: no such file or directory",
    });
    expect(summarizeNgrokOutput([noise])).toBe("");
    expect(
      summarizeNgrokOutput([noise, JSON.stringify({ lvl: "crit", err: "real problem" })]),
    ).toBe("real problem");
  });

  it("flattens the multi-line errors the agent actually emits", () => {
    // Verbatim shape of a real ERR_NGROK_4018 payload, CRLF and all.
    const err =
      "authentication failed: This ngrok session is not authenticated.\n\n" +
      "Sign up for an account: https://dashboard.ngrok.com/signup\r\n\r\nERR_NGROK_4018\r\n";
    const summary = summarizeNgrokOutput([JSON.stringify({ lvl: "eror", err })]);
    expect(summary).not.toMatch(/[\r\n]/);
    expect(summary).toContain("ERR_NGROK_4018");
  });

  it("prefers the structured copy over the plain-text one repeated on stderr", () => {
    const lines = [
      JSON.stringify({ lvl: "crit", err: "authentication failed: ERR_NGROK_4018" }),
      "ERROR:  authentication failed",
      "ERROR:  https://ngrok.com/docs/errors/err_ngrok_4018",
    ];
    expect(summarizeNgrokOutput(lines)).toBe("authentication failed: ERR_NGROK_4018");
  });

  it("keeps non-JSON output when that is all there is — early crashes are not JSON", () => {
    expect(summarizeNgrokOutput(["ngrok: command failed", "  "])).toBe("ngrok: command failed");
  });

  it("dedupes and keeps only the tail, where the failure is", () => {
    const lines = ["a", "a", "b", "c"].map((m) => JSON.stringify({ lvl: "eror", msg: m }));
    expect(summarizeNgrokOutput(lines)).toBe("b; c");
  });

  it("truncates rather than dumping a wall of text into one log line", () => {
    const long = JSON.stringify({ lvl: "eror", err: "x".repeat(1000) });
    const summary = summarizeNgrokOutput([long]);
    expect(summary).toHaveLength(300);
    expect(summary.endsWith("...")).toBe(true);
  });

  it("says nothing when the agent said nothing useful", () => {
    expect(summarizeNgrokOutput([JSON.stringify({ lvl: "info", msg: "hi" })])).toBe("");
  });
});

describe("formatTunnelReport", () => {
  it("leads with the URL and warns about the interstitial and the latency", () => {
    const lines = formatTunnelReport("https://x.ngrok-free.app").join("\n");
    expect(lines).toContain("https://x.ngrok-free.app");
    expect(lines).toContain("Visit Site");
    expect(lines).toMatch(/latency/i);
  });

  it("explains the early exit when an agent was merely borrowed", () => {
    const spawned = formatTunnelReport("https://x.app", false).join("\n");
    const borrowed = formatTunnelReport("https://x.app", true).join("\n");
    expect(spawned).not.toMatch(/already running/);
    expect(borrowed).toMatch(/already running/);
    expect(borrowed).toMatch(/exits/);
  });

  it("says out loud that the exposed socket is unauthenticated", () => {
    // A public URL to a socket that moves the mouse must never be quiet.
    const lines = formatTunnelReport("https://x.ngrok-free.app").join("\n");
    expect(lines).toMatch(/unauthenticated/i);
    expect(lines).toMatch(/move your mouse/i);
  });
});

describe("startNgrok", () => {
  const noSleep = async () => {};

  it("adopts an agent that is already running instead of spawning a rival", async () => {
    const { spawn, calls } = fakeAgent();
    const t = await startNgrok(8443, {
      spawn,
      fetchJson: async () => api("https://live.ngrok-free.app", 8443),
      sleep: noSleep,
    });
    expect(t.url).toBe("https://live.ngrok-free.app");
    expect(t.adopted).toBe(true);
    expect(calls).toHaveLength(0);
    t.stop(); // no-op: we do not own that agent
  });

  it("spawns the agent with logging redirected, then reads the URL from its API", async () => {
    const { spawn, calls, child } = fakeAgent();
    let up = false;
    const t = await startNgrok(8443, {
      spawn,
      url: "https://mine.ngrok-free.app",
      sleep: async () => {
        up = true;
      },
      fetchJson: async () => {
        if (!up) throw new Error("connection refused");
        return api("https://new.ngrok-free.app", 8443);
      },
    });
    expect(calls[0].cmd).toBe("ngrok");
    expect(calls[0].args).toEqual([
      "http",
      "8443",
      "--log=stdout",
      "--log-format=json",
      "--url=https://mine.ngrok-free.app",
    ]);
    expect(t.url).toBe("https://new.ngrok-free.app");
    expect(t.adopted).toBe(false);
    t.stop();
    expect(child.killed).toBe(true);
  });

  it("explains how to install ngrok when the binary is missing", async () => {
    const { spawn, child } = fakeAgent();
    await expect(
      startNgrok(8443, {
        spawn,
        fetchJson: async () => null,
        sleep: async () => {
          child.emit("error", Object.assign(new Error("spawn ngrok ENOENT"), { code: "ENOENT" }));
        },
      }),
    ).rejects.toThrow(/not installed or not on PATH/);
  });

  it("reports the agent's own diagnosis when it dies", async () => {
    const { spawn, child } = fakeAgent();
    await expect(
      startNgrok(8443, {
        spawn,
        fetchJson: async () => null,
        sleep: async () => {
          child.stdout.emit(
            "data",
            JSON.stringify({ lvl: "eror", err: "ERR_NGROK_4018: authtoken required" }) + "\n",
          );
          child.emit("exit", 1);
        },
      }),
    ).rejects.toThrow(/ERR_NGROK_4018/);
  });

  it("gives up and kills the agent when no endpoint ever appears", async () => {
    const { spawn, child } = fakeAgent();
    await expect(
      startNgrok(8443, {
        spawn,
        fetchJson: async () => ({ tunnels: [] }),
        sleep: noSleep,
        timeoutMs: 30,
        pollMs: 10,
      }),
    ).rejects.toThrow(/no ngrok endpoint/);
    expect(child.killed).toBe(true);
  });

  it("talks to a real agent API over HTTP when no fetch is injected", async () => {
    // Stands in for the agent's inspector on 127.0.0.1:4040.
    const agent = http.createServer((req, res) => {
      if (req.url !== "/api/tunnels") {
        res.writeHead(500).end();
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(api("https://real.ngrok-free.app", 8443)));
    });
    const apiPort = await new Promise<number>((r) =>
      agent.listen(0, "127.0.0.1", () => r((agent.address() as { port: number }).port)),
    );
    try {
      const t = await startNgrok(8443, { apiPort, sleep: noSleep });
      expect(t.url).toBe("https://real.ngrok-free.app");
    } finally {
      await new Promise((r) => agent.close(r));
    }
  });

  it("treats a non-200 from the agent as 'not up yet', not as a URL", async () => {
    const agent = http.createServer((_req, res) => res.writeHead(502).end());
    const apiPort = await new Promise<number>((r) =>
      agent.listen(0, "127.0.0.1", () => r((agent.address() as { port: number }).port)),
    );
    const { spawn } = fakeAgent();
    try {
      await expect(
        startNgrok(8443, { apiPort, spawn, sleep: noSleep, timeoutMs: 20, pollMs: 10 }),
      ).rejects.toThrow(/no ngrok endpoint/);
    } finally {
      await new Promise((r) => agent.close(r));
    }
  });

  it("collects stderr as well as stdout, and survives a flood", async () => {
    const { spawn, child } = fakeAgent();
    await expect(
      startNgrok(8443, {
        spawn,
        fetchJson: async () => null,
        sleep: async () => {
          for (let i = 0; i < 300; i++) child.stdout.emit("data", `noise ${i}\n`);
          child.stderr.emit("data", "fatal: disk on fire\n");
          child.emit("exit", 2);
        },
      }),
    ).rejects.toThrow(/disk on fire/);
  });
});
