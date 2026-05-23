/**
 * Question quality control.
 *
 * Filters out questions whose answer is trivially leaked by the surrounding
 * context (title contains source name, summary contains the title verbatim,
 * etc). Run as a post-processing step on any new question batch (template or
 * LLM-generated).
 */

import type { TrendingQuestion } from "./build";

const STOPWORDS = new Set([
  "the", "a", "an", "of", "to", "in", "on", "and", "or", "for", "with", "is",
  "are", "was", "were", "be", "been", "by", "at", "as", "this", "that", "it",
  "from", "your", "you", "we", "our", "their", "his", "her", "its",
]);

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}

function tokens(s: string): string[] {
  return normalize(s).split(" ").filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/** True if the answer text is substantially echoed by the prompt/title/source. */
function answerLeakedByContext(q: TrendingQuestion): boolean {
  const correct = q.options[q.answerIndex];
  if (!correct) return true;
  const correctTokens = tokens(correct);
  if (correctTokens.length === 0) return false;

  const haystack = `${q.prompt} ${q.postTitle} ${q.source ?? ""}`.toLowerCase();

  // Direct substring of full answer
  if (correct.length >= 4 && haystack.includes(correct.toLowerCase())) return true;

  // ≥60% of meaningful answer tokens present in context
  let hits = 0;
  for (const t of correctTokens) {
    if (haystack.includes(t)) hits++;
  }
  return hits / correctTokens.length >= 0.6;
}

/** Most distractors are obviously wrong from context — too easy. */
function distractorsObvious(q: TrendingQuestion): boolean {
  if (q.options.length < 2) return true;
  const haystack = `${q.prompt} ${q.postTitle} ${q.source ?? ""}`.toLowerCase();
  let distractorHits = 0;
  let distractorTotal = 0;
  for (let i = 0; i < q.options.length; i++) {
    if (i === q.answerIndex) continue;
    distractorTotal++;
    const dtoks = tokens(q.options[i]!);
    if (dtoks.length === 0) continue;
    let any = false;
    for (const t of dtoks) {
      if (haystack.includes(t)) { any = true; break; }
    }
    if (any) distractorHits++;
  }
  // if ALL distractors are also mentioned in haystack, it's ambiguous, not easy.
  if (distractorTotal === 0) return true;
  return false; // disabled — too aggressive without per-kind tuning
}

/** Options have duplicates or empty strings. */
function malformedOptions(q: TrendingQuestion): boolean {
  if (!Array.isArray(q.options) || q.options.length < 2) return true;
  const cleaned = q.options.map((o) => (o ?? "").trim().toLowerCase());
  if (cleaned.some((o) => o.length === 0)) return true;
  if (new Set(cleaned).size !== cleaned.length) return true;
  if (q.answerIndex < 0 || q.answerIndex >= q.options.length) return true;
  return false;
}

/**
 * Per-kind filters specific to each template's failure mode.
 */
function kindSpecificFail(q: TrendingQuestion): string | null {
  if (q.kind === "whoseTitle") {
    // Title literally contains the source name.
    const correct = q.options[q.answerIndex];
    if (correct && q.postTitle.toLowerCase().includes(correct.toLowerCase())) {
      return "title contains source name";
    }
    // Source name has a token that appears in the title (e.g., "Storybook" in "Storybook 10.4").
    const srcTokens = tokens(correct ?? "");
    const titleLow = q.postTitle.toLowerCase();
    for (const tok of srcTokens) {
      if (tok.length >= 5 && titleLow.includes(tok)) {
        return `title token leak: "${tok}"`;
      }
    }
  }

  if (q.kind === "tagOfPost") {
    // Title literally contains the correct tag word.
    const correct = q.options[q.answerIndex];
    if (correct && q.postTitle.toLowerCase().includes(correct.toLowerCase())) {
      return "title contains tag";
    }
  }

  if (q.kind === "factTrivia") {
    // self-referential prompts
    const promptLow = q.prompt.toLowerCase();
    if (
      promptLow.includes("according to the post") ||
      promptLow.includes("according to the article") ||
      promptLow.includes("as mentioned in the post") ||
      promptLow.includes("in this post") ||
      promptLow.includes("in this article") ||
      promptLow.includes("the post mentions") ||
      promptLow.includes("the article mentions")
    ) {
      return "self-referential prompt";
    }
    // answer literally appears in prompt
    if (answerLeakedByContext(q)) return "answer in prompt/title";
  }

  return null;
}

export interface QcReport {
  total: number;
  kept: number;
  dropped: number;
  reasons: Record<string, number>;
}

/**
 * Filter questions, returning the survivors and a per-reason drop report.
 */
export function qcFilter(questions: TrendingQuestion[]): { kept: TrendingQuestion[]; report: QcReport } {
  const kept: TrendingQuestion[] = [];
  const reasons: Record<string, number> = {};

  for (const q of questions) {
    if (malformedOptions(q)) {
      reasons["malformed_options"] = (reasons["malformed_options"] ?? 0) + 1;
      continue;
    }
    const kindFail = kindSpecificFail(q);
    if (kindFail) {
      reasons[kindFail] = (reasons[kindFail] ?? 0) + 1;
      continue;
    }
    kept.push(q);
  }

  return {
    kept,
    report: {
      total: questions.length,
      kept: kept.length,
      dropped: questions.length - kept.length,
      reasons,
    },
  };
}
