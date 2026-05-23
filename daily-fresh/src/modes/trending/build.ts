/**
 * Trending IQ question pool builder.
 *
 * Takes daily.dev posts cached by the pre-warmer and turns them into a pool of
 * multiple-choice questions across six template kinds. Each kind targets a
 * different intuition: upvote feel, source recognition, topic mapping,
 * recency sense, engagement reading, and summary-to-title matching.
 *
 * No LLM is used here — every option set is derived from post metadata
 * (upvotes, comments, tags, source, published date, summary). The whole pool
 * is rebuilt by the cron job every 6h and cached in the `quiz_pools` table.
 *
 * Per-user quizzes are 10 questions sampled round-robin across kinds so each
 * play feels varied even when the same pool is reused.
 */

import { richPosts, trendingPosts, type CachedPost } from "../../db/repo";
import { qcFilter } from "./qc";
import { log } from "../../lib/logger";

/** All supported question template kinds. Used as a discriminator on TrendingQuestion. */
export type QuestionType =
  | "guessUpvotes"
  | "whoseTitle"
  | "tagOfPost"
  | "postAge"
  | "engagementType"
  | "summaryMatch"
  | "factTrivia"; // LLM-generated (see src/jobs/llm-prewarm.ts)

export interface TrendingQuestion {
  id: string;
  kind: QuestionType;
  prompt: string;
  postTitle: string;
  postUrl: string;
  postPermalink: string;
  imageUrl?: string | null;
  source?: string;
  options: string[];
  answerIndex: number;
  meta: {
    upvotes: number;
    comments: number;
    tags: string[];
    publishedAt: string | null;
    summary?: string | null;
  };
}

export interface TrendingPool {
  questions: TrendingQuestion[];
  builtAt: string;
  sample: number;
  perKind: Record<string, number>;
}

const UPVOTE_BUCKETS: Array<{ label: string; lo: number; hi: number }> = [
  { label: "under 25", lo: 0, hi: 24 },
  { label: "25–99", lo: 25, hi: 99 },
  { label: "100–249", lo: 100, hi: 249 },
  { label: "250–499", lo: 250, hi: 499 },
  { label: "500+", lo: 500, hi: Infinity },
];

const AGE_BUCKETS: Array<{ label: string; maxDays: number }> = [
  { label: "this week", maxDays: 7 },
  { label: "this month", maxDays: 30 },
  { label: "this quarter", maxDays: 90 },
  { label: "older", maxDays: Infinity },
];

const UPVOTE_PROMPTS = [
  "How many upvotes did this post get?",
  "Pick the upvote bracket.",
  "Where did this land on daily.dev?",
  "Best guess — how many people upvoted?",
];

const SOURCE_PROMPTS = [
  "Which source published this?",
  "Whose blog is this?",
  "Where did this post come from?",
  "Which feed dropped this?",
];

const TAG_PROMPTS = [
  "Which tag fits this post best?",
  "Pick the primary topic.",
  "What's this post actually about?",
];

const AGE_PROMPTS = [
  "How recent is this post?",
  "When did this drop?",
  "What's the vintage on this one?",
];

const ENGAGEMENT_PROMPTS = [
  "Did this post spark more upvotes or more comments?",
  "What dominated — upvotes or discussion?",
  "Was this a like-fest or a debate?",
];

const SUMMARY_PROMPTS = [
  "Which post does this summary describe?",
  "Match the summary to its title.",
  "Pick the post this teaser belongs to.",
];

function pickRandom<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

function shuffleInPlace<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function permalink(post: CachedPost): string {
  try {
    const raw = JSON.parse(post.raw_json);
    if (raw.commentsPermalink) return raw.commentsPermalink as string;
  } catch {}
  return post.url;
}

function imageUrl(post: CachedPost): string | null {
  try {
    const raw = JSON.parse(post.raw_json);
    return raw.image ?? null;
  } catch {
    return null;
  }
}

function summary(post: CachedPost): string | null {
  try {
    const raw = JSON.parse(post.raw_json);
    if (typeof raw.summary === "string" && raw.summary.length >= 30) return raw.summary;
  } catch {}
  return null;
}

function ageDays(post: CachedPost): number {
  const iso = post.published_at ?? post.created_at;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 9999;
  return (Date.now() - t) / 86_400_000;
}

function postMeta(post: CachedPost, tags: string[]) {
  return {
    upvotes: post.num_upvotes,
    comments: post.num_comments,
    tags,
    publishedAt: post.published_at,
    summary: summary(post),
  };
}

function baseQ(post: CachedPost, tags: string[], kind: QuestionType, idPrefix: string) {
  return {
    postTitle: post.title,
    postUrl: post.url,
    postPermalink: permalink(post),
    imageUrl: imageUrl(post),
    source: post.source_name,
    id: `${idPrefix}_${post.id}`,
    kind,
    meta: postMeta(post, tags),
  };
}

