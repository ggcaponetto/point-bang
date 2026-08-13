// Edge + gamepad triggers. The pad-index field keeps a local draft: config
// is only patched on a VALID parse (current behavior), invalid text shows an
// error without corrupting the config. The parent remounts this tab per
// slot, so drafts never leak between buttons.

import { useState } from "react";
import {
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { normalizeEdge, normalizePad } from "../../../../public/math.js";
import { parsePadField } from "../../model";
import type { ButtonDef } from "../../types";

const EDGES = ["any", "left", "right", "top", "bottom"] as const;

export function TriggersTab(props: {
  btn: ButtonDef;
  patch: (p: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
  const edge = (normalizeEdge(props.btn.edge) as string | null) ?? "";
  const pad = props.btn.pad;
  const padMode = pad === undefined ? "" : normalizePad(pad) === "any" ? "any" : "index";
  const [padDraft, setPadDraft] = useState(typeof pad === "number" ? String(pad) : "0");
  const padDraftBad = parsePadField(padDraft) === null;

  const edgeLabel = (e: string) => t(`triggers.edge${e.charAt(0).toUpperCase()}${e.slice(1)}`);

  return (
    <Stack spacing={2}>
      <FormControl size="small" fullWidth>
        <InputLabel id="edge-label">{t("triggers.edge")}</InputLabel>
        <Select
          labelId="edge-label"
          label={t("triggers.edge")}
          value={edge}
          onChange={(e) => props.patch({ edge: e.target.value || undefined })}
        >
          <MenuItem value="">{t("triggers.edgeNone")}</MenuItem>
          {EDGES.map((e) => (
            <MenuItem key={e} value={e}>
              {edgeLabel(e)}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <Typography variant="caption" color="text.secondary">
        {t("triggers.edgeHint")}
      </Typography>

      <FormControl size="small" fullWidth>
        <InputLabel id="pad-label">{t("triggers.pad")}</InputLabel>
        <Select
          labelId="pad-label"
          label={t("triggers.pad")}
          value={padMode}
          onChange={(e) => {
            const mode = e.target.value as string;
            if (mode === "") props.patch({ pad: undefined });
            else if (mode === "any") props.patch({ pad: "any" });
            else props.patch(parsePadField(padDraft) ?? { pad: 0 });
          }}
        >
          <MenuItem value="">{t("triggers.padNone")}</MenuItem>
          <MenuItem value="any">{t("triggers.padAny")}</MenuItem>
          <MenuItem value="index">{t("triggers.padSpecific")}</MenuItem>
        </Select>
      </FormControl>
      {padMode === "index" && (
        <TextField
          size="small"
          type="number"
          label={t("triggers.padIndex")}
          value={padDraft}
          error={padDraftBad}
          slotProps={{ htmlInput: { min: 0, step: 1 } }}
          onChange={(e) => {
            setPadDraft(e.target.value);
            const parsed = parsePadField(e.target.value);
            if (parsed && typeof parsed.pad === "number") props.patch(parsed);
          }}
        />
      )}
      <Typography variant="caption" color="text.secondary">
        {t("triggers.padHint")}
      </Typography>
    </Stack>
  );
}
