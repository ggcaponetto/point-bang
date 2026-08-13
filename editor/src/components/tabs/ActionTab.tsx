// The action builder: kind → (mouse button | modifiers + key) → composed
// spec. The stored `action` string is the single source of truth; the only
// local state is the kind the user picked before the combo is complete
// (composeAction returns "" until something is pressed, and "" decomposes to
// "none" — without the override the select would snap back mid-edit).

import { useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Autocomplete,
  Checkbox,
  FormControl,
  FormControlLabel,
  FormGroup,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { listKeys, parseAction } from "../../../../public/math.js";
import { composeAction, decomposeAction } from "../../model";
import type { ButtonDef } from "../../types";

const MODS = ["ctrl", "shift", "alt", "win"] as const;
const MOD_LABELS: Record<string, string> = { ctrl: "Ctrl", shift: "Shift", alt: "Alt", win: "Win" };

interface KeyOption {
  key: string;
  group: string;
}

const KEY_OPTIONS: KeyOption[] = listKeys().flatMap((g: { group: string; keys: string[] }) =>
  g.keys.map((key: string) => ({ key, group: g.group })),
);

export function ActionTab(props: { btn: ButtonDef; patch: (p: Record<string, unknown>) => void }) {
  const { t } = useTranslation();
  const spec = typeof props.btn.action === "string" ? props.btn.action : undefined;
  const dec = decomposeAction(spec);
  const raw = dec.kind === "raw";
  const [kindOverride, setKindOverride] = useState<"none" | "mouse" | "key" | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const kind = raw ? "key" : (kindOverride ?? dec.kind);
  const mouseBtn = dec.kind === "mouse" ? dec.button : "left";
  const mods = dec.kind === "key" ? dec.mods : [];
  const key = dec.kind === "key" ? dec.key : "";

  const apply = (k: "none" | "mouse" | "key", mb: typeof mouseBtn, m: string[], ky: string) =>
    props.patch({ action: composeAction(k, mb, m, ky) });

  const specText = spec ?? "";
  const specBad = Boolean(specText) && !parseAction(specText);

  return (
    <Stack spacing={2}>
      <FormControl size="small" fullWidth disabled={raw}>
        <InputLabel id="akind-label">{t("action.type")}</InputLabel>
        <Select
          labelId="akind-label"
          label={t("action.type")}
          value={kind}
          onChange={(e) => {
            const k = e.target.value as "none" | "mouse" | "key";
            setKindOverride(k);
            apply(k, mouseBtn, mods, key);
          }}
        >
          <MenuItem value="none">{t("action.typeNone")}</MenuItem>
          <MenuItem value="mouse">{t("action.typeMouse")}</MenuItem>
          <MenuItem value="key">{t("action.typeKey")}</MenuItem>
        </Select>
      </FormControl>

      {kind === "mouse" && !raw && (
        <FormControl size="small" fullWidth>
          <InputLabel id="amouse-label">{t("action.mouseButton")}</InputLabel>
          <Select
            labelId="amouse-label"
            label={t("action.mouseButton")}
            value={mouseBtn}
            onChange={(e) =>
              apply("mouse", e.target.value as "left" | "right" | "middle", mods, key)
            }
          >
            <MenuItem value="left">{t("action.mouseLeft")}</MenuItem>
            <MenuItem value="right">{t("action.mouseRight")}</MenuItem>
            <MenuItem value="middle">{t("action.mouseMiddle")}</MenuItem>
          </Select>
        </FormControl>
      )}

      {kind === "key" && (
        <>
          <FormGroup row>
            {MODS.map((m) => (
              <FormControlLabel
                key={m}
                disabled={raw}
                control={
                  <Checkbox
                    size="small"
                    checked={mods.includes(m)}
                    onChange={(e) =>
                      apply(
                        "key",
                        mouseBtn,
                        e.target.checked ? [...mods, m] : mods.filter((x) => x !== m),
                        key,
                      )
                    }
                  />
                }
                label={MOD_LABELS[m]}
              />
            ))}
          </FormGroup>
          <Autocomplete
            size="small"
            disabled={raw}
            options={KEY_OPTIONS}
            groupBy={(o) => t(`keys.group.${o.group}`)}
            getOptionLabel={(o) => o.key}
            isOptionEqualToValue={(o, v) => o.key === v.key}
            value={KEY_OPTIONS.find((o) => o.key === key) ?? null}
            onChange={(_, v) => apply("key", mouseBtn, mods, v?.key ?? "")}
            renderInput={(params) => (
              <TextField {...params} label={t("action.key")} placeholder={t("action.keyNone")} />
            )}
          />
        </>
      )}

      {raw && (
        <Typography variant="body2" color="warning.main">
          {t("action.rawHint")}
        </Typography>
      )}

      <Typography variant="body2" color="text.secondary">
        {t("action.result")}:{" "}
        <Typography
          component="code"
          variant="body2"
          sx={{ fontFamily: "monospace", color: specBad ? "error.main" : "success.main" }}
        >
          {specText || "—"}
        </Typography>
      </Typography>

      <Accordion
        variant="outlined"
        disableGutters
        expanded={raw || advancedOpen}
        onChange={(_, open) => setAdvancedOpen(open)}
      >
        <AccordionSummary>
          <Typography variant="body2">{t("action.advanced")}</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <TextField
            size="small"
            fullWidth
            value={specText}
            error={specBad}
            onChange={(e) => props.patch({ action: e.target.value })}
            slotProps={{ input: { sx: { fontFamily: "monospace" } } }}
          />
        </AccordionDetails>
      </Accordion>

      <Typography variant="caption" color="text.secondary">
        {t("action.hint")}
      </Typography>
    </Stack>
  );
}
