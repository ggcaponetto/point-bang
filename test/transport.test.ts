import { describe, it, expect } from "vitest";
import {
  parseFragment,
  buttonsUrl,
  fetchButtons,
  fetchMonitors,
  exchangeOffer,
  parseServerMessage,
  createTransport,
} from "../public/transport.js";

const until = async (cond: () => boolean, ms = 2000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 5));
  }
};

// Tight timings so ladders/backoffs run in milliseconds under test.
const TIMES = {
  gatherMs: 20,
  offerMs: 50,
  openMs: 60,
  localOpenMs: 60,
  retryMs: [10, 20],
  wsRetryMs: 10,
};

class FakeChannel {
  readyState = "connecting";
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  sent: string[] = [];
  opts: unknown;
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.readyState = "closed";
    this.onclose?.();
  }
  open() {
    this.readyState = "open";
    this.onopen?.();
  }
}

class FakePeer {
  static instances: FakePeer[] = [];
  iceGatheringState = "complete";
  onicegatheringstatechange: (() => void) | null = null;
  connectionState = "new";
  onconnectionstatechange: (() => void) | null = null;
  localDescription: { sdp: string } | null = null;
  channel = new FakeChannel();
  closed = false;
  remote: unknown = null;
  constructor() {
    FakePeer.instances.push(this);
  }
  createDataChannel(_label: string, opts: unknown) {
    this.channel.opts = opts;
    return this.channel;
  }
  async createOffer() {
    return { type: "offer", sdp: "offer-sdp" };
  }
  async setLocalDescription(d: { sdp?: string }) {
    this.localDescription = { sdp: d.sdp ?? "" };
  }
  async setRemoteDescription(d: unknown) {
    this.remote = d;
    // an accepted answer opens the channel on the next tick, like real ICE
    setTimeout(() => this.channel.open(), 1);
  }
  close() {
    this.closed = true;
  }
}

class FakeSocket {
  static instances: FakeSocket[] = [];
  static failNext = false;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  sent: string[] = [];
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
    setTimeout(() => {
      if (FakeSocket.failNext) {
        FakeSocket.failNext = false;
        this.onclose?.();
      } else {
        this.onopen?.();
      }
    }, 1);
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.onclose?.();
  }
}

/** fetch stub answering /rtc/offer; per-URL failures via `fail`. */
function fakeFetch(fail: (url: string) => boolean = () => false) {
  const calls: { url: string; init: Record<string, unknown> }[] = [];
  const fn = async (url: string, init: Record<string, unknown>) => {
    calls.push({ url, init });
    if (fail(url)) throw new Error("unreachable");
    return {
      ok: true,
      status: 200,
      json: async () => ({ sdp: "answer-sdp" }),
    };
  };
  return { fn, calls };
}

const fresh = () => {
  FakePeer.instances = [];
  FakeSocket.instances = [];
  FakeSocket.failNext = false;
};

function transport(opts: {
  hosts: string[];
  key?: string | null;
  fetchFn: (url: string, init: Record<string, unknown>) => Promise<never> | Promise<unknown>;
  onStatus?: (s: string, d?: string) => void;
  onMessage?: (m: { type: "buttons"; rev: number }) => void;
}) {
  return createTransport({
    hosts: opts.hosts,
    key: opts.key,
    wsUrl: "ws://same.origin:8443",
    fetchFn: opts.fetchFn as never,
    Peer: FakePeer as never,
    Socket: FakeSocket as never,
    onStatus: opts.onStatus as never,
    onMessage: opts.onMessage,
    times: TIMES,
  });
}

