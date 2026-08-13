import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  Link,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";

const REPO = "https://github.com/ggcaponetto/point-bang";
const DOCS = "https://ggcaponetto.github.io/point-bang/";
const PHONE = "https://ggcaponetto.github.io/point-bang/phone/";

type XrStatus = "checking" | "supported" | "unsupported" | "noWebxr";

/** WebXR types are not in TS's DOM lib — probe structurally. */
function useXrSupport(): XrStatus {
  const [status, setStatus] = useState<XrStatus>("checking");
  useEffect(() => {
    const xr = (navigator as { xr?: { isSessionSupported(mode: string): Promise<boolean> } }).xr;
    if (!xr) {
      setStatus("noWebxr");
      return;
    }
    xr.isSessionSupported("immersive-ar")
      .then((ok) => setStatus(ok ? "supported" : "unsupported"))
      .catch(() => setStatus("unsupported"));
  }, []);
  return status;
}

/** Per-status alert content: severity + i18n keys, one row per XrStatus. */
const XR_ALERT: Record<
  XrStatus,
  { severity: "success" | "info" | "warning"; label: string; hintKey: string | null }
> = {
  checking: { severity: "info", label: "xr.checking", hintKey: null },
  supported: { severity: "success", label: "xr.supported", hintKey: "xr.supportedHint" },
  unsupported: { severity: "warning", label: "xr.unsupported", hintKey: "xr.unsupportedHint" },
  noWebxr: { severity: "warning", label: "xr.noWebxr", hintKey: "xr.noWebxrHint" },
};

function XrCheck() {
  const { t } = useTranslation();
  const status = useXrSupport();
  const { severity, label: labelKey, hintKey } = XR_ALERT[status];
  const label = t(labelKey);
  const hint = hintKey ? t(hintKey) : null;
  return (
    <Card elevation={4}>
      <CardContent>
        <Typography variant="h2" gutterBottom>
          {t("xr.title")}
        </Typography>
        <Alert severity={severity} variant="outlined" sx={{ mb: hint ? 2 : 0 }}>
          {label}
        </Alert>
        {hint && (
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            {hint}
          </Typography>
        )}
        {status === "supported" && (
          <Button variant="contained" size="large" href={PHONE}>
            {t("xr.openAim")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function Steps() {
  const { t } = useTranslation();
  const steps = ["one", "two", "three"] as const;
  return (
    <Box>
      <Typography variant="h2" sx={{ mb: 2 }}>
        {t("steps.title")}
      </Typography>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        {steps.map((s) => (
          <Card key={s} elevation={2} sx={{ flex: 1 }}>
            <CardContent>
              <Typography sx={{ fontWeight: 700 }} gutterBottom>
                {t(`steps.${s}.title`)}
              </Typography>
              <Typography color="text.secondary" variant="body2">
                {t(`steps.${s}.body`)}
              </Typography>
            </CardContent>
          </Card>
        ))}
      </Stack>
    </Box>
  );
}

const BADGES: { alt: string; img: string; href: string }[] = [
  {
    alt: "CI",
    img: "https://github.com/ggcaponetto/point-bang/actions/workflows/ci.yml/badge.svg",
    href: `${REPO}/actions/workflows/ci.yml`,
  },
  {
    alt: "Coverage",
    img: "https://codecov.io/gh/ggcaponetto/point-bang/branch/main/graph/badge.svg",
    href: "https://codecov.io/gh/ggcaponetto/point-bang",
  },
  {
    alt: "Quality gate",
    img: "https://sonarcloud.io/api/project_badges/measure?project=ggcaponetto_point-bang&metric=alert_status",
    href: "https://sonarcloud.io/summary/new_code?id=ggcaponetto_point-bang",
  },
  {
    alt: "Latest release",
    img: "https://img.shields.io/github/v/release/ggcaponetto/point-bang?include_prereleases",
    href: `${REPO}/releases`,
  },
  {
    alt: "License: MIT",
    img: "https://img.shields.io/badge/License-MIT-blue.svg",
    href: `${REPO}/blob/main/LICENSE`,
  },
];

function Quality() {
  const { t } = useTranslation();
  return (
    <Box>
      <Typography variant="h2" sx={{ mb: 2 }}>
        {t("quality")}
      </Typography>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
        {BADGES.map((b) => (
          <Link key={b.alt} href={b.href} target="_blank" rel="noreferrer">
            <img src={b.img} alt={b.alt} height={20} />
          </Link>
        ))}
      </Stack>
    </Box>
  );
}

function LanguageSwitch() {
  const { i18n } = useTranslation();
  const lang = (i18n.resolvedLanguage ?? "en").slice(0, 2);
  return (
    <ToggleButtonGroup
      size="small"
      exclusive
      value={lang}
      onChange={(_e, v: string | null) => {
        if (v) void i18n.changeLanguage(v);
      }}
      aria-label="language"
    >
      <ToggleButton value="en">EN</ToggleButton>
      <ToggleButton value="de">DE</ToggleButton>
      <ToggleButton value="it">IT</ToggleButton>
    </ToggleButtonGroup>
  );
}

export function App() {
  const { t } = useTranslation();
  return (
    <Container maxWidth="md" sx={{ py: { xs: 3, sm: 6 } }}>
      <Stack spacing={4}>
        <Stack direction="row" sx={{ justifyContent: "flex-end" }}>
          <LanguageSwitch />
        </Stack>

        <Stack spacing={2} sx={{ alignItems: "center", textAlign: "center" }}>
          <img
            src={`${import.meta.env.BASE_URL}logo.svg`}
            alt="point-bang logo"
            width={112}
            height={112}
          />
          <Typography variant="h1">point-bang</Typography>
          <Chip label={t("tagline")} color="primary" variant="outlined" />
          <Typography color="text.secondary" sx={{ maxWidth: 560 }}>
            {t("intro")}
          </Typography>
        </Stack>

        <XrCheck />
        <Steps />

        <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: "wrap" }}>
          <Button variant="outlined" href={`${REPO}/releases`}>
            {t("links.releases")}
          </Button>
          <Button variant="outlined" href={DOCS}>
            {t("links.docs")}
          </Button>
          <Button variant="outlined" href={`${DOCS}guide/games/time-crisis/`}>
            {t("links.firstGame")}
          </Button>
          <Button variant="outlined" href={REPO}>
            {t("links.github")}
          </Button>
        </Stack>

        <Quality />

        <Typography color="text.secondary" variant="body2">
          {t("footer")}
        </Typography>
      </Stack>
    </Container>
  );
}
