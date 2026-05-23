import { env } from "../config/env";

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function shouldLog(level: Level): boolean {
  return ORDER[level] >= ORDER[env.LOG_LEVEL];
}

function fmt(level: Level, msg: string, extra?: unknown): string {
  const ts = new Date().toISOString();
  const tag = level.toUpperCase().padEnd(5);
  const tail = extra === undefined ? "" : ` ${JSON.stringify(extra)}`;
  return `[${ts}] ${tag} ${msg}${tail}`;
}

export const log = {
  debug: (msg: string, extra?: unknown) =>
    shouldLog("debug") && console.log(fmt("debug", msg, extra)),
  info: (msg: string, extra?: unknown) =>
    shouldLog("info") && console.log(fmt("info", msg, extra)),
  warn: (msg: string, extra?: unknown) =>
    shouldLog("warn") && console.warn(fmt("warn", msg, extra)),
  error: (msg: string, extra?: unknown) =>
    shouldLog("error") && console.error(fmt("error", msg, extra)),
};
