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
 */
export function loadTls(dir: string): { cert: Buffer; key: Buffer } | null {
  const cert = path.join(dir, "cert.pem");
  const key = path.join(dir, "key.pem");
  if (!fs.existsSync(cert) || !fs.existsSync(key)) return null;
  return { cert: fs.readFileSync(cert), key: fs.readFileSync(key) };
}
