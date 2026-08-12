import { describe, it, expect, vi } from "vitest";
import { createRtcHub, type PeerLike, type ChannelLike } from "../lib/rtc.ts";

/** Minimal single-listener event matching the werift `.subscribe` shape. */
function fakeEvent<T>() {
  let cb: ((arg: T) => void) | null = null;
  return {
    subscribe: (fn: (arg: T) => void) => {
      cb = fn;
    },
    fire: (arg: T) => cb?.(arg),
  };
}

const OFFER = "v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n";

type Overridable = Partial<
  Omit<PeerLike, "onDataChannel" | "connectionStateChange" | "iceGatheringStateChange">
>;

function fakePeer(overrides: Overridable = {}) {
  return {
    iceGatheringState: "complete",
    localDescription: { sdp: "answer-sdp" } as { sdp: string } | null,
    setRemoteDescription: vi.fn(async () => {}),
    createAnswer: vi.fn(async () => ({ type: "answer", sdp: "answer-sdp" })),
    setLocalDescription: vi.fn(async () => ({})),
    close: vi.fn(async () => {}),
    ...overrides,
    onDataChannel: fakeEvent<ChannelLike>(),
    connectionStateChange: fakeEvent<string>(),
    iceGatheringStateChange: fakeEvent<string>(),
  };
}

describe("createRtcHub", () => {
  it("answers an offer once gathering is already complete", async () => {
    const peer = fakePeer();
    const hub = createRtcHub(() => {}, { createPeer: () => peer, log: () => {} });
    await expect(hub.handleOffer(OFFER)).resolves.toBe("answer-sdp");
    expect(peer.setRemoteDescription).toHaveBeenCalledWith({ type: "offer", sdp: OFFER });
    expect(hub.count()).toBe(1);
  });

  it("waits for the gathering-complete event when gathering is in flight", async () => {
    const peer = fakePeer({ iceGatheringState: "gathering" });
    const hub = createRtcHub(() => {}, { createPeer: () => peer, log: () => {} });
    const pending = hub.handleOffer(OFFER);
    // resolves only after the event fires
    let settled = false;
    void pending.then(() => (settled = true));
    await new Promise((r) => setImmediate(r)); // let handleOffer reach the gathering wait
    expect(settled).toBe(false);
    peer.iceGatheringStateChange.fire("complete");
    await expect(pending).resolves.toBe("answer-sdp");
  });

  it("answers after the gathering cap even if 'complete' never fires", async () => {
    vi.useFakeTimers();
    try {
      const peer = fakePeer({ iceGatheringState: "gathering" });
      const hub = createRtcHub(() => {}, {
        createPeer: () => peer,
        log: () => {},
        gatherTimeoutMs: 50,
      });
      const pending = hub.handleOffer(OFFER);
      await vi.advanceTimersByTimeAsync(60);
      await expect(pending).resolves.toBe("answer-sdp");
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects garbage that is not an SDP offer", async () => {
    const hub = createRtcHub(() => {}, { createPeer: () => fakePeer(), log: () => {} });
    await expect(hub.handleOffer("hello")).rejects.toThrow("not an SDP offer");
    expect(hub.count()).toBe(0);
  });

  it("evicts and closes the peer when werift rejects the offer", async () => {
    const peer = fakePeer({
      setRemoteDescription: vi.fn(async () => {
        throw new Error("bad fingerprint");
      }),
    });
    const hub = createRtcHub(() => {}, { createPeer: () => peer, log: () => {} });
    await expect(hub.handleOffer(OFFER)).rejects.toThrow("offer rejected: bad fingerprint");
    expect(peer.close).toHaveBeenCalled();
    expect(hub.count()).toBe(0);
  });

  it("evicts when no local description materializes", async () => {
    const peer = fakePeer({ localDescription: null });
    const hub = createRtcHub(() => {}, { createPeer: () => peer, log: () => {} });
    await expect(hub.handleOffer(OFFER)).rejects.toThrow("no local description");
    expect(hub.count()).toBe(0);
  });

  it("routes DataChannel payloads to onRaw", async () => {
    const peer = fakePeer();
    const raw: (string | Buffer)[] = [];
    const hub = createRtcHub((r) => raw.push(r), { createPeer: () => peer, log: () => {} });
    await hub.handleOffer(OFFER);
    const dc = { onMessage: fakeEvent<string | Buffer>() };
    peer.onDataChannel.fire(dc);
    dc.onMessage.fire('{"type":"fire"}');
    expect(raw).toEqual(['{"type":"fire"}']);
  });

  it("logs and evicts on connection failure, once", async () => {
    const peer = fakePeer();
    const lines: string[] = [];
    const hub = createRtcHub(() => {}, { createPeer: () => peer, log: (l) => lines.push(l) });
    await hub.handleOffer(OFFER);
    peer.connectionStateChange.fire("connected");
    peer.connectionStateChange.fire("failed");
    peer.connectionStateChange.fire("closed"); // second state change must not double-close
    expect(lines).toEqual(["phone connected (rtc)", "phone disconnected (rtc)"]);
    expect(peer.close).toHaveBeenCalledTimes(1);
    expect(hub.count()).toBe(0);
  });

  it("close() tears down every live peer", async () => {
    const a = fakePeer();
    const b = fakePeer();
    const queue = [a, b];
    const hub = createRtcHub(() => {}, { createPeer: () => queue.shift()!, log: () => {} });
    await hub.handleOffer(OFFER);
    await hub.handleOffer(OFFER);
    expect(hub.count()).toBe(2);
    await hub.close();
    expect(a.close).toHaveBeenCalled();
    expect(b.close).toHaveBeenCalled();
    expect(hub.count()).toBe(0);
  });

  it("survives a peer whose close() rejects", async () => {
    const peer = fakePeer({
      close: vi.fn(async () => {
        throw new Error("already gone");
      }),
    });
    const hub = createRtcHub(() => {}, { createPeer: () => peer, log: () => {} });
    await hub.handleOffer(OFFER);
    await expect(hub.close()).resolves.toBeUndefined();
  });
});
