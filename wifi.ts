// Prints which band (2.4 vs 5 GHz) the PC's WiFi is connected on — 5 GHz is
// what you want for low aim jitter. Windows only (netsh).
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parseNetsh, renderWifiReport } from "./lib/wifi.ts";

export function wifiMain(
  exec: (cmd: string) => string = (cmd) => execSync(cmd, { encoding: "utf8" }),
  log: (line: string) => void = console.log,
  platform: string = process.platform,
): number {
  if (platform !== "win32") {
    log("Windows only — check your OS WiFi settings for the band.");
    return 0;
  }
  let out: string;
  try {
    out = exec("netsh wlan show interfaces");
  } catch {
    log("netsh failed — is there a WiFi adapter?");
    return 1;
  }
  const report = parseNetsh(out);
  for (const line of renderWifiReport(report)) log(line);
  return report.connected ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = wifiMain();