describe("parseFragment", () => {
  it("reads a host list", () => {
    expect(parseFragment("#pc=192.168.1.5:8443,10.0.0.3:9000")).toEqual({
      hosts: ["192.168.1.5:8443", "10.0.0.3:9000"],
      key: null,
    });
  });
  it("returns no hosts for an empty/missing/foreign fragment", () => {
    expect(parseFragment("")).toEqual({ hosts: [], key: null });
    expect(parseFragment("#")).toEqual({ hosts: [], key: null });
    expect(parseFragment("#x=y")).toEqual({ hosts: [], key: null });
    expect(parseFragment(undefined as never)).toEqual({ hosts: [], key: null });
  });
  it("drops garbage entries but keeps valid ones", () => {
    expect(parseFragment("#pc=nope,192.168.1.5:8443,evil/path:80,:1,h:99999")).toEqual({
      hosts: ["192.168.1.5:8443"],
      key: null,
    });
  });
  it("accepts bracketed IPv6", () => {
    expect(parseFragment("#pc=[fe80::1]:8443")).toEqual({ hosts: ["[fe80::1]:8443"], key: null });
  });
  it("reads the session key, with or without hosts", () => {
    expect(parseFragment("#pc=192.168.1.5:8443&key=abc123-XY")).toEqual({
      hosts: ["192.168.1.5:8443"],
      key: "abc123-XY",
    });
    // the printed localhost/mkcert URLs carry only the key
    expect(parseFragment("#key=abc123-XY")).toEqual({ hosts: [], key: "abc123-XY" });
  });
  it("drops a malformed key rather than sending junk", () => {
    expect(parseFragment("#key=too+short").key).toBeNull();
    expect(parseFragment("#key=has spaces in it").key).toBeNull();
    expect(parseFragment(`#key=${"x".repeat(129)}`).key).toBeNull();
  });
});

describe("buttonsUrl / fetchButtons", () => {
  it("targets the connected PC, else the first QR host, else the page origin", () => {
    expect(buttonsUrl(["a:1", "b:2"], "b:2")).toBe("http://b:2/buttons.json");
    expect(buttonsUrl(["a:1", "b:2"])).toBe("http://a:1/buttons.json");
    expect(buttonsUrl([])).toBe("./buttons.json");
  });

  it("remote: fetches from the PC with the LNA marker", async () => {
    const f = fakeFetch();
    await fetchButtons(["a:1"], f.fn as never);
    expect(f.calls[0].url).toBe("http://a:1/buttons.json");
    expect(f.calls[0].init.targetAddressSpace).toBe("local");
  });

  it("remote: falls back to the bundled copy when the PC is unreachable", async () => {
    const f = fakeFetch((url) => url.startsWith("http://"));
    await fetchButtons(["a:1"], f.fn as never);
    expect(f.calls.map((c) => c.url)).toEqual(["http://a:1/buttons.json", "./buttons.json"]);
  });

  it("local: goes straight to the page origin", async () => {
    const f = fakeFetch();
    await fetchButtons([], f.fn as never);
    expect(f.calls.map((c) => c.url)).toEqual(["./buttons.json"]);
  });
});

describe("fetchMonitors", () => {
  const TARGETS = { monitors: [{ i: 1, label: "D1", w: 1920, h: 1080, primary: true }] };
  const monitorsFetch = (body: unknown = TARGETS, status = 200) => {
    const calls: { url: string; init: Record<string, unknown> }[] = [];
    const fn = async (url: string, init: Record<string, unknown>) => {
      calls.push({ url, init });
      return { ok: status === 200, status, json: async () => body };
    };
    return { fn, calls };
  };

  it("remote: asks the PC with the LNA marker and returns the target list", async () => {
    const f = monitorsFetch();
    const targets = await fetchMonitors(["a:1"], f.fn as never, "a:1");
    expect(f.calls[0].url).toBe("http://a:1/monitors");
    expect(f.calls[0].init.targetAddressSpace).toBe("local");
    expect(targets).toEqual(TARGETS.monitors);
  });

  it("local: asks the page origin without the LNA marker", async () => {
    const f = monitorsFetch();
    await fetchMonitors([], f.fn as never);
    expect(f.calls[0].url).toBe("./monitors");
    expect(f.calls[0].init).toEqual({});
  });

  it("returns null on 404 (old server), garbage body, empty list, or network error", async () => {
    expect(await fetchMonitors(["a:1"], monitorsFetch(TARGETS, 404).fn as never)).toBeNull();
    expect(await fetchMonitors(["a:1"], monitorsFetch({ nope: 1 }).fn as never)).toBeNull();
    expect(await fetchMonitors(["a:1"], monitorsFetch({ monitors: [] }).fn as never)).toBeNull();
    const dead = async () => {
      throw new Error("unreachable");
    };
    expect(await fetchMonitors(["a:1"], dead as never)).toBeNull();
  });
});

