// Prints this PC's LAN IPv4 addresses by interface — the Wi-Fi one is the
// address the phone should use (http://<ip>:8443 or https://<ip>:8444).
import { pathToFileURL } from "node:url";
import { lanIPv4, formatIpReport, type LanAddress } from "./lib/net.ts";

export function ipMain(
  addrs: LanAddress[] = lanIPv4(),
  log: (line: string) => void = console.log,
): void {
  for (const line of formatIpReport(addrs)) log(line);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) ipMain();
