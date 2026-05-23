/**
 * LLM-augmented question generation.
 *
 * Reads cached posts from posts_cache and asks a self-hosted OpenAI-compatible
 * endpoint to generate trivia questions about them. Results are merged into
 * the trending quiz pool so the user-facing quiz mixes hand-coded templates
 * with LLM-generated variety.
 *
 * Usage:
 *   bun run llm-prewarm                  # default 2000 questions, qwopus:18b
 *   bun run llm-prewarm --count=500      # explicit count
 *   bun run llm-prewarm --model=qwen3.5:9b
 *   bun run llm-prewarm --batch=8        # posts per LLM call
 *   bun run llm-prewarm --dry            # don't persist, print sample
 *
 * Env (uses same .env as the app):
 *   OPENAI_URL    — base url of OpenAI-compatible API (no trailing /v1)
 *   OPENAI_TOKEN  — bearer token
 *   LLM_MODEL     — fallback model if --model omitted
 */

import { env } from "../config/env";
import { log } from "../lib/logger";
import { db } from "../db/index";
import { migrate } from "../db/migrate";
import {
  richPosts,
  trendingPosts,
  saveQuizPool,
  latestQuizPool,
  type CachedPost,
} from "../db/repo";
import type {
  QuestionType,
  TrendingQuestion,
  TrendingPool,
} from "../modes/trending/build";
import { buildTrendingPool } from "../modes/trending/build";
import { qcFilter } from "../modes/trending/qc";

interface CliArgs {
  count: number;
  model: string;
  batch: number;
  dry: boolean;
  concurrency: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    count: 2000,
    model: "trombone/gemma4:e4b",
    batch: 5,
    dry: false,
    concurrency: 3,
  };
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([a-z]+)(?:=(.+))?$/);
    if (!m) continue;
    const [, key, val] = m;
    if (key === "count") args.count = Number(val);
    else if (key === "model") args.model = val ?? args.model;
    else if (key === "batch") args.batch = Number(val);
    else if (key === "dry") args.dry = true;
    else if (key === "concurrency") args.concurrency = Number(val);
  }
  if (!args.model) args.model = env.LLM_MODEL ?? "qwopus:18b";
  return args;
}

/** Trim post metadata to what the LLM actually needs (token budget). */
interface PostSeed {
  id: string;
  title: string;
  source: string;
  tags: string[];
  upvotes: number;
  comments: number;
  summary: string | null;
}

function postSeed(p: CachedPost): PostSeed {
  let summary: string | null = null;
  try {
    const raw = JSON.parse(p.raw_json);
    if (typeof raw.summary === "string" && raw.summary.length >= 30) {
      summary = raw.summary.slice(0, 600);
    }
  } catch {}
  return {
    id: p.id,
    title: p.title,
    source: p.source_name,
    tags: p.tags_csv ? p.tags_csv.split(",").filter(Boolean) : [],
    upvotes: p.num_upvotes,
    comments: p.num_comments,
    summary,
  };
}

const SYSTEM_PROMPT = `You are writing multiple-choice trivia questions for a quiz called daily.fresh, which tests how well software developers keep up with weekly tech news on daily.dev.

You will be given a JSON array of posts. For each post, produce ONE or TWO interesting trivia questions. Output STRICTLY a JSON array. Each item:

{
  "postId": "<the post id you used>",
  "kind": "factTrivia",
  "prompt": "<conversational question>",
  "options": ["...", "...", "...", "..."],
  "answerIndex": <0-3>
}

RULES:
- Exactly 4 options, exactly one correct.
- "answerIndex" is 0-based index into "options".
- Questions should be natural, varied, sometimes playful. Vary phrasing.
- DO NOT ask "which of these is mentioned in the post" or "according to the post".
- DO NOT ask about the title, the source/publisher, the URL, or the author — those are shown to the user already.
- DO NOT include any of the answer words in the prompt or in the title.
- Good kinds of questions: identifying tech a post is about, what problem it solves, what a specific term means in context, which person/company/project is associated, surprising claims, year/era trivia, definitions, contrasts.
- Distractors should be PLAUSIBLE — same domain, similar shape. No silly fillers.
- Use the post's tags, source, and summary as ground truth — but don't repeat those values as answers.
- Skip a post if you cannot write a sharp, self-contained question.
- Do not include explanations, markdown, or commentary. ONLY the JSON array.`;

interface LlmQuestion {
  postId: string;
  kind: string;
  prompt: string;
  options: string[];
  answerIndex: number;
}

