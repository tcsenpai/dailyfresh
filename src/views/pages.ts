/**
 * Server-rendered HTML pages for daily.fresh.
 *
 * Pages: / (home), /about, /trending (quiz), /r/:id (result).
 * Interactivity via Alpine.js; JSON payloads embedded in
 * <script type="application/json"> tags (apostrophe-safe).
 * Visual layer: daily.dev food-named palette + retro-arcade display type
 * + Vercel-tier motion. Tokens live in public/style.css.
 */

import { layout, escape } from "./layout";
import { mascot } from "./mascot";
import type { TrendingQuestion } from "../modes/trending/build";

function jsonScript(id: string, value: unknown): string {
  const raw = JSON.stringify(value)
    .replace(/<\/script/gi, "<\\/script")
    .replace(/<!--/g, "<\\!--");
  return `<script id="${id}" type="application/json">${raw}</script>`;
}

/* ---------------- HOME ---------------- */
export function homePage(): string {
  const body = `
<section class="hero">
  <div class="hero-text">
    <span class="kicker">daily.dev hackathon 2026</span>
    <h1>How <span class="accent">fresh</span> are you on this week's dev discourse?</h1>
    <p class="lead">Ten questions about what actually trended on daily.dev. Real titles, real upvotes, real comments. No fluff.</p>
    <div class="cta-row">
      <a href="/trending" class="btn btn-hero">Take the quiz &rarr;</a>
      <a href="/about" class="btn btn-ghost">How it works</a>
    </div>
  </div>
  <div class="hero-meta">
    <div class="stat">
      <div class="stat-num tnum" id="stat-questions">&mdash;</div>
      <div class="stat-label">Questions<br/>in the pool</div>
    </div>
    <div class="stat">
      <div class="stat-num tnum" id="stat-sources">&mdash;</div>
      <div class="stat-label">Sources<br/>covered</div>
    </div>
    <div class="stat">
      <div class="stat-num tnum">6H</div>
      <div class="stat-label">Refresh<br/>cadence</div>
    </div>
  </div>
</section>

<section class="how">
  <h2>What you'll be asked</h2>
  <div class="how-grid">
    <div class="how-card">
      <span class="how-icon">⬆</span>
      <h3>Guess the upvotes</h3>
      <p>Real posts. Pick the right bucket.</p>
    </div>
    <div class="how-card">
      <span class="how-icon">🔗</span>
      <h3>Whose post is this?</h3>
      <p>Match titles to publishers.</p>
    </div>
    <div class="how-card">
      <span class="how-icon">🏷</span>
      <h3>Pick the tag</h3>
      <p>Which topic best fits?</p>
    </div>
    <div class="how-card">
      <span class="how-icon">📅</span>
      <h3>How recent?</h3>
      <p>This week, this month, ancient?</p>
    </div>
    <div class="how-card">
      <span class="how-icon">💬</span>
      <h3>Hot take radar</h3>
      <p>Comments or upvotes — which dominated?</p>
    </div>
    <div class="how-card">
      <span class="how-icon">🪞</span>
      <h3>Summary &rarr; title</h3>
      <p>Match a summary to its post.</p>
    </div>
  </div>
</section>

<script>
// animate stats from 0 to target
function animateNum(el, target) {
  if (!el) return;
  const start = performance.now();
  const dur = 800;
  function tick(t) {
    const k = Math.min(1, (t - start) / dur);
    const eased = 1 - Math.pow(1 - k, 3);
    el.textContent = Math.round(target * eased).toString();
    if (k < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
fetch('/api/trending/stats').then(r => r.json()).then(s => {
  animateNum(document.getElementById('stat-questions'), s.questions || 0);
  animateNum(document.getElementById('stat-sources'), s.sources || 0);
}).catch(() => {});
</script>
${mascot({ context: "home" })}
`;
  return layout({ title: "daily.fresh", children: body });
}

