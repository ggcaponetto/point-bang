import { Button, Stack, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { normalizeButtonRect } from "../../../../public/math.js";
import type { ButtonDef, Rect } from "../../types";

export function PlacementTab(props: {
  btn: ButtonDef;
  patch: (p: Record<string, unknown>) => void;
  onPlace: (id: string, extraPatch?: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
  const rect = normalizeButtonRect(props.btn.rect) as Rect | null;
  return (
    <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
      <Typography variant="body2">
        {rect
          ? t("placement.placed", { x: rect.x, y: rect.y, w: rect.w, h: rect.h })
          : t("placement.strip")}
      </Typography>
      {rect ? (
        <Button variant="outlined" size="small" onClick={() => props.patch({ rect: undefined })}>
          {t("placement.remove")}
        </Button>
      ) : (
        <Button variant="outlined" size="small" onClick={() => props.onPlace(props.btn.id)}>
          {t("placement.place")}
        </Button>
      )}
      <Typography variant="caption" color="text.secondary">
        {t("placement.hint")}
      </Typography>
    </Stack>
  );
}