async function callLlmOnce(args: CliArgs, seeds: PostSeed[]): Promise<LlmQuestion[]> {
  if (!env.OPENAI_URL || !env.OPENAI_TOKEN) {
    throw new Error("OPENAI_URL or OPENAI_TOKEN missing in .env");
  }
  const url = env.OPENAI_URL.replace(/\/$/, "") + "/chat/completions";
  const body = {
    model: args.model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(seeds) },
    ],
    temperature: 0.7,
    max_tokens: 2400,
  };

  // 90s per LLM call; ollama-style endpoints can be slow on first hit.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_TOKEN}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`LLM ${res.status}: ${text.slice(0, 400)}`);
  }
  const data: any = await res.json();
  let content: string = data.choices?.[0]?.message?.content ?? "";
  // some models put hidden reasoning in `reasoning`; fall back when content empty
  if (!content && typeof data.choices?.[0]?.message?.reasoning === "string") {
    content = data.choices[0].message.reasoning;
  }
  // strip <think>...</think> blocks (qwen/qwopus style)
  content = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  // strip markdown code fences (```json ... ```)
  content = content.replace(/```(?:json)?\s*([\s\S]*?)```/gi, "$1").trim();
  // strip any prose prefix before the first JSON array/object
  const firstStruct = content.search(/[\[{]/);
  if (firstStruct > 0) content = content.slice(firstStruct);

  // The LLM might wrap the array in {questions: [...]} or return raw [...].
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    // last resort: regex-extract the largest looking array
    const m = content.match(/\[[\s\S]*\]/);
    if (m) parsed = JSON.parse(m[0]);
    else throw new Error("LLM returned non-JSON: " + content.slice(0, 200));
  }

  let arr: any[];
  if (Array.isArray(parsed)) arr = parsed;
  else if (parsed && typeof parsed === "object" && Array.isArray((parsed as any).questions)) {
    arr = (parsed as any).questions;
  } else {
    throw new Error("LLM JSON not an array: " + content.slice(0, 200));
  }

  const out: LlmQuestion[] = [];
  for (const q of arr) {
    if (
      typeof q?.postId === "string" &&
      typeof q?.prompt === "string" &&
      Array.isArray(q?.options) &&
      q.options.length === 4 &&
      q.options.every((o: unknown) => typeof o === "string") &&
      Number.isInteger(q?.answerIndex) &&
      q.answerIndex >= 0 &&
      q.answerIndex <= 3
    ) {
      out.push({
        postId: q.postId,
        kind: typeof q.kind === "string" ? q.kind : "factTrivia",
        prompt: q.prompt,
        options: q.options,
        answerIndex: q.answerIndex,
      });
    }
  }
  return out;
}

/**
 * Call the LLM with 2 retries on transient errors (timeout / 5xx / non-JSON parse).
 * Exponential backoff: 1s, 3s.
 */
async function callLlm(args: CliArgs, seeds: PostSeed[]): Promise<LlmQuestion[]> {
  const maxAttempts = 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await callLlmOnce(args, seeds);
    } catch (err) {
      lastErr = err;
      const msg = String(err);
      const retriable =
        msg.includes("AbortError") ||
        msg.includes("non-JSON") ||
        msg.includes("JSON Parse error") ||
        /LLM 5\d\d/.test(msg) ||
        msg.includes("ECONNRESET") ||
        msg.includes("fetch failed");
      if (!retriable || attempt === maxAttempts) throw err;
      const delay = attempt === 1 ? 1000 : 3000;
      await Bun.sleep(delay);
    }
  }
  throw lastErr;
}