/* ---------------- ABOUT ---------------- */
export function aboutPage(): string {
  const body = `
<section class="prose">
  <span class="kicker">colophon</span>
  <h1>About <span class="accent">daily.fresh</span></h1>
  <p>A single-purpose quiz: how well do you keep up with this week's dev discourse on daily.dev?</p>
  <h2>How questions are made</h2>
  <p>A pre-warmer hits the daily.dev Public API every six hours, pulling top trending posts across the major dev topics. Each post becomes raw material for one of seven question kinds — upvote-guessing, source-matching, tag-classification, age-detection, engagement-reading, summary-to-title, and LLM-generated trivia.</p>
  <p>No live API calls happen when you take the quiz. Everything serves from a local cache, so each question lands in milliseconds.</p>
  <h2>Why it's not personalized</h2>
  <p>daily.dev's Public API requires a Personal Access Token, and visitors don't share theirs. We use one PAT to build a global question pool. The quiz is the same for everyone, which makes scores comparable.</p>
  <h2>Stack</h2>
  <p>Bun · Elysia · SQLite · Redis · <code>satori</code> for share cards · Docker + Caddy for self-host. Designed in the open, deployed in an evening. <a href="https://docs.daily.dev/docs/plus/public-api" target="_blank" rel="noreferrer">daily.dev Public API docs</a>.</p>
  <p style="margin-top: 32px;"><a href="/trending" class="btn btn-primary">Take the quiz &rarr;</a></p>
</section>
${mascot({ context: "about" })}
`;
  return layout({ title: "About", children: body });
}

/* ---------------- QUIZ ---------------- */
interface TrendingQuizPagePayload {
  sessionId: string;
  questions: Array<Omit<TrendingQuestion, "answerIndex" | "meta">>;
}