// Question builders
function makeUpvoteQ(post: CachedPost, tags: string[], rng: () => number): TrendingQuestion | null {
  const idx = UPVOTE_BUCKETS.findIndex((b) => post.num_upvotes >= b.lo && post.num_upvotes <= b.hi);
  if (idx < 0) return null;
  const correct = UPVOTE_BUCKETS[idx]!.label;
  const options = shuffleInPlace(UPVOTE_BUCKETS.map((b) => b.label).slice(), rng);
  return {
    ...baseQ(post, tags, "guessUpvotes", "gu"),
    prompt: pickRandom(UPVOTE_PROMPTS, rng),
    options,
    answerIndex: options.indexOf(correct),
  };
}

function makeSourceQ(
  post: CachedPost,
  tags: string[],
  rng: () => number,
  sources: string[],
): TrendingQuestion | null {
  if (sources.length < 4) return null;
  const distractors = sources.filter((s) => s !== post.source_name);
  shuffleInPlace(distractors, rng);
  const opts = shuffleInPlace([post.source_name, ...distractors.slice(0, 3)], rng);
  return {
    ...baseQ(post, tags, "whoseTitle", "wt"),
    prompt: pickRandom(SOURCE_PROMPTS, rng),
    options: opts,
    answerIndex: opts.indexOf(post.source_name),
  };
}

function makeTagQ(
  post: CachedPost,
  tags: string[],
  rng: () => number,
  tagPool: string[],
): TrendingQuestion | null {
  if (tags.length === 0) return null;
  const correct = tags[0]!;
  if (!tagPool.includes(correct)) return null;
  const distractors = tagPool.filter((t) => !tags.includes(t));
  if (distractors.length < 3) return null;
  shuffleInPlace(distractors, rng);
  const opts = shuffleInPlace([correct, ...distractors.slice(0, 3)], rng);
  return {
    ...baseQ(post, tags, "tagOfPost", "tp"),
    prompt: pickRandom(TAG_PROMPTS, rng),
    options: opts,
    answerIndex: opts.indexOf(correct),
  };
}

function makeAgeQ(post: CachedPost, tags: string[], rng: () => number): TrendingQuestion | null {
  const days = ageDays(post);
  const idx = AGE_BUCKETS.findIndex((b) => days <= b.maxDays);
  if (idx < 0) return null;
  const correct = AGE_BUCKETS[idx]!.label;
  const options = shuffleInPlace(AGE_BUCKETS.map((b) => b.label).slice(), rng);
  return {
    ...baseQ(post, tags, "postAge", "pa"),
    prompt: pickRandom(AGE_PROMPTS, rng),
    options,
    answerIndex: options.indexOf(correct),
  };
}

function makeEngagementQ(post: CachedPost, tags: string[], rng: () => number): TrendingQuestion | null {
  // Only interesting when ratio is decisive.
  if (post.num_upvotes < 30 && post.num_comments < 10) return null;
  // ratio: comments_per_upvote
  const ratio = post.num_comments / Math.max(1, post.num_upvotes);
  let correct: string;
  if (ratio >= 0.15) correct = "Big discussion";
  else if (ratio >= 0.05) correct = "Balanced";
  else correct = "Mostly upvotes";

  const options = shuffleInPlace(
    ["Big discussion", "Balanced", "Mostly upvotes", "Barely noticed"].slice(),
    rng,
  );
  // If post is small enough, "barely noticed" becomes correct
  if (post.num_upvotes < 30 && post.num_comments < 3) correct = "Barely noticed";
  return {
    ...baseQ(post, tags, "engagementType", "et"),
    prompt: pickRandom(ENGAGEMENT_PROMPTS, rng),
    options,
    answerIndex: options.indexOf(correct),
  };
}

function makeSummaryQ(
  post: CachedPost,
  tags: string[],
  rng: () => number,
  otherTitles: string[],
): TrendingQuestion | null {
  const s = summary(post);
  if (!s) return null;
  if (otherTitles.length < 3) return null;
  const distractors = otherTitles.filter((t) => t !== post.title);
  shuffleInPlace(distractors, rng);
  const opts = shuffleInPlace([post.title, ...distractors.slice(0, 3)], rng);
  return {
    ...baseQ(post, tags, "summaryMatch", "sm"),
    // For summary mode, "postTitle" becomes the summary text and the question asks
    // user to pick the matching title from options.
    postTitle: s,
    prompt: pickRandom(SUMMARY_PROMPTS, rng),
    options: opts,
    answerIndex: opts.indexOf(post.title),
  };
}

function collectTopTags(posts: CachedPost[], limit: number): string[] {
  const count = new Map<string, number>();
  for (const p of posts) {
    if (!p.tags_csv) continue;
    for (const t of p.tags_csv.split(",")) {
      if (!t) continue;
      count.set(t, (count.get(t) ?? 0) + 1);
    }
  }
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([t]) => t);
}

/**
 * Build the full question pool from cached posts.
 *
 * Two source pools are drawn:
 * - `richPosts` — posts with image + summary + ≥50 upvotes. Used for summary-match
 *   and source-guess kinds where a pretty card and a real summary matter.
 * - `trendingPosts` — broader pool (≥10 upvotes). Used for upvote/tag/age/engagement
 *   kinds where any decent post works.
 *
 * Target ~20 questions per kind so 10-question quizzes can sample without exhaustion.
 */
