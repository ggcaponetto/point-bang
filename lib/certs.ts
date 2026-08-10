import fs from "node:fs";
import path from "node:path";

// WiFi mode: WebXR needs a secure context, and http://<LAN-IP> isn't one.
// mkcert-generated certs in certs/ enable the https+wss listener; absent
// certs simply disable it (adb/localhost flow needs none).
export function loadTls(dir: string): { cert: Buffer; key: Buffer } | null {
  const cert = path.join(dir, "cert.pem");
  const key = path.join(dir, "key.pem");
  if (!fs.existsSync(cert) || !fs.existsSync(key)) return null;
  return { cert: fs.readFileSync(cert), key: fs.readFileSync(key) };
}