export function trendingQuizPage(p: TrendingQuizPagePayload): string {
  const body = `
${jsonScript("trending-questions", p.questions)}
<section x-data="quizApp()" x-init="init()" class="quiz-shell" :class="{ 'is-calculating': calculating }">

  <!-- short typewriter intro -->
  <template x-if="phase === 'intro'">
    <div class="quiz-intro">
      <p class="typewriter" x-text="introText"></p>
    </div>
  </template>

  <!-- TOP HUD: sticky bar w/ Q counter + progress dots + mode toggle -->
  <div class="quiz-hud" x-show="phase === 'quiz'" x-transition.opacity.duration.300ms>
    <div class="hud-counter tnum">
      <span class="hud-num" x-text="(currentIdx + 1).toString().padStart(2, '0')"></span>
      <span class="hud-slash">/</span>
      <span class="hud-total tnum" x-text="questions.length.toString().padStart(2, '0')"></span>
    </div>
    <div class="hud-dots" role="progressbar" :aria-valuenow="Object.keys(answers).length" :aria-valuemax="questions.length">
      <template x-for="(q, i) in questions" :key="q.id">
        <button type="button" class="hud-dot"
          :class="{ done: answers[q.id] !== undefined, here: i === currentIdx }"
          @click="jumpTo(i)"
          :aria-label="'Question ' + (i+1)"></button>
      </template>
    </div>
    <div class="hud-mode">
      <button type="button" :class="{ active: mode === 'focus' }" @click="mode='focus'" aria-label="Focus mode">●</button>
      <button type="button" :class="{ active: mode === 'list' }" @click="mode='list'" aria-label="List mode">≡</button>
    </div>
  </div>

  <!-- FOCUS MODE (default) — one question, centered, full attention -->
  <template x-if="phase === 'quiz' && mode === 'focus'">
    <div class="focus-shell">
      <div class="qcard focus" :key="currentIdx" :class="{ 'flash': flashIdx === currentIdx }">
        <div class="qcard-head">
          <span class="qkind" x-text="kindLabel(currentQ().kind)"></span>
        </div>
        <h2 class="qprompt-big" x-text="currentQ().prompt"></h2>
        <div class="postref large" x-show="currentQ().postTitle">
          <template x-if="currentQ().imageUrl">
            <img :src="currentQ().imageUrl" :alt="currentQ().postTitle" loading="lazy" class="postref-img large" onerror="this.style.display='none'" />
          </template>
          <div class="postref-body">
            <div class="postref-title large" x-text="currentQ().postTitle"></div>
            <div class="postref-meta" x-show="currentQ().source"><span x-text="currentQ().source"></span></div>
          </div>
        </div>
        <div class="opts focus">
          <template x-for="(opt, idx) in currentQ().options" :key="idx">
            <button type="button" class="opt large"
              :class="{ selected: answers[currentQ().id] === idx }"
              @click="pick(idx)"
              x-text="opt"></button>
          </template>
        </div>
        <div class="focus-nav">
          <button class="btn btn-ghost" type="button" @click="prevQ()" :disabled="currentIdx === 0">&larr; Prev</button>
          <button class="btn btn-primary" type="button"
            x-show="currentIdx === questions.length - 1 && Object.keys(answers).length === questions.length"
            @click="submit()">Finish &rarr;</button>
          <button class="btn btn-ghost" type="button"
            x-show="!(currentIdx === questions.length - 1 && Object.keys(answers).length === questions.length)"
            @click="nextQ()" :disabled="currentIdx === questions.length - 1">Next &rarr;</button>
        </div>
      </div>
    </div>
  </template>

  <!-- LIST MODE (power users) — all 10 stacked -->
  <template x-if="phase === 'quiz' && mode === 'list'">
    <div class="list-shell">
      <template x-for="(q, i) in questions" :key="q.id">
        <div class="qcard" :class="{ answered: answers[q.id] !== undefined }" :style="'animation-delay:' + (i * 40) + 'ms;'">
          <div class="qcard-head">
            <span class="qnum" x-text="'Q' + (i+1).toString().padStart(2, '0')"></span>
            <span class="qkind" x-text="kindLabel(q.kind)"></span>
            <span class="qprompt" x-text="q.prompt"></span>
          </div>
          <div class="postref">
            <template x-if="q.imageUrl">
              <img :src="q.imageUrl" :alt="q.postTitle" loading="lazy" class="postref-img" onerror="this.style.display='none'" />
            </template>
            <div class="postref-body">
              <div class="postref-title" x-text="q.postTitle"></div>
              <div class="postref-meta" x-show="q.source"><span x-text="q.source"></span></div>
            </div>
          </div>
          <div class="opts">
            <template x-for="(opt, idx) in q.options" :key="idx">
              <button type="button" class="opt"
                :class="{ selected: answers[q.id] === idx }"
                @click="answers[q.id] = idx"
                x-text="opt"></button>
            </template>
          </div>
        </div>
      </template>
      <div class="list-submit">
        <button class="btn btn-primary" @click="submit()"
          :disabled="submitting || Object.keys(answers).length < questions.length">
          <span x-show="!submitting">Submit (<span x-text="Object.keys(answers).length"></span>/<span x-text="questions.length"></span>)</span>
          <span x-show="submitting">Scoring&hellip;</span>
        </button>
      </div>
    </div>
  </template>

  <!-- CALCULATING screen — between submit + redirect -->
  <template x-if="phase === 'calculating'">
    <div class="calc-screen">
      <svg class="calc-meter" viewBox="0 0 120 120" width="120" height="120" aria-hidden="true">
        <circle cx="60" cy="60" r="48" fill="none" stroke="rgba(168,179,207,0.12)" stroke-width="6"/>
        <circle cx="60" cy="60" r="48" fill="none" stroke="url(#calcGrad)" stroke-width="6"
                stroke-linecap="round" stroke-dasharray="80 220" transform="rotate(-90 60 60)">
          <animateTransform attributeName="transform" type="rotate" from="-90 60 60" to="270 60 60" dur="1.4s" repeatCount="indefinite"/>
        </circle>
        <defs>
          <linearGradient id="calcGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#ffe923"/>
            <stop offset="50%" stop-color="#ff8e3b"/>
            <stop offset="100%" stop-color="#fc538d"/>
          </linearGradient>
        </defs>
      </svg>
      <p class="calc-text">Calculating freshness<span class="calc-dots">&hellip;</span></p>
    </div>
  </template>

  <p class="muted quiz-error" x-show="errorMsg" x-text="errorMsg"></p>
</section>

<script>
const KIND_LABELS = {
  guessUpvotes: "Upvotes",
  whoseTitle: "Source",
  tagOfPost: "Tag",
  postAge: "Age",
  engagementType: "Hot-take",
  summaryMatch: "Summary",
  factTrivia: "Trivia",
};
function quizApp() {
  return {
    questions: [],
    answers: {},
    submitting: false,
    calculating: false,
    errorMsg: "",
    mode: "focus",
    currentIdx: 0,
    flashIdx: -1,
    phase: "intro", // "intro" | "quiz" | "calculating"
    introText: "",
    init() {
      const node = document.getElementById("trending-questions");
      this.questions = JSON.parse(node.textContent);
      this.runIntro();
      // global keyboard nav
      document.addEventListener("keydown", (e) => {
        if (this.phase === "intro" && (e.key === "Enter" || e.key === " " || e.key === "Escape")) {
          this.phase = "quiz";
          return;
        }
        if (this.phase !== "quiz") return;
        if (e.key === "ArrowRight" || e.key === "j") this.nextQ();
        else if (e.key === "ArrowLeft" || e.key === "k") this.prevQ();
        else if (e.key === "l") this.mode = this.mode === "focus" ? "list" : "focus";
        else if (e.key >= "1" && e.key <= "4" && this.mode === "focus") {
          const idx = parseInt(e.key, 10) - 1;
          if (this.currentQ().options && idx < this.currentQ().options.length) this.pick(idx);
        }
      });
    },
    runIntro() {
      const phrase = "> daily.dev → daily.fresh_";
      let i = 0;
      const tick = () => {
        if (this.phase !== "intro") return;
        if (i <= phrase.length) {
          this.introText = phrase.slice(0, i);
          i++;
          setTimeout(tick, 18);
        } else {
          setTimeout(() => { if (this.phase === "intro") this.phase = "quiz"; }, 520);
        }
      };
      tick();
    },
    kindLabel(k) { return KIND_LABELS[k] || k; },
    currentQ() { return this.questions[this.currentIdx] || {}; },
    nextQ() { if (this.currentIdx < this.questions.length - 1) this.currentIdx++; },
    prevQ() { if (this.currentIdx > 0) this.currentIdx--; },
    jumpTo(i) { if (i >= 0 && i < this.questions.length) this.currentIdx = i; },
    pick(idx) {
      this.answers[this.currentQ().id] = idx;
      this.flashIdx = this.currentIdx;
      setTimeout(() => { this.flashIdx = -1; }, 180);
      // auto-advance unless last question
      if (this.currentIdx < this.questions.length - 1) {
        setTimeout(() => this.nextQ(), 220);
      }
    },
    async submit() {
      if (Object.keys(this.answers).length < this.questions.length) return;
      this.submitting = true;
      this.errorMsg = "";
      this.phase = "calculating";
      const minDelay = new Promise((res) => setTimeout(res, 1400));
      try {
        const payload = { answers: Object.entries(this.answers).map(([id, choice]) => ({ id, choice })) };
        const fetchPromise = fetch("/api/trending/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const [res] = await Promise.all([fetchPromise, minDelay]);
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        window.location.href = "/r/" + data.id;
      } catch (err) {
        this.errorMsg = "Submit failed: " + String(err);
        this.submitting = false;
        this.phase = "quiz";
      }
    },
  };
}
</script>
${mascot({ context: "quiz" })}
`;
  return layout({
    title: "Trending IQ Quiz",
    description: "Ten questions about this week's top daily.dev posts.",
    minimalTopbar: true,
    hideFooter: true,
    children: body,
  });
}

