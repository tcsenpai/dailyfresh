import { Elysia, t } from "elysia";
import {
  decodeIdentity,
  encodeIdentity,
  newUid,
  parseCookie,
  sanitizeHandle,
  cookieHeader,
  type Identity,
} from "../lib/identity";
import { renameUid, snapshotForUid } from "../modes/leaderboard/repo";

export const identityRoutes = new Elysia({ prefix: "/api/me" })
  .get("/", ({ headers }) => {
    const cookie = parseCookie(headers["cookie"] ?? null);
    const id = decodeIdentity(cookie);
    if (!id) return { handle: null, uid: null, canRename: true };
    const snap = snapshotForUid(id.uid);
    return {
      handle: id.handle,
      uid: id.uid,
      canRename: !id.renamed,
      snapshot: snap,
    };
  })
  .post(
    "/",
    ({ body, headers, set }) => {
      const handle = sanitizeHandle(body.handle);
      if (!handle) {
        set.status = 400;
        return { error: "invalid_handle" };
      }
      const cookie = parseCookie(headers["cookie"] ?? null);
      const existing = decodeIdentity(cookie);

      // First-set is free. After that, renames are one-shot.
      if (existing && existing.handle !== handle && existing.renamed) {
        set.status = 403;
        return {
          error: "rename_quota_exceeded",
          message: "You can only rename once. Your current handle is locked.",
          currentHandle: existing.handle,
        };
      }

      // Same handle? Just refresh cookie, no renamed bump.
      const isRename = !!(existing && existing.handle !== handle);
      const id: Identity = {
        uid: existing?.uid ?? newUid(),
        handle,
        ts: Date.now(),
        renamed: existing?.renamed === true || isRename,
      };
      set.headers["set-cookie"] = cookieHeader(encodeIdentity(id));

      if (isRename && existing) {
        renameUid(existing.uid, handle);
      }

      return {
        handle: id.handle,
        uid: id.uid,
        canRename: !id.renamed,
        renamedNow: isRename,
      };
    },
    {
      body: t.Object({
        handle: t.String({ minLength: 1, maxLength: 32 }),
      }),
    },
  );
