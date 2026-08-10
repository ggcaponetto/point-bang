import path from "node:path";

/**
 * Static file serving helpers for the phone page.
 * @module
 */

/**
 * Maps a request URL to a file inside `root`, or `null` if it escapes root
 * (path traversal guard — defense-in-depth behind Node's own request
 * validation; a past design requirement, keep it).
 */
export function safeResolve(root: string, urlPath: string): string | null {
  const file = urlPath === "/" ? "/index.html" : urlPath;
  const resolved = path.join(root, path.normalize(file));
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

/** Content-Type for the few file kinds the POC serves. */
export function contentTypeFor(filePath: string): string {
  if (filePath.endsWith(".html")) return "text/html";
  if (filePath.endsWith(".js")) return "text/javascript";
  return "text/plain";
}
