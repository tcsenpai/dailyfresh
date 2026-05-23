/**
 * Squarey — abstract mascot.
 *
 * SVG: a square + a 45°-rotated square (rhombus), interlocked, counter-rotating
 * slowly. Two eyes blink. Cabbage glow. Sits bottom-right, speaks contextual
 * lines via a speech bubble.
 *
 * Pure DOM + Alpine.js. No assets. Tiny.
 *
 * Each page passes a tag identifying its context; client-side script picks a
 * random line from that bucket every N seconds.
 */

export type MascotContext =
  | "home"
  | "quiz"
  | "calculating"
  | "result-high"
  | "result-mid"
  | "result-low"
  | "leaderboard"
  | "about";

interface MascotOpts {
  /** Context bucket used to pick lines */
  context: MascotContext;
  /** Optional extra payload injected as data attribute the bubble script can read */
  extra?: Record<string, string | number>;
}

/**
 * Inline the lines as a JSON blob in the page. Client script picks at random.
 * Lines are short, playful, fake-AI; the mascot doesn't actually know anything.
 */
const LINES: Record<MascotContext, string[]> = {
  home: [
    "Welcome. Pick a quiz.",
    "I read every post so you didn't have to.",
    "Ten questions. No login. Easy.",
    "How fresh are you, really?",
    "I'm Squarey. I keep score.",
  ],
  quiz: [
    "Trust your gut.",
    "Halfway. Keep going.",
    "You're doing great.",
    "Don't overthink it.",
    "I won't peek.",
    "Last one's a curveball.",
    "Pick a side.",
    "Vibes count.",
  ],
  calculating: [
    "Crunching the numbers…",
    "Calibrating freshness…",
    "Hold tight.",
  ],
  "result-high": [
    "Extremely online. Respect.",
    "You read too much. Touch grass.",
    "Untouchable.",
    "Daily.dev would hire you.",
  ],
  "result-mid": [
    "Solid. Could be sharper.",
    "Not bad. Run it back.",
    "You skim but you skim well.",
  ],
  "result-low": [
    "Open the app more often.",
    "Catching up time.",
    "Read a few. Come back.",
    "I believe in you. Mostly.",
  ],
  leaderboard: [
    "Climb the ladder.",
    "The freshest dev wins.",
    "Beat your own best.",
  ],
  about: [
    "I'm made of two squares. That's it.",
    "Built in a hackathon week.",
  ],
};

export function mascot(opts: MascotOpts): string {
  const lines = LINES[opts.context];
  const payload = JSON.stringify({ lines, extra: opts.extra ?? {} })
    .replace(/<\/script/gi, "<\\/script")
    .replace(/<!--/g, "<\\!--");

  return `
<script id="mascot-payload" type="application/json">${payload}</script>
<div class="mascot" x-data="squarey()" x-init="init()" :class="{ silent }">
  <button type="button" class="mascot-shape" @click="toggleSilent()" :aria-label="silent ? 'Squarey muted — click to wake up' : 'Squarey — click to mute'">
    <svg viewBox="0 0 80 80" width="64" height="64" aria-hidden="true">
      <defs>
        <linearGradient id="sqGradA" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#ce3df3"/>
          <stop offset="100%" stop-color="#7147ed"/>
        </linearGradient>
        <linearGradient id="sqGradB" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#2cdce6"/>
          <stop offset="100%" stop-color="#39e58c"/>
        </linearGradient>
        <filter id="sqGlow"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      <!-- back square -->
      <g class="sq-back">
        <rect x="12" y="12" width="56" height="56" rx="6" ry="6"
              fill="none" stroke="url(#sqGradA)" stroke-width="3" filter="url(#sqGlow)" />
      </g>
      <!-- front rhombus (square rotated 45°) -->
      <g class="sq-front">
        <rect x="22" y="22" width="36" height="36" rx="4" ry="4"
              fill="none" stroke="url(#sqGradB)" stroke-width="3" filter="url(#sqGlow)" />
      </g>
      <!-- eyes -->
      <g class="sq-eyes">
        <circle class="sq-eye" cx="32" cy="40" r="2.5" fill="#fff"/>
        <circle class="sq-eye" cx="48" cy="40" r="2.5" fill="#fff"/>
      </g>
    </svg>
  </button>
  <div class="mascot-bubble" x-show="showBubble && !silent" x-transition.opacity.duration.250ms>
    <p x-text="currentLine"></p>
  </div>
</div>

<script>
if (typeof window.__squareyDefined === "undefined") {
  window.__squareyDefined = true;
  window.squarey = function() {
    return {
      lines: [],
      extra: {},
      currentLine: "",
      showBubble: false,
      silent: false,
      _timer: null,
      init() {
        try {
          const node = document.getElementById("mascot-payload");
          if (node) {
            const data = JSON.parse(node.textContent);
            this.lines = data.lines || [];
            this.extra = data.extra || {};
          }
        } catch {}
        try { this.silent = localStorage.getItem("dfMascotSilent") === "1"; } catch {}
        if (this.silent) return;
        // initial line after a beat so the page settles first
        setTimeout(() => this.say(), 900);
        // rotate every 18s
        this._timer = setInterval(() => this.say(), 18_000);
      },
      pick() {
        if (!this.lines || this.lines.length === 0) return "";
        return this.lines[Math.floor(Math.random() * this.lines.length)];
      },
      say() {
        if (this.silent) return;
        const next = this.pick();
        if (!next) return;
        this.currentLine = next;
        this.showBubble = true;
        clearTimeout(this._hideTimer);
        this._hideTimer = setTimeout(() => { this.showBubble = false; }, 4500);
      },
      toggleSilent() {
        this.silent = !this.silent;
        try { localStorage.setItem("dfMascotSilent", this.silent ? "1" : "0"); } catch {}
        if (this.silent) {
          this.showBubble = false;
          if (this._timer) clearInterval(this._timer);
        } else {
          this.say();
          this._timer = setInterval(() => this.say(), 18_000);
        }
      },
    };
  };
}
</script>
`;
}
