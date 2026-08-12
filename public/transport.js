// Phone-side link to the PC. Plain JS ES module on purpose (same deal as
// math.js): Chrome loads it directly, vitest imports it for tests. Typed via
// JSDoc, checked by `npm run typecheck`. Everything platform is injected
// (Peer/Socket constructors, fetch), so the state machine is unit-testable.
//
// Two modes, fixed at creation by the URL fragment:
//
// remote — the QR flow. The page came from the hosted HTTPS origin and the
//   fragment carries the PC's LAN addresses (`#pc=192.168.1.5:8443,...`).
//   Signaling is ONE Local-Network-Access fetch per attempt (LNA covers
//   fetch only — never WebSockets), then aim flows over a WebRTC DataChannel
//   straight across the LAN. There is no WS fallback here: `ws://` from an
//   HTTPS origin is mixed content, full stop.
//
// local — no fragment. The page came from the PC itself (adb/localhost,
//   mkcert https, tunnel). RTC is tried first via a same-origin fetch, WS is
//   the automatic fallback; a WS drop restarts the ladder RTC-first.

/**
 * @typedef {Object} ChannelIsh
 * @property {string} readyState
 * @property {(() => void) | null} onopen
 * @property {(() => void) | null} onclose
 * @property {(data: string) => void} send
 * @property {() => void} close
 */
/**
 * @typedef {Object} PeerIsh
 * @property {(label: string, opts: { ordered: boolean, maxRetransmits: number }) => ChannelIsh} createDataChannel
 * @property {() => Promise<{ type?: string, sdp?: string }>} createOffer
 * @property {(d: { type?: string, sdp?: string }) => Promise<unknown>} setLocalDescription
 * @property {(d: { type: string, sdp: string }) => Promise<unknown>} setRemoteDescription
 * @property {{ sdp: string } | null} localDescription
 * @property {string} iceGatheringState
 * @property {(() => void) | null} onicegatheringstatechange
 * @property {string} connectionState
 * @property {(() => void) | null} onconnectionstatechange
 * @property {() => void} close
 */
/**
 * @typedef {Object} SocketIsh
 * @property {(() => void) | null} onopen
 * @property {(() => void) | null} onclose
 * @property {(() => void) | null} onerror
 * @property {(data: string) => void} send
 * @property {() => void} close
 */
/** @typedef {(url: string, init: Record<string, unknown>) => Promise<{ ok: boolean, status: number, json(): Promise<unknown> }>} FetchLike */
/**
 * @typedef {Object} TransportTimes
 * @property {number} gatherMs    cap on waiting for ICE gathering (host-only: near-instant)
 * @property {number} offerMs     signaling fetch timeout per host
 * @property {number} openMs      offer-to-open cap, remote mode
 * @property {number} localOpenMs offer-to-open cap, local mode (fail fast to WS)
 * @property {number[]} retryMs   remote-mode backoff ladder (last entry repeats)
 * @property {number} wsRetryMs   delay before restarting the ladder after a WS drop
 */

/** Accepts `host:port` (or `[v6]:port`) — anything else in the QR is dropped. */
const HOST_RE = /^([a-z0-9.-]+|\[[0-9a-f:.]+\]):(\d{1,5})$/i;

/**
 * Reads the PC addresses out of the URL fragment. No `pc=` key (or nothing
 * valid in it) means local mode.
 * @param {string} hash e.g. "#pc=192.168.1.5:8443,10.0.0.3:8443"
 * @returns {{ hosts: string[] }}
 */