function llmToTrendingQuestion(q: LlmQuestion, byId: Map<string, CachedPost>): TrendingQuestion | null {
  const p = byId.get(q.postId);
  if (!p) return null;
  let image: string | null = null;
  let permalink = p.url;
  try {
    const raw = JSON.parse(p.raw_json);
    if (raw.image) image = raw.image;
    if (raw.commentsPermalink) permalink = raw.commentsPermalink;
  } catch {}
  return {
    id: `llm_${p.id}_${Math.abs(hashStr(q.prompt)).toString(36).slice(0, 6)}`,
    // re-use existing TrendingQuestion kind union; treat LLM as a new kind name
    // but cast since QuestionType is a closed union — extending requires touching build.ts
    kind: "factTrivia" as unknown as QuestionType,
    prompt: q.prompt,
    postTitle: p.title,
    postUrl: p.url,
    postPermalink: permalink,
    imageUrl: image,
    source: p.source_name,
    options: q.options,
    answerIndex: q.answerIndex,
    meta: {
      upvotes: p.num_upvotes,
      comments: p.num_comments,
      tags: p.tags_csv ? p.tags_csv.split(",").filter(Boolean) : [],
      publishedAt: p.published_at,
      summary: null,
    },
  };
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function runConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i]!, i);
      } catch (err) {
        log.warn("worker item failed", { i, err: String(err) });
      }
    }
  }
  const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function main() {
  migrate();
  const args = parseArgs(process.argv);
  log.info("llm-prewarm start", {
    count: args.count,
    model: args.model,
    batch: args.batch,
    concurrency: args.concurrency,
    dry: args.dry,
  });

  // For LLM trivia, prefer posts with summaries (richest signal); fall back to
  // any cached post. Upvotes aren't a quality signal here.
  const rich = richPosts({ minUpvotes: 1, limit: 1200, sinceHours: 24 * 90 });
  const fallback = trendingPosts({ minUpvotes: 1, limit: 1500, sinceHours: 24 * 90 });
  // combine: rich first, then any other post not already in rich
  const richIds = new Set(rich.map((p) => p.id));
  const pool = [...rich, ...fallback.filter((p) => !richIds.has(p.id))];
  if (pool.length === 0) {
    log.error("no posts in cache — run `bun run prewarm` first");
    process.exit(1);
  }

  // We need ~ args.count questions. Each batch of `batch` posts yields ~ 1-2
  // questions per post, so estimate batches needed.
  const targetBatches = Math.max(1, Math.ceil(args.count / Math.max(1, args.batch)));
  const seedRotations = Math.ceil(targetBatches / Math.max(1, Math.floor(pool.length / args.batch)));
  log.info("plan", {
    posts: pool.length,
    target_batches: targetBatches,
    rotations: seedRotations,
  });

  // Build batches by cycling through the pool until we have enough.
  const allBatches: PostSeed[][] = [];
  for (let r = 0; r < Math.max(1, seedRotations); r++) {
    const shuffled = pool
      .map((p) => ({ p, k: Math.random() }))
      .sort((a, b) => a.k - b.k)
      .map(({ p }) => p);
    for (const slice of chunk(shuffled, args.batch)) {
      allBatches.push(slice.map(postSeed));
      if (allBatches.length >= targetBatches) break;
    }
    if (allBatches.length >= targetBatches) break;
  }

  log.info("batches built", { count: allBatches.length });

  const byId = new Map<string, CachedPost>(pool.map((p) => [p.id, p]));
  const generated: TrendingQuestion[] = [];
  let batchOk = 0;
  let batchFail = 0;
  let lastCheckpoint = 0;

  // Capture pre-existing pool ONCE so repeated checkpoints don't accumulate.
  const initialPool = latestQuizPool<TrendingPool>("trending");
  const initialQs = initialPool?.questions ?? [];

  const checkpoint = () => {
    if (args.dry) return;
    if (generated.length === lastCheckpoint) return;
    // dedupe new generations against existing pool (by question id)
    const seenIds = new Set(initialQs.map((q) => q.id));
    const fresh = generated.filter((q) => {
      if (seenIds.has(q.id)) return false;
      seenIds.add(q.id);
      return true;
    });
    const merged: TrendingPool = {
      questions: [...initialQs, ...fresh.slice(0, args.count)],
      builtAt: new Date().toISOString(),
      sample: initialPool?.sample ?? 0,
      perKind: {},
    };
    for (const q of merged.questions) merged.perKind[q.kind] = (merged.perKind[q.kind] ?? 0) + 1;
    saveQuizPool("trending", null, merged);
    lastCheckpoint = generated.length;
  };

  await runConcurrent(allBatches, args.concurrency, async (seeds, i) => {
    if (generated.length >= args.count) return;
    try {
      const t0 = Date.now();
      const llmQs = await callLlm(args, seeds);
      const tq = llmQs
        .map((q) => llmToTrendingQuestion(q, byId))
        .filter((q): q is TrendingQuestion => q !== null);
      // QC filter: drop self-referential / leakage questions
      const { kept, report } = qcFilter(tq);
      generated.push(...kept);
      batchOk++;
      log.info("batch ok", {
        idx: i,
        seeded: seeds.length,
        raw: tq.length,
        kept: kept.length,
        dropped_reasons: Object.keys(report.reasons).length > 0 ? report.reasons : undefined,
        total: generated.length,
        ms: Date.now() - t0,
      });
      // checkpoint every 50 questions
      if (generated.length - lastCheckpoint >= 50) checkpoint();
    } catch (err) {
      batchFail++;
      log.warn("batch failed", { idx: i, err: String(err).slice(0, 240) });
    }
  });
  checkpoint();

  log.info("llm generation done", {
    requested: args.count,
    produced: generated.length,
    ok: batchOk,
    fail: batchFail,
  });

  if (args.dry) {
    console.log("\n=== SAMPLE (first 3) ===");
    for (const q of generated.slice(0, 3)) {
      console.log(JSON.stringify(q, null, 2));
    }
    process.exit(0);
  }

  // Final pool state is already saved by the last checkpoint() above.
  const final = latestQuizPool<TrendingPool>("trending");
  log.info("pool saved", {
    total_questions: final?.questions.length ?? 0,
    perKind: final?.perKind ?? {},
  });
  process.exit(0);
}

if (import.meta.main) {
  main().catch((err) => {
    log.error("llm-prewarm crashed", { err: String(err) });
    process.exit(1);
  });
}
