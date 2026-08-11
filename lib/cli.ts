import path from "node:path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { startServer, type ServerMode, type InputMode } from "../server.ts";
import { parseScreenSize } from "./virtual.ts";
import { startNgrok, formatTunnelReport } from "./tunnel.ts";
import { diskAssets, seaAssets, type AssetSource } from "./assets.ts";
import { adbReverse } from "./adb.ts";
import { runCheck } from "./check.ts";
import type { LibNut } from "./native.ts";
import { lanIPv4, formatIpReport } from "./net.ts";
import { wifiMain } from "./wifi.ts";
import { VERSION } from "./version.ts";

/**
 * The `point-bang` command line — the one entry point, in a checkout
 * (`node cli.ts …`) and in the single executable alike.
 *
 * Everything that used to be an environment variable is a flag here. `PORT=…`
 * and `PREDICT_MS=…` prefixes are POSIX shell syntax that neither `cmd.exe`
 * nor PowerShell accepts, which made the documented latency-tuning commands
 * unusable on the project's primary platform. Both are still honoured as
 * defaults so existing setups keep working.
 *
 * @module
 */

/** Everything the CLI touches that a test wants to replace. */
export interface CliDeps {
  start?: typeof startServer;
  log?: (line: string) => void;
  error?: (line: string) => void;
  exec?: (cmd: string) => string;
  adb?: typeof adbReverse;
  platform?: string;
  env?: Record<string, string | undefined>;
  /** True inside the single executable: assets are embedded, not on disk. */
  isSea?: boolean;
  /** `sea.getRawAsset`, only consulted when `isSea`. */
  getAsset?: (key: string) => ArrayBuffer;
  /** Directory holding the running program — where `certs/` is looked for. */
  appDir?: string;
  /** Native addon loader for `check`; tests inject one so no real device is touched. */
  loadNative?: () => Promise<LibNut>;
  /** Public-tunnel starter; tests inject one so no agent is ever spawned. */
  tunnel?: typeof startNgrok;
  /** Registers teardown; tests inject one to avoid real signal handlers. */
  onShutdown?: (fn: () => void) => void;
}

/**
 * Kills the tunnel on the way out — a spawned agent does not die with its
 * parent.
 *
 * The explicit `process.exit` matters: attaching any SIGINT listener switches
 * off Node's default "die on Ctrl+C", and Ctrl+C is the documented emergency
 * stop for a program that is driving the mouse.
 */
const onSignals = (fn: () => void): void => {
  process.once("exit", fn);
  for (const sig of ["SIGINT", "SIGTERM"] as const)
    process.once(sig, () => {
      fn();
      process.exit(0);
    });
};

/** Parsed `serve` options, after defaults and env fallbacks are applied. */
interface ServeArgs {
  mode: ServerMode;
  port: number;
  httpsPort: number;
  predictMs: number;
  input: InputMode;
  screen?: string;
  tunnel: "off" | "ngrok";
  tunnelUrl?: string;
  /** `tunnel` command only — its own spelling of `--tunnel-url`. */
  url?: string;
  certs?: string;
  public?: string;
  buttons?: string;
}

