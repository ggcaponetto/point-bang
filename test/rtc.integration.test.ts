/**
 * Real werift ↔ werift loopback: the one test that exercises the actual
 * werift API names, guarding PeerLike against drifting from reality.
 * A second werift peer plays the phone (offerer with an unordered,
 * no-retransmit DataChannel — the exact channel the page opens).
 */
import { describe, it, expect } from "vitest";
import { RTCPeerConnection, type RTCDataChannel } from "werift";
import { createRtcHub } from "../lib/rtc.ts";

const gatheringComplete = (pc: RTCPeerConnection): Promise<void> =>
  new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") return resolve();
    pc.iceGatheringStateChange.subscribe((s) => {
      if (s === "complete") resolve();
    });
  });

const channelOpen = (dc: RTCDataChannel): Promise<void> =>
  new Promise((resolve) => {
    if (dc.readyState === "open") return resolve();
    dc.stateChanged.subscribe((s) => {
      if (s === "open") resolve();
    });
  });

describe("rtc loopback (real werift)", () => {
  it(
    "phone offer → hub answer → DataChannel delivers protocol JSON",
    { timeout: 15000 },
    async () => {
      let deliver: (raw: string) => void;
      const received = new Promise<string>((resolve) => (deliver = resolve));
      const hub = createRtcHub((raw) => deliver(raw.toString()), { log: () => {} });
      const phone = new RTCPeerConnection({ iceServers: [] });
      try {
        const dc = phone.createDataChannel("aim", { ordered: false, maxRetransmits: 0 });
        await phone.setLocalDescription(await phone.createOffer());
        await gatheringComplete(phone);
        const answer = await hub.handleOffer(phone.localDescription!.sdp);
        await phone.setRemoteDescription({ type: "answer", sdp: answer });
        await channelOpen(dc);
        dc.send(JSON.stringify({ type: "aim", u: 0.5, v: 0.25, t: 1712345678901, q: 1 }));
        expect(JSON.parse(await received)).toEqual({
          type: "aim",
          u: 0.5,
          v: 0.25,
          t: 1712345678901,
          q: 1,
        });
        expect(hub.count()).toBe(1);
      } finally {
        await phone.close();
        await hub.close();
      }
    },
  );
});
