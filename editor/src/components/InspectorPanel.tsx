// The fixed-height settings panel that replaced the long scrollable column:
// button identity (slot picker, label, visible, reset) always on top, the
// four topic tabs below. A Badge dot marks tabs holding a non-default
// setting so a button's configuration is readable at a glance.

import { useState } from "react";
import {
  Badge,
  Box,
  Button,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { normalizeButtonRect } from "../../../public/math.js";
import { ActionTab } from "./tabs/ActionTab";
import { PlacementTab } from "./tabs/PlacementTab";
import { TriggersTab } from "./tabs/TriggersTab";
import { FeedbackTab } from "./tabs/FeedbackTab";
import type { ButtonDef, ButtonsConfig } from "../types";

function TabLabel(props: Readonly<{ text: string; marked: boolean }>) {
  return (
    <Badge color="primary" variant="dot" invisible={!props.marked}>
      <span style={{ paddingRight: 4 }}>{props.text}</span>
    </Badge>
  );
}

const slotSummary = (b: ButtonDef, hiddenText: string) => {
  const parts = [b.id];
  if (b.label && b.label !== b.id.toUpperCase()) parts.push(b.label);
  if (typeof b.action === "string" && b.action) parts.push(b.action);
  if (!b.visible) parts.push(hiddenText);
  return parts.join(" · ");
};

export function InspectorPanel(
  props: Readonly<{
    cfg: ButtonsConfig | null;
    selected: string | null;
    onSelect: (id: string | null) => void;
    patchSelected: (patch: Record<string, unknown>) => void;
    onReset: () => void;
    onPlace: (id: string, extraPatch?: Record<string, unknown>) => void;
  }>,
) {
  const { t } = useTranslation();
  const [tab, setTab] = useState(0);
  const btn = props.cfg?.buttons.find((b) => b.id === props.selected) ?? null;

  return (
    <Paper
      variant="outlined"
      sx={{ p: 2, display: "flex", flexDirection: "column", minHeight: 560 }}
    >
      <FormControl size="small" fullWidth>
        <InputLabel id="slot-label">{t("section.button")}</InputLabel>
        <Select
          labelId="slot-label"
          label={t("section.button")}
          value={props.selected ?? ""}
          onChange={(e) => props.onSelect(e.target.value || null)}
        >
          {(props.cfg?.buttons ?? []).map((b) => (
            <MenuItem key={b.id} value={b.id}>
              {slotSummary(b, t("list.hidden"))}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {!btn && (
        <Box
          sx={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            px: 2,
          }}
        >
          <Typography color="text.secondary" align="center">
            {t("inspector.empty")}
          </Typography>
        </Box>
      )}

      {btn && (
        <>
          <Stack direction="row" spacing={2} sx={{ alignItems: "center", mt: 2 }}>
            <Tooltip title={t("field.labelHint")}>
              <TextField
                size="small"
                label={t("field.label")}
                value={btn.label ?? ""}
                onChange={(e) => props.patchSelected({ label: e.target.value })}
                sx={{ flex: 1 }}
              />
            </Tooltip>
            <Tooltip title={t("field.visibleHint")}>
              <FormControlLabel
                control={
                  <Switch
                    checked={Boolean(btn.visible)}
                    onChange={(e) => props.patchSelected({ visible: e.target.checked })}
                  />
                }
                label={<Typography variant="body2">{t("field.visible")}</Typography>}
              />
            </Tooltip>
          </Stack>
          <Tooltip title={t("field.resetHint")}>
            <Button
              color="error"
              variant="outlined"
              size="small"
              onClick={props.onReset}
              sx={{ mt: 1, alignSelf: "flex-start" }}
            >
              {t("field.reset")}
            </Button>
          </Tooltip>

          <Tabs
            value={tab}
            onChange={(_, v: number) => setTab(v)}
            variant="fullWidth"
            sx={{ mt: 1, borderBottom: 1, borderColor: "divider" }}
          >
            <Tab label={<TabLabel text={t("section.action")} marked={Boolean(btn.action)} />} />
            <Tab
              label={
                <TabLabel
                  text={t("section.placement")}
                  marked={normalizeButtonRect(btn.rect) !== null}
                />
              }
            />
            <Tab
              label={
                <TabLabel
                  text={t("section.triggers")}
                  marked={btn.edge !== undefined || btn.pad !== undefined}
                />
              }
            />
            <Tab
              label={<TabLabel text={t("section.feedback")} marked={btn.vibrate !== undefined} />}
            />
          </Tabs>
          {/* key={id} remounts the tab content on slot change so local draft
              state (pad index, vibrate ms, raw-action text) never leaks
              between buttons */}
          <Box key={btn.id} sx={{ flex: 1, overflow: "auto", pt: 2 }}>
            {tab === 0 && <ActionTab btn={btn} patch={props.patchSelected} />}
            {tab === 1 && (
              <PlacementTab btn={btn} patch={props.patchSelected} onPlace={props.onPlace} />
            )}
            {tab === 2 && <TriggersTab btn={btn} patch={props.patchSelected} />}
            {tab === 3 && <FeedbackTab btn={btn} patch={props.patchSelected} />}
          </Box>
        </>
      )}
    </Paper>
  );
}
