// logger.ts — isomorphic: file I/O on the server, console-only in the browser.

type Level = "DEBUG" | "INFO" | "WARN" | "ERROR";

const IS_SERVER = typeof window === "undefined";
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

function timestamp(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 23);
}

function writeServer(level: Level, line: string): void {
  // Use Function() to hide 'require' from Turbopack/webpack static analysis.
  // The IS_SERVER guard in write() ensures this never executes in the browser.
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const _require = Function("return require")() as NodeRequire;
    const fs   = _require("fs")   as typeof import("fs");
    const path = _require("path") as typeof import("path");
    const LOG_FILE = path.join(process.cwd(), "system_flow.log");

    try {
      const stat = fs.statSync(LOG_FILE);
      if (stat.size >= MAX_BYTES) {
        fs.renameSync(LOG_FILE, LOG_FILE + ".1");
      }
    } catch { /* file doesn't exist yet */ }

    fs.appendFileSync(LOG_FILE, line, "utf-8");
  } catch {
    // never crash the app due to logging failure
  }
}

function write(level: Level, module: string, fn: string, message: string): void {
  const line = `${timestamp()} | ${level.padEnd(5)} | ${module} | ${fn} | ${message}\n`;

  if (IS_SERVER) {
    writeServer(level, line);
  }

  // Console output in both environments
  if (level === "ERROR" || level === "WARN") {
    console.error(line.trimEnd());
  } else {
    console.log(line.trimEnd());
  }
}

export function createLogger(module: string) {
  return {
    debug: (fn: string, msg: string) => write("DEBUG", module, fn, msg),
    info:  (fn: string, msg: string) => write("INFO",  module, fn, msg),
    warn:  (fn: string, msg: string) => write("WARN",  module, fn, msg),
    error: (fn: string, msg: string) => write("ERROR", module, fn, msg),
  };
}