/* ---------------- LEADERBOARD ---------------- */
interface LeaderboardRow {
  rank: number;
  handle: string;
  uid: string | null;
  score: number;
  maxScore: number;
  percent: number;
  resultId: string | null;
  createdAt: string;
}

interface LeaderboardPayload {
  allTime: LeaderboardRow[];
  week: LeaderboardRow[];
  meUid: string | null;
}

function leaderboardTable(rows: LeaderboardRow[], meUid: string | null): string {
  if (rows.length === 0) {
    return `<div class="lb-empty"><p class="muted">No scores yet. Be the first.</p><a class="btn btn-primary" href="/trending">Take the quiz &rarr;</a></div>`;
  }
  return `
<div class="lb-table">
  ${rows
    .map((r) => {
      const mine = !!(meUid && r.uid && meUid === r.uid);
      const dateStr = r.createdAt.slice(0, 16).replace("T", " ");
      return `
    <div class="lb-row ${mine ? "mine" : ""} ${r.rank <= 3 ? "rank-" + r.rank : ""}">
      <div class="lb-rank tnum">#${r.rank}</div>
      <div class="lb-handle">
        <div class="lb-name">${escape(r.handle)}${mine ? '<span class="lb-you">YOU</span>' : ""}</div>
        <div class="lb-when muted">${escape(dateStr)} UTC${r.resultId ? ` &middot; <a href="/r/${escape(r.resultId)}">view</a>` : ""}</div>
      </div>
      <div class="lb-score">
        <div class="lb-pct tnum">${r.percent}%</div>
        <div class="lb-sub muted tnum">${r.score}/${r.maxScore}</div>
      </div>
    </div>`;
    })
    .join("")}
</div>`;
}

