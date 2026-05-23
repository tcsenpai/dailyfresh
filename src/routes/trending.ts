import { Elysia, t } from "elysia";
import {
  latestQuizPool,
  saveQuizPool,
  saveQuizResult,
  getQuizResult,
  postsCount,
  sourcesCount,
} from "../db/repo";
import { buildTrendingPool, sampleQuestions, type TrendingPool } from "../modes/trending/build";
import { nanoid } from "../lib/id";
import {
  decodeIdentity,
  encodeIdentity,
  newUid,
  parseCookie,
  sanitizeHandle,
  cookieHeader,
  type Identity,
} from "../lib/identity";
import { insertLeaderboardRow } from "../modes/leaderboard/repo";

interface PublicQuestion {
  id: string;
  kind: string;
  prompt: string;
  postTitle: string;
  postUrl: string;
  postPermalink: string;
  imageUrl?: string | null;
  source?: string;
  options: string[];
}

function pool(): TrendingPool | null {
  let p = latestQuizPool<TrendingPool>("trending");
  if (!p) {
    p = buildTrendingPool();
    if (p.questions.length > 0) saveQuizPool("trending", null, p);
  }
  return p;
}

function stripAnswers(qs: ReturnType<typeof sampleQuestions>): PublicQuestion[] {
  return qs.map((q) => ({
    id: q.id,
    kind: q.kind,
    prompt: q.prompt,
    postTitle: q.postTitle,
    postUrl: q.postUrl,
    postPermalink: q.postPermalink,
    imageUrl: q.imageUrl,
    // Hide source for whoseTitle Qs — would leak the answer.
    source: q.kind === "whoseTitle" ? undefined : q.source,
    options: q.options,
  }));
}

export const trendingRoutes = new Elysia({ prefix: "/api/trending" })
  .get("/stats", () => {
    const p = pool();
    return {
      questions: p?.questions.length ?? 0,
      sources: sourcesCount(),
      posts: postsCount(),
      perKind: p?.perKind ?? {},
      builtAt: p?.builtAt ?? null,
    };
  })
  .get("/quiz", ({ query, set }) => {
    const p = pool();
    if (!p || p.questions.length === 0) {
      set.status = 503;
      return { error: "quiz_pool_empty", hint: "run bun run prewarm" };
    }
    const hardcore = query?.hardcore === "1";
    const count = hardcore ? 20 : 10;
    const sample = sampleQuestions(p, count);
    const sessionId = nanoid(10);
    return {
      sessionId,
      builtAt: p.builtAt,
      questions: stripAnswers(sample),
      questionIds: sample.map((q) => q.id),
    };
  })
  .post(
    "/submit",
    ({ body, headers, set }) => {
      const p = pool();
      if (!p) {
        set.status = 503;
        return { error: "no_pool" };
      }
      const lookup = new Map(p.questions.map((q) => [q.id, q]));

      let score = 0;
      const breakdown: Array<{
        id: string;
        correct: boolean;
        correctIndex: number;
        chosenIndex: number;
        postPermalink: string;
        postTitle: string;
      }> = [];

      for (const ans of body.answers) {
        const q = lookup.get(ans.id);
        if (!q) {
          breakdown.push({
            id: ans.id,
            correct: false,
            correctIndex: -1,
            chosenIndex: ans.choice,
            postPermalink: "",
            postTitle: "(missing)",
          });
          continue;
        }
        const correct = q.answerIndex === ans.choice;
        if (correct) score++;
        breakdown.push({
          id: q.id,
          correct,
          correctIndex: q.answerIndex,
          chosenIndex: ans.choice,
          postPermalink: q.postPermalink,
          postTitle: q.postTitle,
        });
      }

      const maxScore = body.answers.length;
      const resultId = nanoid(10);
      saveQuizResult({
        id: resultId,
        mode: "trending",
        topic: null,
        score,
        maxScore,
        archetype: null,
        details: { breakdown },
        ipHash: null,
      });

      // Identity handling: cookie → identity. If body.handle present, override.
      // If neither, leaderboard insert is deferred until user provides handle.
      const cookieRaw = parseCookie(headers["cookie"] ?? null);
      const cookieId = decodeIdentity(cookieRaw);
      const requestedHandle = sanitizeHandle(body.handle);

      let identity: Identity | null = cookieId;
      let landed = false;

      if (requestedHandle) {
        identity = {
          uid: cookieId?.uid ?? newUid(),
          handle: requestedHandle,
          ts: Date.now(),
        };
        set.headers["set-cookie"] = cookieHeader(encodeIdentity(identity));
      }

      if (identity) {
        insertLeaderboardRow({
          mode: "trending",
          topic: null,
          handle: identity.handle,
          uid: identity.uid,
          score,
          maxScore,
          resultId,
          ipHash: null,
        });
        landed = true;
      }

      return {
        id: resultId,
        score,
        maxScore,
        percent: Math.round((score / maxScore) * 100),
        breakdown,
        shareUrl: `/r/${resultId}`,
        landedOnBoard: landed,
        knownHandle: identity?.handle ?? null,
      };
    },
    {
      body: t.Object({
        sessionId: t.Optional(t.String()),
        handle: t.Optional(t.String({ maxLength: 32 })),
        answers: t.Array(
          t.Object({
            id: t.String(),
            choice: t.Integer({ minimum: 0, maximum: 10 }),
          }),
          { minItems: 1, maxItems: 25 },
        ),
      }),
    },
  )
  .post(
    "/land",
    ({ body, headers, set }) => {
      // Land an existing quiz result on the leaderboard, using the caller's
      // signed-cookie identity. Idempotent-ish: refuses to insert a duplicate
      // row for the same (uid, resultId).
      const cookie = parseCookie(headers["cookie"] ?? null);
      const id = decodeIdentity(cookie);
      if (!id) {
        set.status = 401;
        return { error: "no_identity", hint: "POST /api/me/ first" };
      }
      const row = getQuizResult(body.resultId);
      if (!row || row.mode !== "trending") {
        set.status = 404;
        return { error: "not_found" };
      }
      const score = row.score ?? 0;
      const maxScore = row.max_score ?? 0;
      if (!maxScore) {
        set.status = 400;
        return { error: "non_scoreable_result" };
      }
      insertLeaderboardRow({
        mode: "trending",
        topic: null,
        handle: id.handle,
        uid: id.uid,
        score,
        maxScore,
        resultId: row.id,
        ipHash: null,
      });
      return { ok: true };
    },
    {
      body: t.Object({
        resultId: t.String({ minLength: 4 }),
      }),
    },
  )
  .get("/result/:id", ({ params, set }) => {
    const row = getQuizResult(params.id);
    if (!row || row.mode !== "trending") {
      set.status = 404;
      return { error: "not_found" };
    }
    return {
      id: row.id,
      score: row.score,
      maxScore: row.max_score,
      percent: row.max_score ? Math.round((row.score! / row.max_score) * 100) : null,
      createdAt: row.created_at,
      details: JSON.parse(row.details_json),
    };
  });
