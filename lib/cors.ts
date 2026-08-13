/**
 * CORS policy for the one cross-origin consumer we support: the phone page
 * served from GitHub Pages, which reaches the PC via Local Network Access
 * fetches (`/rtc/offer` signaling, `buttons.json`).
 *
 * Never `*`: these endpoints ultimately move the mouse and press keys, so a
 * browser context only gets an answer when its Origin is the hosted page (the
 * allowlist) or the request is same-origin anyway (localhost/adb,
 * tunnel — the Origin's host equals the Host header). Non-browser clients
 * send no Origin at all and pass untouched.
 *
 * @module
 */

/** The two request headers the policy is decided on. */
export interface OriginInfo {
  /** `Origin` header — absent outside browsers. */
  origin: string | undefined;
  /** `Host` header — what this server is being addressed as. */
  host: string | undefined;
}

/**
 * Same-origin fetches still carry Origin on POST; scheme is irrelevant
 * here (http :8443 and https :8444 are both ours).
 */
const sameOrigin = (r: OriginInfo): boolean => {
  try {
    return new URL(r.origin ?? "").host === r.host;
  } catch {
    return false;
  }
};

/** Whether the request may hit state-changing endpoints at all. */
export function originAllowed(r: OriginInfo, allowed: string[]): boolean {
  if (!r.origin) return true;
  return allowed.includes(r.origin) || sameOrigin(r);
}

/**
 * Headers to attach: `{}` when no Origin is present (nothing needed) or the
 * request is same-origin (the browser only enforces CORS cross-origin), the
 * CORS set when the Origin is on the allowlist, `null` when it is neither —
 * the caller turns `null` into a 403 on anything state-changing.
 *
 * The `Access-Control-Allow-Origin` value is taken out of OUR allowlist, never
 * echoed from the request header — reflecting a request's Origin, even a
 * validated one, is the classic CORS-injection shape.
 *
 * `Access-Control-Allow-Private-Network` answers the Private-Network-Access
 * preflight of pre-LNA Chromes (130–141); Chrome 142+ relies on the LNA
 * permission prompt instead and ignores it. Harmless, widens compatibility.
 */
export function corsHeaders(
  r: OriginInfo,
  allowed: string[],
  preflight: boolean,
): Record<string, string> | null {
  if (!r.origin) return {};
  const match = allowed.indexOf(r.origin);
  if (match < 0) return sameOrigin(r) ? {} : null;
  const h: Record<string, string> = {
    "Access-Control-Allow-Origin": allowed[match],
    Vary: "Origin",
  };
  if (preflight) {
    h["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    h["Access-Control-Allow-Headers"] = "content-type";
    h["Access-Control-Allow-Private-Network"] = "true";
    h["Access-Control-Max-Age"] = "86400";
  }
  return h;
}