describe("exchangeOffer", () => {
  it("POSTs the offer and returns the answer sdp", async () => {
    const f = fakeFetch();
    const sdp = await exchangeOffer("http://a:1/rtc/offer", "my-offer", f.fn as never, {
      crossOrigin: true,
      timeoutMs: 100,
    });
    expect(sdp).toBe("answer-sdp");
    const { init } = f.calls[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ sdp: "my-offer" });
    expect(init.targetAddressSpace).toBe("local");
  });

  it("omits the LNA marker on same-origin requests", async () => {
    const f = fakeFetch();
    await exchangeOffer("/rtc/offer", "o", f.fn as never, { crossOrigin: false, timeoutMs: 100 });
    expect("targetAddressSpace" in f.calls[0].init).toBe(false);
  });

  it("throws on non-200 and on an answer without sdp", async () => {
    const bad = async () => ({ ok: false, status: 403, json: async () => ({}) });
    await expect(
      exchangeOffer("/rtc/offer", "o", bad as never, { crossOrigin: false, timeoutMs: 100 }),
    ).rejects.toThrow("HTTP 403");
    const empty = async () => ({ ok: true, status: 200, json: async () => ({}) });
    await expect(
      exchangeOffer("/rtc/offer", "o", empty as never, { crossOrigin: false, timeoutMs: 100 }),
    ).rejects.toThrow("no sdp");
  });

  it("sends the session key in the body when given one", async () => {
    const f = fakeFetch();
    await exchangeOffer("http://a:1/rtc/offer", "my-offer", f.fn as never, {
      crossOrigin: true,
      timeoutMs: 100,
      key: "abc123-XY",
    });
    expect(JSON.parse(f.calls[0].init.body as string)).toEqual({
      sdp: "my-offer",
      key: "abc123-XY",
    });
  });

  it("aborts through the signal after timeoutMs", async () => {
    const hang = (_url: string, init: { signal: AbortSignal }) =>
      new Promise((_, reject) =>
        init.signal.addEventListener("abort", () => reject(new Error("aborted"))),
      );
    await expect(
      exchangeOffer("/rtc/offer", "o", hang as never, { crossOrigin: false, timeoutMs: 10 }),
    ).rejects.toThrow("aborted");
  });
});

describe("parseServerMessage", () => {
  it("parses the buttons push and normalizes a broken rev to 0", () => {
    expect(parseServerMessage('{"type":"buttons","rev":3}')).toEqual({ type: "buttons", rev: 3 });
    expect(parseServerMessage('{"type":"buttons"}')).toEqual({ type: "buttons", rev: 0 });
    expect(parseServerMessage('{"type":"buttons","rev":"x"}')).toEqual({ type: "buttons", rev: 0 });
  });
  it("nulls everything else — garbage, unknown types, binary frames", () => {
    expect(parseServerMessage("{{{ nope")).toBeNull();
    expect(parseServerMessage('"buttons"')).toBeNull();
    expect(parseServerMessage("null")).toBeNull();
    expect(parseServerMessage('{"type":"aim","u":0.5,"v":0.5}')).toBeNull();
    expect(parseServerMessage(Buffer.from("x"))).toBeNull();
  });
});

describe("createTransport — server pushes (onMessage)", () => {
  it("delivers pushes arriving over the DataChannel, dropping garbage", async () => {
    fresh();
    const status: string[] = [];
    const pushes: { rev: number }[] = [];
    const t = transport({
      hosts: ["a:1"],
      fetchFn: fakeFetch().fn,
      onStatus: (s) => status.push(s),
      onMessage: (m) => pushes.push(m),
    });
    await until(() => status.includes("rtc"));
    const dc = FakePeer.instances[0].channel;
    dc.onmessage?.({ data: "{{{ garbage" });
    dc.onmessage?.({ data: '{"type":"buttons","rev":1}' });
    expect(pushes).toEqual([{ type: "buttons", rev: 1 }]);
    t.close();
  });

  it("delivers pushes arriving over the WS fallback", async () => {
    fresh();
    const status: string[] = [];
    const pushes: { rev: number }[] = [];
    const t = transport({
      hosts: [],
      fetchFn: fakeFetch(() => true).fn, // RTC signaling fails → WS
      onStatus: (s) => status.push(s),
      onMessage: (m) => pushes.push(m),
    });
    await until(() => status.includes("ws"));
    FakeSocket.instances[0].onmessage?.({ data: '{"type":"buttons","rev":2}' });
    expect(pushes).toEqual([{ type: "buttons", rev: 2 }]);
    t.close();
  });
});

