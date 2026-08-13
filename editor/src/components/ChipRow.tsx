// Under the canvas: the landscape toggle, one chip per visible button that
// has no fixed spot yet (the phone shows those in its scrollable strip), and
// the "add button" menu that turns a hidden slot into a visible button.

import { useState } from "react";
import {
  Chip,
  FormControlLabel,
  Menu,
  MenuItem,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { normalizeButtonRect } from "../../../public/math.js";
import type { ButtonsConfig } from "../types";

export function ChipRow(props: {
  cfg: ButtonsConfig | null;
  landscape: boolean;
  onLandscape: (v: boolean) => void;
  onPlace: (id: string, extraPatch?: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null);
  const buttons = props.cfg?.buttons ?? [];
  const loose = buttons.filter((b) => b.visible && !normalizeButtonRect(b.rect));
  const hidden = buttons.filter((b) => !b.visible);

  return (
    <Stack
      direction="row"
      spacing={1}
      useFlexGap
      sx={{ alignItems: "center", flexWrap: "wrap", mt: 1 }}
    >
      <FormControlLabel
        control={
          <Switch
            size="small"
            checked={props.landscape}
            onChange={(e) => props.onLandscape(e.target.checked)}
          />
        }
        label={<Typography variant="body2">{t("frame.landscape")}</Typography>}
      />
      <Tooltip title={t("under.addButtonTitle")}>
        <span>
          <Chip
            label={t("under.addButton")}
            color="primary"
            variant="outlined"
            disabled={hidden.length === 0}
            onClick={(e) => setAddAnchor(e.currentTarget)}
          />
        </span>
      </Tooltip>
      <Menu anchorEl={addAnchor} open={addAnchor !== null} onClose={() => setAddAnchor(null)}>
        {hidden.map((b) => (
          <MenuItem
            key={b.id}
            onClick={() => {
              setAddAnchor(null);
              props.onPlace(b.id, { visible: true });
            }}
          >
            {b.label && b.label !== b.id.toUpperCase() ? `${b.id} (${b.label})` : b.id}
          </MenuItem>
        ))}
      </Menu>
      {loose.length > 0 && (
        <Typography variant="body2" color="text.secondary">
          {t("under.place")}
        </Typography>
      )}
      {loose.map((b) => (
        <Chip key={b.id} label={b.label || b.id} onClick={() => props.onPlace(b.id)} />
      ))}
    </Stack>
  );
}