export function buildTrendingPool(): TrendingPool {
  const rng = mulberry32(Date.now() & 0xffffffff);

  // rich = images + summary + upvotes for premium Qs
  const rich = richPosts({ minUpvotes: 50, limit: 120, sinceHours: 24 * 30 });
  // looser pool for upvote/age/engagement (no summary needed)
  const broad = trendingPosts({ minUpvotes: 10, limit: 300, sinceHours: 24 * 30 });

  const sources = [...new Set(broad.map((p) => p.source_name))];
  const tagPool = collectTopTags(broad, 24);
  const richTitles = rich.map((p) => p.title);

  const questions: TrendingQuestion[] = [];

  // Per-kind targets
  const targets: Record<QuestionType, number> = {
    guessUpvotes: 22,
    whoseTitle: 20,
    tagOfPost: 22,
    postAge: 18,
    engagementType: 18,
    summaryMatch: 20,
    factTrivia: 0, // LLM-generated separately
  };

  function takeFromRich(): CachedPost[] { return shuffleInPlace(rich.slice(), rng); }
  function takeFromBroad(): CachedPost[] { return shuffleInPlace(broad.slice(), rng); }

  // upvote — broad ok
  for (const p of takeFromBroad()) {
    if (questions.filter((q) => q.kind === "guessUpvotes").length >= targets.guessUpvotes) break;
    const tags = p.tags_csv ? p.tags_csv.split(",").filter(Boolean) : [];
    const q = makeUpvoteQ(p, tags, rng);
    if (q) questions.push(q);
  }

  // source — prefer rich (image makes card pretty)
  for (const p of takeFromRich()) {
    if (questions.filter((q) => q.kind === "whoseTitle").length >= targets.whoseTitle) break;
    const tags = p.tags_csv ? p.tags_csv.split(",").filter(Boolean) : [];
    const q = makeSourceQ(p, tags, rng, sources);
    if (q) questions.push(q);
  }

  // tag — broad
  for (const p of takeFromBroad()) {
    if (questions.filter((q) => q.kind === "tagOfPost").length >= targets.tagOfPost) break;
    const tags = p.tags_csv ? p.tags_csv.split(",").filter(Boolean) : [];
    const q = makeTagQ(p, tags, rng, tagPool);
    if (q) questions.push(q);
  }

  // age — broad
  for (const p of takeFromBroad()) {
    if (questions.filter((q) => q.kind === "postAge").length >= targets.postAge) break;
    const tags = p.tags_csv ? p.tags_csv.split(",").filter(Boolean) : [];
    const q = makeAgeQ(p, tags, rng);
    if (q) questions.push(q);
  }

  // engagement — broad
  for (const p of takeFromBroad()) {
    if (questions.filter((q) => q.kind === "engagementType").length >= targets.engagementType) break;
    const tags = p.tags_csv ? p.tags_csv.split(",").filter(Boolean) : [];
    const q = makeEngagementQ(p, tags, rng);
    if (q) questions.push(q);
  }

  // summary — needs rich + other titles for distractors
  for (const p of takeFromRich()) {
    if (questions.filter((q) => q.kind === "summaryMatch").length >= targets.summaryMatch) break;
    const tags = p.tags_csv ? p.tags_csv.split(",").filter(Boolean) : [];
    const q = makeSummaryQ(p, tags, rng, richTitles);
    if (q) questions.push(q);
  }

  shuffleInPlace(questions, rng);

  // Quality control — drop questions where the answer leaks from prompt/title/source.
  const { kept, report } = qcFilter(questions);
  log.info("trending pool qc", report);

  const perKind: Record<string, number> = {};
  for (const q of kept) perKind[q.kind] = (perKind[q.kind] ?? 0) + 1;

  return {
    questions: kept,
    builtAt: new Date().toISOString(),
    sample: broad.length,
    perKind,
  };
}

/**
 * Pick `n` questions from a pool, round-robin across kinds.
 *
 * Goal: every quiz session feels varied even when the underlying pool is the
 * same. We don't dedupe across sessions — relying on random pickup + round-robin
 * to make repeat plays feel different.
 */
export function sampleQuestions(pool: TrendingPool, n = 10): TrendingQuestion[] {
  const byKind = new Map<QuestionType, TrendingQuestion[]>();
  for (const q of pool.questions) {
    if (!byKind.has(q.kind)) byKind.set(q.kind, []);
    byKind.get(q.kind)!.push(q);
  }
  for (const arr of byKind.values()) shuffleInPlace(arr, Math.random);

  const out: TrendingQuestion[] = [];
  const kinds = [...byKind.keys()];
  // round-robin
  let i = 0;
  while (out.length < n && kinds.length > 0) {
    const k = kinds[i % kinds.length]!;
    const arr = byKind.get(k)!;
    if (arr.length === 0) {
      kinds.splice(i % kinds.length, 1);
      continue;
    }
    const picked = arr.shift()!;
    out.push(picked);
    i++;
  }
  return out;
}
