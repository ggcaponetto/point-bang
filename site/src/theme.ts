import { createTheme } from "@mui/material";

// The project's palette (public/index.html CSS vars), as a MUI theme:
// accent blue for actions, the crosshair red reserved for emphasis.
export const theme = createTheme({
  palette: {
    mode: "dark",
    primary: { main: "#4aa3ff" },
    secondary: { main: "#e5484d" },
    success: { main: "#37d67a" },
    warning: { main: "#f5a623" },
    error: { main: "#e5484d" },
    background: { default: "#0e1116", paper: "#161b22" },
    text: { primary: "#e8e8e8", secondary: "#9a9a9a" },
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    h1: { fontSize: "2.4rem", fontWeight: 700 },
    h2: { fontSize: "1.4rem", fontWeight: 600 },
    button: { textTransform: "none", fontWeight: 600 },
  },
  components: {
    MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
  },
});
