import { Box } from "@mui/material";
import type { Rect } from "../types";

/** One button on the canvas — dumb and pointer-inert; the canvas owns picking. */
export function ButtonRect(props: Readonly<{ rect: Rect; label: string; selected: boolean }>) {
  const { rect } = props;
  return (
    <Box
      sx={{
        position: "absolute",
        left: `${rect.x}%`,
        top: `${rect.y}%`,
        width: `${rect.w}%`,
        height: `${rect.h}%`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        fontSize: 13,
        fontWeight: 600,
        color: "text.primary",
        bgcolor: props.selected ? "rgba(74,163,255,0.25)" : "rgba(255,255,255,0.08)",
        border: "1.5px solid",
        borderColor: props.selected ? "primary.main" : "rgba(255,255,255,0.25)",
        borderRadius: 2,
        pointerEvents: "none",
      }}
    >
      {props.label}
    </Box>
  );
}
