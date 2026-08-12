/**
 * PC-side WebRTC intake: turns a phone's SDP offer into an answer and feeds
 * every DataChannel message into the same protocol handler the WebSocket uses.
 *
 * Why WebRTC at all: the phone page is served from an HTTPS origin (GitHub
 * Pages), and a secure page cannot open `ws://<lan-ip>` (mixed content, and
 * Local Network Access does not cover WebSockets). WebRTC is exempt from
 * mixed-content rules and brings its own DTLS encryption, so the PC needs no
 * TLS certificate — the whole point of the QR setup flow.
 *
 * werift (pure TypeScript) terminates the connection; a native stack cannot
 * live inside the single executable. All werift usage stays behind
 * {@link PeerLike} so tests inject a fake and API drift is contained here.
 *
 * @module
 */

import { RTCPeerConnection } from "werift";

/** The slice of a werift RTCDataChannel we consume. */
export interface ChannelLike {
  onMessage: { subscribe(cb: (data: string | Buffer) => void): void };
  /** werift's channel state; only `"open"` channels are broadcast to. */
  readyState: string;
  send(data: string): void;
}

/** The slice of a werift RTCPeerConnection we consume — the mock seam. */
export interface PeerLike {
  onDataChannel: { subscribe(cb: (dc: ChannelLike) => void): void };
  connectionStateChange: { subscribe(cb: (state: string) => void): void };
  iceGatheringStateChange: { subscribe(cb: (state: string) => void): void };
  iceGatheringState: string;
  localDescription: { sdp: string } | null;
  setRemoteDescription(d: { type: "offer"; sdp: string }): Promise<void>;
  createAnswer(): Promise<{ type: string; sdp: string }>;
  setLocalDescription(d: { type: string; sdp: string }): Promise<unknown>;
  close(): Promise<void>;
}

export interface RtcHubDeps {
  /** Replaces real werift in tests. */
  createPeer?: () => PeerLike;
  log?: (line: string) => void;
  /** Cap on waiting for ICE gathering to complete before answering. */
  gatherTimeoutMs?: number;
}

/** Live signaling endpoint: one hub per server, one peer per phone. */
export interface RtcHub {
  /** Offer SDP in → answer SDP out (gathering complete). Rejects bad SDP. */
  handleOffer(sdp: string): Promise<string>;
  /** Live peer connections (any state short of evicted). */
  count(): number;
  /** Sends to every open DataChannel across live peers; skips the rest. */
  broadcast(text: string): void;
  /** Closes every live peer; part of server teardown. */
  close(): Promise<void>;
}

// No STUN/TURN: phone and PC share a LAN, host candidates suffice (werift
// learns the phone's address peer-reflexively from its STUN checks), and an
// empty list keeps gathering near-instant. werift's default is a public
// Google STUN server — never dial out just to talk across the room.
// Explicit delegation (not a structural cast) so werift's overloads and
// werift-only members never leak past PeerLike.
const realPeer = (): PeerLike => {
  const pc = new RTCPeerConnection({ iceServers: [] });
  return {
    onDataChannel: pc.onDataChannel,
    connectionStateChange: pc.connectionStateChange,
    iceGatheringStateChange: pc.iceGatheringStateChange,
    get iceGatheringState() {
      return pc.iceGatheringState;
    },
    get localDescription() {
      return pc.localDescription;
    },
    setRemoteDescription: (d) => pc.setRemoteDescription(d),
    createAnswer: () => pc.createAnswer(),
    setLocalDescription: (d) => pc.setLocalDescription({ type: "answer", sdp: d.sdp }),
    close: () => pc.close(),
  };
};

/** Resolves once gathering is complete, or after the cap — whichever first. */
const gathered = (peer: PeerLike, capMs: number): Promise<void> =>
  new Promise((resolve) => {
    if (peer.iceGatheringState === "complete") return resolve();
    const timer = setTimeout(resolve, capMs);
    peer.iceGatheringStateChange.subscribe((s) => {
      if (s === "complete") {
        clearTimeout(timer);
        resolve();
      }
    });
  });

/**
 * Creates the hub. `onRaw` receives every DataChannel payload exactly as the
 * WS path receives socket frames — same bytes, same parser, same handler.
 */
export function createRtcHub(onRaw: (raw: string | Buffer) => void, deps: RtcHubDeps = {}): RtcHub {
  const createPeer = deps.createPeer ?? realPeer;
  const log = deps.log ?? console.log;
  const capMs = deps.gatherTimeoutMs ?? 3000;
  const peers = new Set<PeerLike>();
  // Channels per peer, for server→phone pushes. A peer may open more than one
  // channel in theory; all of them are remembered and dropped with the peer.
  const channels = new Map<PeerLike, ChannelLike[]>();

  const evict = (peer: PeerLike): void => {
    channels.delete(peer);
    if (!peers.delete(peer)) return; // already evicted — close() raced a state change
    peer.close().catch(() => {});
  };

  return {
    async handleOffer(sdp: string): Promise<string> {
      if (typeof sdp !== "string" || !sdp.includes("m=")) throw new Error("not an SDP offer");
      const peer = createPeer();
      peers.add(peer);
      peer.onDataChannel.subscribe((dc) => {
        dc.onMessage.subscribe(onRaw);
        channels.set(peer, [...(channels.get(peer) ?? []), dc]);
      });
      peer.connectionStateChange.subscribe((state) => {
        if (state === "connected") log("phone connected (rtc)");
        if (state === "failed" || state === "closed" || state === "disconnected") {
          if (peers.has(peer)) log("phone disconnected (rtc)");
          evict(peer);
        }
      });
      try {
        await peer.setRemoteDescription({ type: "offer", sdp });
        await peer.setLocalDescription(await peer.createAnswer());
        await gathered(peer, capMs);
      } catch (e) {
        evict(peer);
        throw new Error(`offer rejected: ${(e as Error).message}`);
      }
      const local = peer.localDescription;
      if (!local) {
        evict(peer);
        throw new Error("offer rejected: no local description after answer");
      }
      return local.sdp;
    },
    count: () => peers.size,
    broadcast(text: string): void {
      for (const list of channels.values())
        for (const dc of list) {
          if (dc.readyState !== "open") continue;
          try {
            dc.send(text);
          } catch {
            // a channel closing mid-send must never throw out of a save
          }
        }
    },
    async close(): Promise<void> {
      const open = [...peers];
      peers.clear();
      channels.clear();
      await Promise.all(open.map((p) => p.close().catch(() => {})));
    },
  };
}
