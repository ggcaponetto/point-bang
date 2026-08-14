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
import { decomposeVibrate, parseVibrateField } from "../../model";
import type { ButtonDef } from "../../types";

export function FeedbackTab(
  props: Readonly<{
    btn: ButtonDef;
    patch: (p: Record<string, unknown>) => void;
  }>,
) {
  const { t } = useTranslation();
  const dec = decomposeVibrate(props.btn.vibrate);
  const [msDraft, setMsDraft] = useState(String(dec.ms));
  const parsed = parseVibrateField(msDraft);
  const msBad = parsed === null || typeof parsed.vibrate !== "number";

  return (
    <Stack spacing={2}>
      <FormControl size="small" fullWidth>
        <InputLabel id="vib-label">{t("feedback.vibrate")}</InputLabel>
        <Select
          labelId="vib-label"
          label={t("feedback.vibrate")}
          value={dec.mode}
          onChange={(e) => {
            const mode = e.target.value;
            if (mode === "default") props.patch({ vibrate: undefined });
            else if (mode === "off") props.patch({ vibrate: false });
            else {
              const p = parseVibrateField(msDraft);
              props.patch(p && typeof p.vibrate === "number" ? p : { vibrate: 10 });
            }
          }}
        >
          <MenuItem value="default">{t("feedback.vibrateDefault")}</MenuItem>
          <MenuItem value="off">{t("feedback.vibrateOff")}</MenuItem>
          <MenuItem value="custom">{t("feedback.vibrateCustom")}</MenuItem>
        </Select>
      </FormControl>
      {dec.mode === "custom" && (
        <TextField
          size="small"
          type="number"
          label={t("feedback.vibrateMs")}
          value={msDraft}
          error={msBad}
          slotProps={{ htmlInput: { min: 1, max: 100 } }}
          onChange={(e) => {
            setMsDraft(e.target.value);
            const p = parseVibrateField(e.target.value);
            if (p && typeof p.vibrate === "number") props.patch(p);
          }}
        />
      )}
      <Typography variant="caption" color="text.secondary">
        {t("feedback.hint")}
      </Typography>
    </Stack>
  );
}
