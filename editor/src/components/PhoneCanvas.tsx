// The phone-screen canvas: visible buttons with a rect are drawn at their
// literal % positions, exactly how the phone renders them. One pointer
// handler set on the CONTAINER does everything — hitTest picks the target,
// the drag lives in a ref so only actual rect changes re-render (rects snap
// to whole %, so most pointermoves are no-ops).

import { useRef } from "react";
import { Box, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { normalizeButtonRect } from "../../../public/math.js";
import { clampRectMove, hitTest, pointerToPct, resizeRect } from "../model";
import { ButtonRect } from "./ButtonRect";
import type { ButtonsConfig, Handle, Rect } from "../types";

interface Drag {
  id: string;
  part: Handle | "body";
  start: { x: number; y: number };
  rect: Rect;
  last: Rect;
}

export function PhoneCanvas(
  props: Readonly<{
    cfg: ButtonsConfig | null;
    selected: string | null;
    landscape: boolean;
    onSelect: (id: string | null) => void;
    onRectChange: (id: string, rect: Rect) => void;
  }>,
) {
  const { t } = useTranslation();
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);

  // render order = config order; strip buttons (rect null) never hit
  const rectButtons = (props.cfg?.buttons ?? [])
    .filter((b) => b.visible)
    .map((b) => ({
      id: b.id,
      rect: normalizeButtonRect(b.rect) as Rect | null,
      label: typeof b.label === "string" && b.label ? b.label : b.id,
    }));

  const toPct = (e: React.PointerEvent) => {
    const el = frameRef.current;
    if (!el) return null;
    return pointerToPct(e.clientX, e.clientY, el.getBoundingClientRect());
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!props.cfg) return;
    const p = toPct(e);
    if (!p) return;
    const hit = hitTest(rectButtons, p.x, p.y, 2.5);
    props.onSelect(hit?.id ?? null);
    if (hit) {
      const rect = rectButtons.find((b) => b.id === hit.id)?.rect;
      if (rect) {
        dragRef.current = { ...hit, start: p, rect, last: rect };
        e.currentTarget.setPointerCapture(e.pointerId);
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const p = toPct(e);
    if (!p) return;
    const dx = p.x - drag.start.x;
    const dy = p.y - drag.start.y;
    const next =
      drag.part === "body"
        ? clampRectMove(drag.rect, dx, dy)
        : resizeRect(drag.rect, drag.part, dx, dy);
    const l = drag.last;
    if (next.x === l.x && next.y === l.y && next.w === l.w && next.h === l.h) return;
    drag.last = next;
    props.onRectChange(drag.id, next);
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const selectedRect = rectButtons.find((b) => b.id === props.selected)?.rect ?? null;

  return (
    <Box>
      <Box
        ref={frameRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        sx={{
          position: "relative",
          aspectRatio: props.landscape ? "19.5 / 9" : "9 / 19.5",
          maxWidth: props.landscape ? "100%" : 340,
          mx: "auto",
          bgcolor: "#0a0d12",
          border: "2px solid",
          borderColor: "divider",
          borderRadius: 4,
          overflow: "hidden",
          touchAction: "none",
          userSelect: "none",
        }}
      >
        {rectButtons.map(
          (b) =>
            b.rect && (
              <ButtonRect
                key={b.id}
                rect={b.rect}
                label={b.label}
                selected={b.id === props.selected}
              />
            ),
        )}
        {selectedRect &&
          (
            [
              ["nw", selectedRect.x, selectedRect.y],
              ["ne", selectedRect.x + selectedRect.w, selectedRect.y],
              ["sw", selectedRect.x, selectedRect.y + selectedRect.h],
              ["se", selectedRect.x + selectedRect.w, selectedRect.y + selectedRect.h],
            ] as const
          ).map(([part, cx, cy]) => (
            <Box
              key={part}
              sx={{
                position: "absolute",
                left: `${cx}%`,
                top: `${cy}%`,
                width: 12,
                height: 12,
                transform: "translate(-50%, -50%)",
                bgcolor: "primary.main",
                borderRadius: "50%",
                pointerEvents: "none",
              }}
            />
          ))}
      </Box>
      <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mt: 1 }}>
        {t("under.hint")}
      </Typography>
      <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
        {t("frame.hint")}
      </Typography>
    </Box>
  );
}
