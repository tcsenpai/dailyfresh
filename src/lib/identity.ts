/**
 * Cookie-backed anon identity.
 *
 * `df_handle` is a signed cookie of shape `<base64url(payload)>.<hex(sig)>` where
 * payload is `{uid, handle, ts}`. uid stays stable across handle changes so a
 * user can rename and still own their leaderboard rows.
 *
 * No DB write happens until a user actually submits a score — the cookie alone
 * is enough to identify them across sessions.
 */

import { createHmac, randomBytes } from "node:crypto";
import { env } from "../config/env";

const COOKIE_NAME = "df_handle";
const MAX_AGE_SEC = 60 * 60 * 24 * 365; // 1 year

export interface Identity {
  uid: string;
  handle: string;
  ts: number;
  /** True once the user has performed a rename. Renames are one-shot. */
  renamed?: boolean;
}

function sign(payload: string): string {
  return createHmac("sha256", env.COOKIE_SECRET).update(payload).digest("hex").slice(0, 32);
}

function b64encode(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}

function b64decode(s: string): string {
  return Buffer.from(s, "base64url").toString("utf8");
}

export function encodeIdentity(id: Identity): string {
  const payload = b64encode(JSON.stringify(id));
  const sig = sign(payload);
  return `${payload}.${sig}`;
}

export function decodeIdentity(raw: string | undefined | null): Identity | null {
  if (!raw) return null;
  const [payload, sig] = raw.split(".");
  if (!payload || !sig) return null;
  if (sign(payload) !== sig) return null;
  try {
    const parsed = JSON.parse(b64decode(payload));
    if (
      typeof parsed?.uid === "string" &&
      typeof parsed?.handle === "string" &&
      typeof parsed?.ts === "number"
    ) {
      return {
        uid: parsed.uid,
        handle: parsed.handle,
        ts: parsed.ts,
        renamed: parsed.renamed === true,
      };
    }
  } catch {}
  return null;
}

export function newUid(): string {
  return randomBytes(8).toString("base64url");
}

export function sanitizeHandle(raw: string | undefined | null): string {
  if (!raw) return "";
  return raw
    .trim()
    .slice(0, 24)
    .replace(/[^a-zA-Z0-9 _\-.]/g, "")
    .trim();
}

export function cookieHeader(value: string): string {
  // Secure flag on if BASE_URL is https (production behind TLS proxy) or
  // NODE_ENV=production. Skipped on local dev (http://localhost).
  const baseUrl = process.env.BASE_URL ?? "";
  const secure = baseUrl.startsWith("https://") || process.env.NODE_ENV === "production";
  return [
    `${COOKIE_NAME}=${value}`,
    `Max-Age=${MAX_AGE_SEC}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function parseCookie(cookieHeader: string | undefined | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${COOKIE_NAME}=`)) {
      return trimmed.slice(COOKIE_NAME.length + 1);
    }
  }
  return null;
}