export function leaderboardPage(p: LeaderboardPayload): string {
  const body = `
<section x-data="{ tab: 'week' }">
  <span class="kicker">leaderboard</span>
  <h1>Who's the <span class="accent">freshest</span>?</h1>
  <p class="lead">Per-player best run. Set a nickname after any quiz and your scores stick.</p>

  <div class="mode-toggle" style="margin-bottom: 24px;">
    <button :class="{active: tab === 'week'}" @click="tab='week'" type="button">This week</button>
    <button :class="{active: tab === 'all'}" @click="tab='all'" type="button">All time</button>
  </div>

  <div x-show="tab === 'week'">
    ${leaderboardTable(p.week, p.meUid)}
  </div>
  <div x-show="tab === 'all'" style="display:none;">
    ${leaderboardTable(p.allTime, p.meUid)}
  </div>

  <div style="margin-top: 40px; display: flex; gap: 12px; flex-wrap: wrap;">
    <a class="btn btn-primary" href="/trending">Take the quiz &rarr;</a>
  </div>
</section>
${mascot({ context: "leaderboard" })}
`;
  return layout({
    title: "Leaderboard",
    description: "Top scores on this week's daily.fresh Trending IQ",
    hideFooter: true,
    children: body,
  });
}

/* ---------------- RESULT ---------------- */
interface ResultPayload {
  id: string;
  score: number;
  maxScore: number;
  percent: number;
  shareUrl: string;
  ogImage?: string;
  breakdown: Array<{ correct: boolean; postTitle: string; postPermalink: string }>;
}