const numFromEnv = (raw: string | undefined): number | undefined => {
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Builds the parser. Split out from {@link runCli} so the flag surface —
 * names, defaults, choices, help text — can be asserted without booting a
 * server.
 */
export function buildParser(argv: string[], deps: CliDeps = {}) {
  const env = deps.env ?? process.env;
  // `--public` is shared: `check` needs it to validate a directory the same
  // way `serve` would serve it.
  const publicOption = {
    type: "string",
    describe: "use the phone page in this directory instead of the built-in one",
  } as const;

  return (
    yargs(argv)
      .scriptName("point-bang")
      .version(VERSION)
      .usage("$0 <command> [options]")
      // "$0" as an alias makes a bare `point-bang --port 9000` mean `serve`,
      // options included — registering it as a separate command would give it
      // an empty flag set and reject them all.
      .command(["serve", "$0"], "Serve the phone page and drive the PC cursor (default)", (y) =>
        y
          .option("mode", {
            alias: "m",
            choices: ["all", "adb", "wifi"] as const,
            default: "all" as const,
            describe: "adb = USB tunnel only, wifi = LAN only, all = both",
          })
          .option("port", {
            alias: "p",
            type: "number",
            default: numFromEnv(env.PORT) ?? 8443,
            describe: "http + ws port",
          })
          .option("https-port", {
            type: "number",
            default: numFromEnv(env.HTTPS_PORT) ?? 8444,
            describe: "https + wss port (only used when certs exist)",
          })
          .option("predict-ms", {
            type: "number",
            default: numFromEnv(env.PREDICT_MS) ?? 20,
            describe: "aim extrapolation lookahead; 0 keeps prediction minimal",
          })
          .option("certs", {
            type: "string",
            describe: "directory holding cert.pem + key.pem (default: ./certs next to the program)",
          })
          .option("input", {
            choices: ["auto", "native", "none"] as const,
            default: "auto" as const,
            describe: "none = print the aim instead of moving the cursor (headless)",
          })
          .option("screen", {
            type: "string",
            describe: "screen size assumed with --input none, e.g. 1920x1080",
          })
          .option("tunnel", {
            choices: ["off", "ngrok"] as const,
            default: "off" as const,
            describe: "expose an HTTPS URL the phone can open from any network",
          })
          .option("tunnel-url", {
            type: "string",
            describe: "claim a reserved ngrok URL (free accounts get one) instead of a random one",
          })
          .option("public", publicOption)
          .option("buttons", {
            type: "string",
            describe: "buttons.json to load instead of the built-in one",
          }),
      )
      // Standalone counterpart to `serve --tunnel ngrok`: run it in a second
      // terminal beside a plain `serve` so either can be restarted without
      // taking the other down.
      .command("tunnel", "Open a public HTTPS tunnel to a server already running", (y) =>
        y
          .option("port", {
            alias: "p",
            type: "number",
            default: numFromEnv(env.PORT) ?? 8443,
            describe: "local port to expose — the one `serve` is listening on",
          })
          .option("url", {
            type: "string",
            describe: "claim a reserved ngrok URL (free accounts get one) instead of a random one",
          }),
      )
      .command("ip", "List this PC's LAN IPv4 addresses, marking the WiFi one")
      .command("wifi", "Report the WiFi band (5 GHz is what you want)")
      .command("check", "Verify the phone page files and the native input addon", (y) =>
        y.option("public", publicOption),
      )
      .strict()
      .help()
      .alias("h", "help")
      .wrap(Math.min(100, process.stdout.columns ?? 100))
  );
}

/** Chooses where the phone page and buttons.json are read from. */
export function resolveAssets(deps: CliDeps, publicDir?: string, appDir = "."): AssetSource {
  if (publicDir) return diskAssets(publicDir);
  if (deps.isSea && deps.getAsset) return seaAssets(deps.getAsset);
  return diskAssets(path.join(appDir, "public"));
}

/**
 * Runs one CLI invocation.
 *
 * @returns The process exit code. `serve` returns 0 once the server is
 * listening — the process then stays alive on its own handles.
 */
export async function runCli(
  argv: string[] = hideBin(process.argv),
  deps: CliDeps = {},
): Promise<number> {
  const log = deps.log ?? console.log;
  const error = deps.error ?? console.error;
  const parsed = await buildParser(argv, deps).parseAsync();
  const command = (parsed._[0] as string | undefined) ?? "serve";

  if (command === "ip") {
    for (const line of formatIpReport(lanIPv4())) log(line);
    return 0;
  }
  if (command === "wifi") {
    return wifiMain(deps.exec, log, deps.platform ?? process.platform);
  }

  const a = parsed as unknown as ServeArgs;
  const appDir = deps.appDir ?? process.cwd();
  if (command === "check") {
    return runCheck({
      assets: resolveAssets(deps, a.public, appDir),
      log,
      loadNative: deps.loadNative,
      platform: deps.platform,
      env: deps.env,
    });
  }
  if (command === "tunnel") {
    log(`TUNNEL: exposing local :${a.port} — start the server separately if it is not up yet`);
    try {
      const tunnel = await (deps.tunnel ?? startNgrok)(a.port, { url: a.url });
      for (const line of formatTunnelReport(tunnel.url, tunnel.adopted)) log(line);
      // The agent's piped stdio keeps this process alive; Ctrl+C reaps it.
      (deps.onShutdown ?? onSignals)(() => tunnel.stop());
      return 0;
    } catch (e) {
      // Here the tunnel IS the job, so a failure is the command's failure —
      // unlike `serve`, which has a working server to keep running.
      error(`TUNNEL: failed — ${(e as Error).message}`);
      return 1;
    }
  }

  const screen = a.screen === undefined ? undefined : parseScreenSize(a.screen);
  if (screen === null) {
    error(`--screen: expected WxH (e.g. 1920x1080), got "${a.screen}"`);
    return 1;
  }
  if (a.mode === "adb") log((deps.adb ?? adbReverse)(a.port).detail);
  try {
    const server = await (deps.start ?? startServer)({
      mode: a.mode,
      port: a.port,
      httpsPort: a.httpsPort,
      predictMs: a.predictMs,
      input: a.input,
      screen,
      platform: deps.platform,
      env: deps.env,
      certsDir: a.certs ?? path.join(appDir, "certs"),
      assets: resolveAssets(deps, a.public, appDir),
      buttonsFile: a.buttons,
      log,
    });
    if (a.tunnel === "ngrok") {
      // Deliberately after the server is listening, and on the port it
      // actually bound. A tunnel to a port nothing answers on just serves
      // 502s to the phone.
      try {
        const tunnel = await (deps.tunnel ?? startNgrok)(server.httpPort, { url: a.tunnelUrl });
        for (const line of formatTunnelReport(tunnel.url, tunnel.adopted)) log(line);
        (deps.onShutdown ?? onSignals)(() => tunnel.stop());
      } catch (e) {
        // The server is up and the USB/LAN flows still work — an optional
        // extra failing is not a reason to take them down.
        error(`TUNNEL: failed — ${(e as Error).message}`);
        error("TUNNEL: serving anyway; the USB and WiFi flows are unaffected");
      }
    }
    return 0;
  } catch (e) {
    error(String((e as Error).stack ?? e));
    return 1;
  }
}
