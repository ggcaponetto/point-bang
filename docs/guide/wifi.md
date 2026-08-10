# Playing over WiFi

No cable, same network. Start with:

```sh
npm run start:wifi
```

It prints exactly the URLs to open on the phone, and which option they need.

WebXR only runs in a secure context, so plain `http://<PC-IP>:8443` exposes
no `navigator.xr`. Two ways around it:

## Option A — Chrome flag (zero setup)

1. On the phone, open `chrome://flags/#unsafe-treat-insecure-origin-as-secure`.
2. Enable it and add `http://<PC-IP>:8443` — `npm run ip` prints your
   addresses with the Wi-Fi interface marked, and `start:wifi` prints them
   ready-made.
3. Relaunch Chrome and open that URL. Done — no HTTPS involved.

## Option B — mkcert HTTPS (proper)

1. On the PC, install [mkcert](https://github.com/FiloSottile/mkcert)
   (`choco install mkcert` / `scoop install mkcert` / `brew install mkcert`),
   then:

   ```sh
   mkcert -install
   mkdir certs
   mkcert -cert-file certs/cert.pem -key-file certs/key.pem localhost <PC-IP>
   ```

   Re-run the last command whenever your LAN IP changes — certs are per-IP.

2. Trust the CA on the phone: copy `rootCA.pem` (find it with
   `mkcert -CAROOT`) to the phone and install it via Settings → Security →
   Encryption & credentials → Install a certificate → **CA certificate**.

3. `npm run start:wifi` now also serves **https://\<PC-IP\>:8444** with a
   WebSocket over TLS. HTTP on :8443 keeps working for the USB flow.

## Watch the band

WiFi adds jitter compared to USB — and **2.4 GHz is the usual culprit**.
`npm run wifi` (Windows) tells you which band the PC is on; put both the PC
and the phone on 5 GHz if your router offers it. Watch the server's p95
jitter print, and fall back to [USB](/guide/getting-started) if aim feels
rubbery.