export function resultPage(r: ResultPayload): string {
  const tweet = `I scored ${r.score}/${r.maxScore} (${r.percent}%) on this week's Trending IQ. daily.fresh ${r.shareUrl} #dailydevhackathon @dailydotdev`;
  const verdict =
    r.percent >= 80 ? "Extremely fresh" : r.percent >= 60 ? "Pretty fresh" : r.percent >= 40 ? "Lukewarm" : "Catch up time";
  const celebrate = r.percent >= 80;

  const body = `
<section class="result">
  <div class="result-hero">
    <span class="kicker">trending iq · this week</span>
    ${freshOMeter(r.percent)}
    <div class="result-num tnum">${r.score}<span class="result-num-small">/${r.maxScore}</span></div>
    <div class="result-pct">${r.percent}% CORRECT</div>
    <div class="result-verdict">${escape(verdict)}</div>

    <div class="handle-block" x-data="handleBlock('${escape(r.id)}', ${r.score}, ${r.maxScore})" x-init="init()">
      <template x-if="loading">
        <p class="muted handle-loading">&hellip;</p>
      </template>
      <template x-if="!loading && handle">
        <div class="handle-saved">
          <p class="muted handle-saved-line">
            Saved as <strong x-text="handle" class="handle-name"></strong>
            <button type="button" class="handle-rename-link" @click="editing = true" x-show="canRename && !editing">rename (one-shot)</button>
            <span x-show="!canRename" class="muted handle-locked">handle locked</span>
          </p>
          <div x-show="editing" class="handle-edit">
            <input class="handle-input" x-model="newHandle" placeholder="new handle (last chance)" maxlength="24" />
            <button class="btn btn-primary" type="button" @click="rename()" :disabled="!newHandle || saving">
              <span x-show="!saving">Save (final)</span><span x-show="saving">&hellip;</span>
            </button>
            <button class="btn btn-ghost" type="button" @click="editing = false">Cancel</button>
          </div>
        </div>
      </template>
      <template x-if="!loading && !handle">
        <div class="handle-claim">
          <p class="kicker handle-cta">Land on leaderboard</p>
          <div class="handle-row">
            <input class="handle-input" x-model="newHandle" placeholder="pick a nickname" maxlength="24" @keydown.enter="claim()" />
            <button class="btn btn-primary" type="button" @click="claim()" :disabled="!newHandle || saving">
              <span x-show="!saving && !claimed">Save score</span>
              <span x-show="saving">&hellip;</span>
              <span x-show="claimed">Saved &check;</span>
            </button>
          </div>
          <p class="muted handle-hint">Stored in a cookie. No signup, no email.</p>
        </div>
      </template>
    </div>

    <div class="share-row">
      <a target="_blank" rel="noreferrer" class="btn btn-primary" href="https://twitter.com/intent/tweet?text=${encodeURIComponent(tweet)}">Share on X</a>
      <a target="_blank" rel="noreferrer" class="btn btn-ghost" href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(r.shareUrl)}">LinkedIn</a>
      <a class="btn btn-ghost" href="/leaderboard">Leaderboard</a>
      <a class="btn btn-ghost" href="/trending">Try again</a>
    </div>
  </div>

  <details class="breakdown-details">
    <summary>
      <span class="bd-summary-label">Review your answers</span>
      <span class="bd-summary-count tnum">${r.breakdown.length}</span>
    </summary>
    <div class="breakdown">
      ${r.breakdown
        .map(
          (b, i) => `
        <div class="breakdown-row ${b.correct ? "ok" : "bad"}">
          <div class="bn">${(i + 1).toString().padStart(2, "0")}</div>
          <div>
            <div class="bt-title">${escape(b.postTitle)}</div>
            <a class="bt-link" href="${escape(b.postPermalink)}" target="_blank" rel="noreferrer">Read on daily.dev &rarr;</a>
          </div>
          <div class="bv">${b.correct ? "&check;" : "&times;"}</div>
        </div>`,
        )
        .join("")}
    </div>
  </details>
</section>

${celebrate ? confettiScript() : ""}

<script>
function handleBlock(resultId, score, maxScore) {
  return {
    loading: true,
    handle: null,
    canRename: true,
    newHandle: "",
    saving: false,
    claimed: false,
    editing: false,
    async init() {
      try {
        const r = await fetch("/api/me/");
        const d = await r.json();
        this.handle = d.handle || null;
        this.canRename = d.canRename !== false;
      } catch {}
      this.loading = false;
    },
    async claim() {
      if (!this.newHandle.trim()) return;
      this.saving = true;
      try {
        const r = await fetch("/api/me/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ handle: this.newHandle }),
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error(err.message || ("HTTP " + r.status));
        }
        const me = await r.json();
        this.handle = me.handle;
        this.canRename = me.canRename !== false;
        await fetch("/api/trending/land", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resultId }),
        });
        this.claimed = true;
      } catch (err) {
        alert("Save failed: " + err.message);
      } finally {
        this.saving = false;
      }
    },
    async rename() {
      if (!this.newHandle.trim()) return;
      if (!confirm("Renaming is one-time. After this you can't change your handle again. Continue?")) return;
      this.saving = true;
      try {
        const r = await fetch("/api/me/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ handle: this.newHandle }),
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error(err.message || ("HTTP " + r.status));
        }
        const me = await r.json();
        this.handle = me.handle;
        this.canRename = me.canRename !== false;
        this.editing = false;
        this.newHandle = "";
      } catch (err) {
        alert("Rename failed: " + err.message);
      } finally {
        this.saving = false;
      }
    },
  };
}
</script>
${mascot({ context: r.percent >= 80 ? "result-high" : r.percent >= 50 ? "result-mid" : "result-low" })}
`;
  return layout({
    title: `${r.score}/${r.maxScore} on Trending IQ`,
    description: `Scored ${r.percent}% on daily.fresh Trending IQ. ${verdict}.`,
    ogImage: r.ogImage,
    hideFooter: true,
    children: body,
  });
}