export function parseFragment(hash) {
  const params = new URLSearchParams((hash ?? "").replace(/^#/, ""));
  const hosts = (params.get("pc") ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter((h) => {
      const m = HOST_RE.exec(h);
      return m !== null && Number(m[2]) >= 1 && Number(m[2]) <= 65535;
    });
  return { hosts };
}

/**
 * Where buttons.json comes from: the PC when we know one (the customer's
 * local config must win over the copy published with the page), the page's
 * own origin otherwise.
 * @param {string[]} hosts
 * @param {string | null} [connectedHost]
 */
export function buttonsUrl(hosts, connectedHost) {
  const host = connectedHost ?? hosts[0];
  return host ? `http://${host}/buttons.json` : "./buttons.json";
}

/**
 * Loads the button config: PC first in remote mode (an LNA fetch — this is
 * usually what triggers Chrome's one-time permission prompt), falling back to
 * the copy deployed beside the page.
 * @param {string[]} hosts
 * @param {FetchLike} fetchFn
 * @param {string | null} [connectedHost]
 * @returns {Promise<unknown>}
 */
export async function fetchButtons(hosts, fetchFn, connectedHost) {
  if (hosts.length > 0) {
    try {
      const res = await fetchFn(buttonsUrl(hosts, connectedHost), { targetAddressSpace: "local" });
      if (res.ok) return await res.json();
    } catch {
      // PC unreachable (yet) — the bundled copy keeps the UI rendering.
    }
  }
  return await (await fetchFn("./buttons.json", {})).json();
}

/**
 * One signaling round-trip: offer out, answer back.
 * @param {string} url
 * @param {string} sdp
 * @param {FetchLike} fetchFn
 * @param {{ crossOrigin: boolean, timeoutMs: number }} opts
 * @returns {Promise<string>} the answer SDP
 */
export async function exchangeOffer(url, sdp, fetchFn, opts) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  try {
    /** @type {Record<string, unknown>} */
    const init = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sdp }),
      signal: ctrl.signal,
    };
    // Local Network Access: declares the target so Chrome 142+ exempts this
    // https-page → http-LAN fetch from mixed content (behind its permission
    // prompt). Same-origin requests must NOT carry it.
    if (opts.crossOrigin) init.targetAddressSpace = "local";
    const res = await fetchFn(url, init);
    if (!res.ok) throw new Error(`signaling: HTTP ${res.status}`);
    const body = /** @type {{ sdp?: unknown }} */ (await res.json());
    if (!body || typeof body.sdp !== "string") throw new Error("signaling: no sdp in answer");
    return body.sdp;
  } finally {
    clearTimeout(t);
  }
}

/** @param {PeerIsh} pc @param {number} capMs */
const gathered = (pc, capMs) =>
  new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") return resolve(undefined);
    const t = setTimeout(resolve, capMs);
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(t);
        resolve(undefined);
      }
    };
  });

/** @param {ChannelIsh} dc @param {PeerIsh} pc @param {number} capMs */
const channelOpen = (dc, pc, capMs) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("DataChannel open timeout")), capMs);
    dc.onopen = () => {
      clearTimeout(t);
      resolve(undefined);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        clearTimeout(t);
        reject(new Error(`connection ${pc.connectionState}`));
      }
    };
  });

/** @param {string[]} hosts */
const failMessage = (hosts) =>
  `Couldn't reach the PC at ${hosts.join(", ")}. Check: phone and PC on the same WiFi; ` +
  `Chrome 142 or newer; local-network permission allowed for this site; ` +
  `the PC's firewall prompt accepted. Retrying…`;

/**
 * @param {Object} opts
 * @param {string[]} opts.hosts       from {@link parseFragment}; [] = local mode
 * @param {string} opts.wsUrl         same-origin WS endpoint (local mode only)
 * @param {FetchLike} opts.fetchFn
 * @param {new (config: { iceServers: unknown[] }) => PeerIsh} opts.Peer
 * @param {new (url: string) => SocketIsh} opts.Socket
 * @param {(state: "rtc-connecting" | "rtc" | "ws" | "closed" | "failed", detail?: string) => void} [opts.onStatus]
 * @param {Partial<TransportTimes>} [opts.times]
 * @returns {{ send(o: object): void, close(): void, connectedHost(): string | null }}
 */
