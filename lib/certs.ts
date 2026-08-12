import fs from "node:fs";
import path from "node:path";

/**
 * Optional TLS for WiFi mode.
 * @module
 */

/**
 * Loads mkcert-generated certs from `dir`, enabling the https+wss listener.
 * WebXR needs a secure context and `http://<LAN-IP>` isn't one; absent certs
 * simply disable HTTPS (the adb/localhost flow needs none).
 *
 * `dir` comes from the CLI (`--certs`), so the canonical path of each file is
 * resolved and required to stay inside the canonical directory before it is
 * read (path-injection guard; also refuses symlinks pointing elsewhere).
 */
export function loadTls(dir: string): { cert: Buffer; key: Buffer } | null {
  try {
    const base = fs.realpathSync(dir);
    const prefix = base.endsWith(path.sep) ? base : base + path.sep;
    const cert = fs.realpathSync(path.join(base, "cert.pem"));
    const key = fs.realpathSync(path.join(base, "key.pem"));
    if (!cert.startsWith(prefix) || !key.startsWith(prefix)) return null;
    return { cert: fs.readFileSync(cert), key: fs.readFileSync(key) };
  } catch {
    // no such directory or missing files — HTTPS silently off, by design
    return null;
  }
}