describe("createTransport — remote mode (QR / hosted page)", () => {
  it("connects to the first host: LNA fetch, unordered channel, status rtc", async () => {
    fresh();
    const f = fakeFetch();
    const status: string[] = [];
    const t = transport({ hosts: ["a:1", "b:2"], fetchFn: f.fn, onStatus: (s) => status.push(s) });
    await until(() => status.includes("rtc"));
    expect(f.calls[0].url).toBe("http://a:1/rtc/offer");
    expect(f.calls[0].init.targetAddressSpace).toBe("local");
    expect(FakePeer.instances[0].channel.opts).toEqual({ ordered: false, maxRetransmits: 0 });
    expect(t.connectedHost()).toBe("a:1");
    t.send({ type: "fire" });
    expect(FakePeer.instances[0].channel.sent).toEqual(['{"type":"fire"}']);
    expect(FakeSocket.instances).toHaveLength(0); // never a WS in remote mode
    t.close();
    expect(FakePeer.instances[0].closed).toBe(true);
  });

  it("walks the host list in order when the first is unreachable", async () => {
    fresh();
    const f = fakeFetch((url) => url.includes("a:1"));
    const status: string[] = [];
    const t = transport({ hosts: ["a:1", "b:2"], fetchFn: f.fn, onStatus: (s) => status.push(s) });
    await until(() => status.includes("rtc"));
    expect(f.calls.map((c) => c.url)).toEqual(["http://a:1/rtc/offer", "http://b:2/rtc/offer"]);
    expect(t.connectedHost()).toBe("b:2");
    t.close();
  });

  it("reports an actionable failure, backs off, then recovers — never touching WS", async () => {
    fresh();
    let reachable = false;
    const f = fakeFetch(() => !reachable);
    const status: [string, string?][] = [];
    const t = transport({
      hosts: ["a:1"],
      fetchFn: f.fn,
      onStatus: (s, d) => status.push([s, d]),
    });
    await until(() => status.some(([s]) => s === "failed"));
    const fail = status.find(([s]) => s === "failed")!;
    expect(fail[1]).toContain("a:1");
    expect(fail[1]).toContain("same WiFi");
    reachable = true;
    await until(() => status.some(([s]) => s === "rtc"));
    expect(FakeSocket.instances).toHaveLength(0);
    t.close();
  });

  it("a dropped channel goes back to connecting, then reconnects", async () => {
    fresh();
    const f = fakeFetch();
    const status: string[] = [];
    const t = transport({ hosts: ["a:1"], fetchFn: f.fn, onStatus: (s) => status.push(s) });
    await until(() => status.includes("rtc"));
    FakePeer.instances[0].channel.close();
    await until(() => status.filter((s) => s === "rtc").length >= 2);
    expect(status).toContain("closed");
    t.close();
  });

  it("presents the fragment key on every signaling attempt", async () => {
    fresh();
    const f = fakeFetch();
    const status: string[] = [];
    const t = transport({
      hosts: ["a:1"],
      key: "abc123-XY",
      fetchFn: f.fn,
      onStatus: (s) => status.push(s),
    });
    await until(() => status.includes("rtc"));
    expect(JSON.parse(f.calls[0].init.body as string).key).toBe("abc123-XY");
    t.close();
  });

  it("close() during backoff stops the retry loop", async () => {
    fresh();
    const f = fakeFetch(() => true);
    const status: string[] = [];
    const t = transport({ hosts: ["a:1"], fetchFn: f.fn, onStatus: (s) => status.push(s) });
    await until(() => status.includes("failed"));
    t.close();
    const callsAtClose = f.calls.length;
    await new Promise((r) => setTimeout(r, 80));
    expect(f.calls).toHaveLength(callsAtClose);
  });
});

