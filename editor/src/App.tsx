import { useEffect, useState } from "react";
import { Alert, Box, Container, Snackbar } from "@mui/material";
import { useTranslation } from "react-i18next";
import { useEditorState, type Status } from "./state";
import { EditorHeader } from "./components/EditorHeader";
import { IntroCard } from "./components/IntroCard";
import { PhoneCanvas } from "./components/PhoneCanvas";
import { ChipRow } from "./components/ChipRow";
import { InspectorPanel } from "./components/InspectorPanel";
import { ProblemsBar } from "./components/ProblemsBar";

function statusText(t: (k: string, p?: Record<string, unknown>) => string, status: Status) {
  switch (status.k) {
    case "loading":
      return t("status.loading");
    case "editing":
      return t("status.editing");
    case "saving":
      return t("status.saving");
    case "saved":
      return t("status.saved", { rev: status.rev });
    case "refused":
      return t("status.refused", {
        status: status.status,
        detail: status.detail ?? t("status.refusedFallback"),
      });
    case "failed":
      return t("status.saveFailed", { error: status.error });
    case "loadFailed":
      return t("status.loadFailed", { error: status.error });
  }
}

export function App() {
  const { t, i18n } = useTranslation();
  const s = useEditorState();
  const [landscape, setLandscape] = useState(false);
  // the snackbar mirrors the LAST save outcome; dismissing it never touches
  // the status line, which stays the source of truth
  const [seenOutcome, setSeenOutcome] = useState<Status | null>(null);

  useEffect(() => {
    document.title = t("title");
    document.documentElement.lang = i18n.resolvedLanguage ?? "en";
  }, [t, i18n.resolvedLanguage]);

  const outcome = ["saved", "refused", "failed"].includes(s.status.k) ? s.status : null;

  return (
    <Container maxWidth="lg" sx={{ py: 2 }}>
      <EditorHeader
        status={statusText(t, s.status)}
        saveDisabled={!s.cfg || s.problems.length > 0 || s.status.k === "saving"}
        onSave={() => void s.save()}
      />
      <IntroCard />
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "minmax(0, 1fr) 420px" },
          gap: 2,
          mt: 2,
          alignItems: "start",
        }}
      >
        <Box>
          <PhoneCanvas
            cfg={s.cfg}
            selected={s.selected}
            landscape={landscape}
            onSelect={s.setSelected}
            onRectChange={(id, rect) => s.patchButton(id, { rect })}
          />
          <ChipRow
            cfg={s.cfg}
            landscape={landscape}
            onLandscape={setLandscape}
            onPlace={s.placeOnCanvas}
          />
        </Box>
        <InspectorPanel
          cfg={s.cfg}
          selected={s.selected}
          onSelect={s.setSelected}
          patchSelected={s.patchSelected}
          onReset={s.resetSelected}
          onPlace={s.placeOnCanvas}
        />
      </Box>
      <ProblemsBar problems={s.problems} />
      <Snackbar
        open={outcome !== null && outcome !== seenOutcome}
        autoHideDuration={4000}
        onClose={() => setSeenOutcome(outcome)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          severity={outcome?.k === "saved" ? "success" : "error"}
          onClose={() => setSeenOutcome(outcome)}
          variant="filled"
        >
          {outcome ? statusText(t, outcome) : ""}
        </Alert>
      </Snackbar>
    </Container>
  );
}