/**
 * Fresh-O-Meter — animated SVG gauge ring.
 * Stroke-dashoffset animates from full to %, color shifts through rank gradient.
 */
function freshOMeter(pct: number): string {
  const r = 70;
  const cir = 2 * Math.PI * r;
  const dash = cir * (1 - pct / 100);
  return `
<svg class="fresh-meter" viewBox="0 0 180 180" width="180" height="180" aria-hidden="true">
  <defs>
    <linearGradient id="meterGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffe923"/>
      <stop offset="50%" stop-color="#ff8e3b"/>
      <stop offset="100%" stop-color="#fc538d"/>
    </linearGradient>
    <filter id="meterGlow">
      <feGaussianBlur stdDeviation="3" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <circle cx="90" cy="90" r="${r}" fill="none" stroke="rgba(168,179,207,0.12)" stroke-width="10"/>
  <circle cx="90" cy="90" r="${r}" fill="none" stroke="url(#meterGrad)" stroke-width="10"
          stroke-linecap="round" stroke-dasharray="${cir}" stroke-dashoffset="${dash}"
          transform="rotate(-90 90 90)" filter="url(#meterGlow)"
          style="animation: meter-in 1.2s cubic-bezier(0.22,1,0.36,1) backwards;"/>
</svg>
`;
}

/** Vanilla canvas confetti — no external deps, ~50 LoC. */
function confettiScript(): string {
  return `
<canvas id="confetti" style="position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:99;"></canvas>
<script>
(function() {
  const c = document.getElementById('confetti');
  const ctx = c.getContext('2d');
  function resize() { c.width = innerWidth; c.height = innerHeight; }
  resize(); addEventListener('resize', resize);
  const colors = ['#ce3df3','#ffe923','#2cdce6','#fc538d','#39e58c','#ff8e3b','#7147ed'];
  const pieces = [];
  for (let i = 0; i < 140; i++) {
    pieces.push({
      x: Math.random() * c.width,
      y: -20 - Math.random() * 200,
      vx: (Math.random() - 0.5) * 4,
      vy: 2 + Math.random() * 3.5,
      r: 4 + Math.random() * 8,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.25,
      color: colors[Math.floor(Math.random() * colors.length)],
      shape: Math.random() > 0.5 ? 'rect' : 'circle',
    });
  }
  function frame() {
    ctx.clearRect(0, 0, c.width, c.height);
    let alive = false;
    for (const p of pieces) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.04;
      p.rot += p.vr;
      if (p.y < c.height + 40) alive = true;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.shape === 'rect') {
        ctx.fillRect(-p.r/2, -p.r/4, p.r, p.r/2);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.r/2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    if (alive) requestAnimationFrame(frame);
    else c.remove();
  }
  setTimeout(() => requestAnimationFrame(frame), 200);
})();
</script>
`;
}
