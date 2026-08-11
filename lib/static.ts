import path from "node:path";

/**
 * Static file serving helpers for the phone page.
 * @module
 */

/** Extension → Content-Type for the file kinds the phone page pulls. */
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/**
 * Turns a request target into a clean relative file path, or `null` if it is
 * malformed. Query/hash are dropped, percent-escapes decoded, and backslashes
 * folded to `/` so a request resolves to the same file on Windows (where `\`
 * is a path separator) as on Linux (where it is a legal filename byte).
 */
export function normalizeUrlPath(urlPath: string): string | null {
  const bare = urlPath.split(/[?#]/, 1)[0];
  let decoded: string;
  try {
    decoded = decodeURIComponent(bare);
  } catch {
    return null; // malformed percent-escape, e.g. "/%zz"
  }
  if (decoded.includes("\0")) return null;
  const file = decoded === "" || decoded === "/" ? "/index.html" : decoded;
  return path.posix.normalize(file.replace(/\\/g, "/"));
}

/**
 * Maps a request URL to a file inside `root`, or `null` if it escapes root
 * (path traversal guard — defense-in-depth behind Node's own request
 * validation; a past design requirement, keep it).
 */
export function safeResolve(root: string, urlPath: string): string | null {
  const rel = normalizeUrlPath(urlPath);
  if (rel === null) return null;
  const resolved = path.join(root, rel);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

/** Content-Type for the few file kinds the POC serves. */
export function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? "text/plain";
}
