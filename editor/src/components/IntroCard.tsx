import { useState } from "react";
import { Alert, AlertTitle, Button, Collapse } from "@mui/material";
import { useTranslation } from "react-i18next";

const DISMISS_KEY = "pb.editorIntroDismissed";

export function IntroCard() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(() => !localStorage.getItem(DISMISS_KEY));
  const dismiss = () => {
    setOpen(false);
    localStorage.setItem(DISMISS_KEY, "1");
  };
  return (
    <Collapse in={open}>
      <Alert
        severity="info"
        sx={{ mt: 2 }}
        action={
          <Button size="small" onClick={dismiss}>
            {t("intro.dismiss")}
          </Button>
        }
      >
        <AlertTitle>{t("intro.title")}</AlertTitle>
        {t("intro.body")}
      </Alert>
    </Collapse>
  );
}
