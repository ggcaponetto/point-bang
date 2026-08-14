import { Alert, AlertTitle } from "@mui/material";
import { useTranslation } from "react-i18next";

/**
 * What the server would refuse. The preamble is translated; the problem
 * strings themselves are the exact English server verdicts — pinned to
 * lib/buttons.ts and never localized.
 */
export function ProblemsBar(props: Readonly<{ problems: string[] }>) {
  const { t } = useTranslation();
  if (props.problems.length === 0) return null;
  return (
    <Alert severity="error" sx={{ mt: 2 }}>
      <AlertTitle>{t("problems.preamble")}</AlertTitle>
      <ul style={{ margin: 0, paddingLeft: 20 }}>
        {props.problems.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </Alert>
  );
}
