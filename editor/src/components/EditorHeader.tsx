import { Button, Stack, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";

export function EditorHeader(props: { status: string; saveDisabled: boolean; onSave: () => void }) {
  const { t, i18n } = useTranslation();
  const lang = (i18n.resolvedLanguage ?? "en").slice(0, 2);
  return (
    <Stack direction="row" spacing={2} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
      <Typography variant="h2" component="h1">
        {t("header.title")}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 200 }}>
        {props.status}
      </Typography>
      <ToggleButtonGroup
        size="small"
        exclusive
        value={lang}
        onChange={(_, v: string | null) => {
          if (v) void i18n.changeLanguage(v);
        }}
      >
        <ToggleButton value="en">EN</ToggleButton>
        <ToggleButton value="de">DE</ToggleButton>
        <ToggleButton value="it">IT</ToggleButton>
      </ToggleButtonGroup>
      <Button variant="contained" disabled={props.saveDisabled} onClick={props.onSave}>
        {t("header.save")}
      </Button>
    </Stack>
  );
}