export function createTransport(opts) {
  const hosts = opts.hosts ?? [];
  const remote = hosts.length > 0;
  /** @type {TransportTimes} */
  const times = {
    gatherMs: 2000,
    offerMs: 3000,
    openMs: 8000,
    localOpenMs: 4000,
    retryMs: [3000, 6000, 12000],
    wsRetryMs: 1000,
    ...(opts.times ?? {}),
  };
  const onStatus = opts.onStatus ?? (() => {});

  let closed = false;
  /** @type {{ send(s: string): void, close(): void } | null} */
  let active = null;
  /** @type {string | null} */
  let host = null;
  let round = 0; // consecutive fully-failed remote ladders, drives backoff
  let gen = 0; // invalidates async completions from a superseded ladder
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;

  /** @param {string} offerUrl @param {boolean} crossOrigin @param {number} openCapMs */
  async function rtcAttempt(offerUrl, crossOrigin, openCapMs) {
    const pc = new opts.Peer({ iceServers: [] });
    try {
      // Unordered, no retransmits: a lost aim sample is stale the moment a
      // newer one exists — never let TCP-style recovery stall the stream.
      const dc = pc.createDataChannel("aim", { ordered: false, maxRetransmits: 0 });
      await pc.setLocalDescription(await pc.createOffer());
      await gathered(pc, times.gatherMs);
      const sdp = pc.localDescription?.sdp;
      if (!sdp) throw new Error("no local offer");
      const answer = await exchangeOffer(offerUrl, sdp, opts.fetchFn, {
        crossOrigin,
        timeoutMs: times.offerMs,
      });
      await pc.setRemoteDescription({ type: "answer", sdp: answer });
      await channelOpen(dc, pc, openCapMs);
      return { pc, dc };
    } catch (e) {
      pc.close();
      throw e;
    }
  }

  /** @param {PeerIsh} pc @param {ChannelIsh} dc */
  function adopt(pc, dc) {
    active = {
      send: (s) => {
        if (dc.readyState === "open") dc.send(s);
      },
      close: () => pc.close(),
    };
    onStatus("rtc");
    let dropped = false; // onclose and the state change both fire — act once
    const drop = () => {
      if (dropped || closed) return;
      dropped = true;
      active = null;
      host = null;
      onStatus("closed");
      void ladder();
    };
    dc.onclose = drop;
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") drop();
    };
  }

  function wsConnect() {
    const ws = new opts.Socket(opts.wsUrl);
    ws.onopen = () => {
      if (closed) return ws.close();
      active = { send: (s) => ws.send(s), close: () => ws.close() };
      onStatus("ws");
    };
    ws.onclose = () => {
      // fires whether the socket dropped or never opened at all
      if (closed) return;
      active = null;
      onStatus("closed");
      timer = setTimeout(() => void ladder(), times.wsRetryMs);
    };
    ws.onerror = () => {};
  }

  async function ladder() {
    if (closed || active) return;
    const g = ++gen;
    onStatus("rtc-connecting");
    if (remote) {
      for (const h of hosts) {
        try {
          const { pc, dc } = await rtcAttempt(`http://${h}/rtc/offer`, true, times.openMs);
          if (closed || g !== gen) return pc.close();
          round = 0;
          host = h;
          adopt(pc, dc);
          return;
        } catch {
          // next host
        }
      }
      if (closed || g !== gen) return;
      onStatus("failed", failMessage(hosts));
      const delay = times.retryMs[Math.min(round, times.retryMs.length - 1)];
      round += 1;
      timer = setTimeout(() => void ladder(), delay);
    } else {
      try {
        const { pc, dc } = await rtcAttempt("/rtc/offer", false, times.localOpenMs);
        if (closed || g !== gen) return pc.close();
        adopt(pc, dc);
      } catch {
        if (closed || g !== gen) return;
        wsConnect();
      }
    }
  }
  void ladder();

  return {
    /** Fire-and-forget: silently dropped unless a channel is open. @param {object} o */
    send(o) {
      active?.send(JSON.stringify(o));
    },
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      const a = active;
      active = null;
      a?.close();
    },
    connectedHost: () => host,
  };
}