describe("createTransport — local mode (page served by the PC)", () => {
  it("tries RTC first via a same-origin fetch, no LNA marker", async () => {
    fresh();
    const f = fakeFetch();
    const status: string[] = [];
    const t = transport({ hosts: [], fetchFn: f.fn, onStatus: (s) => status.push(s) });
    await until(() => status.includes("rtc"));
    expect(f.calls[0].url).toBe("/rtc/offer");
    expect("targetAddressSpace" in f.calls[0].init).toBe(false);
    expect(t.connectedHost()).toBeNull();
    t.close();
  });

  it("falls back to WS when signaling fails, and sends over it", async () => {
    fresh();
    const f = fakeFetch(() => true);
    const status: string[] = [];
    const t = transport({ hosts: [], fetchFn: f.fn, onStatus: (s) => status.push(s) });
    await until(() => status.includes("ws"));
    expect(FakeSocket.instances[0].url).toBe("ws://same.origin:8443");
    t.send({ type: "fire" });
    expect(FakeSocket.instances[0].sent).toEqual(['{"type":"fire"}']);
    t.close();
  });

  it("carries the key into the WS fallback URL as a query param", async () => {
    fresh();
    const f = fakeFetch(() => true);
    const status: string[] = [];
    const t = transport({
      hosts: [],
      key: "abc123-XY",
      fetchFn: f.fn,
      onStatus: (s) => status.push(s),
    });
    await until(() => status.includes("ws"));
    expect(FakeSocket.instances[0].url).toBe("ws://same.origin:8443/?key=abc123-XY");
    expect(JSON.parse(f.calls[0].init.body as string).key).toBe("abc123-XY");
    t.close();
  });

  it("a WS drop restarts the ladder RTC-first", async () => {
    fresh();
    let rtcWorks = false;
    const f = fakeFetch(() => !rtcWorks);
    const status: string[] = [];
    const t = transport({ hosts: [], fetchFn: f.fn, onStatus: (s) => status.push(s) });
    await until(() => status.includes("ws"));
    const rtcTriesBefore = f.calls.length;
    rtcWorks = true;
    FakeSocket.instances[0].close(); // drop the socket
    await until(() => status.includes("rtc"));
    expect(f.calls.length).toBeGreaterThan(rtcTriesBefore); // RTC retried before anything else
    t.close();
  });

  it("waits for phone-side ICE gathering before signaling", async () => {
    fresh();
    class SlowGatherPeer extends FakePeer {
      override iceGatheringState = "gathering";
      override async setLocalDescription(d: { sdp?: string }) {
        await super.setLocalDescription(d);
        setTimeout(() => {
          this.iceGatheringState = "complete";
          this.onicegatheringstatechange?.();
        }, 3);
      }
    }
    const f = fakeFetch();
    const status: string[] = [];
    const t = createTransport({
      hosts: [],
      wsUrl: "ws://same.origin:8443",
      fetchFn: f.fn as never,
      Peer: SlowGatherPeer as never,
      Socket: FakeSocket as never,
      onStatus: ((s: string) => status.push(s)) as never,
      times: TIMES,
    });
    await until(() => status.includes("rtc"));
    expect(f.calls[0].url).toBe("/rtc/offer"); // offer only went out after gathering
    t.close();
  });

  it("falls back to WS when the connection dies before the channel opens", async () => {
    fresh();
    class DyingPeer extends FakePeer {
      override async setRemoteDescription(d: unknown) {
        this.remote = d;
        setTimeout(() => {
          this.connectionState = "failed";
          this.onconnectionstatechange?.();
        }, 1);
      }
    }
    const f = fakeFetch();
    const status: string[] = [];
    const t = createTransport({
      hosts: [],
      wsUrl: "ws://same.origin:8443",
      fetchFn: f.fn as never,
      Peer: DyingPeer as never,
      Socket: FakeSocket as never,
      onStatus: ((s: string) => status.push(s)) as never,
      times: TIMES,
    });
    await until(() => status.includes("ws"));
    expect(FakePeer.instances[0].closed).toBe(true);
    t.close();
  });

  it("send() is a silent no-op while nothing is open", async () => {
    fresh();
    const f = fakeFetch(() => true);
    FakeSocket.failNext = true;
    const t = transport({ hosts: [], fetchFn: f.fn });
    expect(() => t.send({ type: "fire" })).not.toThrow();
    t.close();
  });
});
