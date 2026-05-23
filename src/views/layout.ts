import { env } from "../config/env";

// Asset version derived once at boot. Used as cache-buster on CSS link so
// browsers immediately pick up new builds. Restart the server (or rebuild
// the container) to bump it.
const ASSET_VERSION = Date.now().toString(36);

interface LayoutOpts {
  title: string;
  description?: string;
  ogImage?: string;
  bodyClass?: string;
  /** When true, hide nav links in the topbar (quiz focus) */
  minimalTopbar?: boolean;
  /** When true, omit the footer entirely */
  hideFooter?: boolean;
  children: string;
}

export function layout(o: LayoutOpts): string {
  const desc = o.description ?? "How fresh are you on this week's dev discourse?";
  const ogImage = o.ogImage ?? `${env.BASE_URL}/og/default`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escape(o.title)} · daily.fresh</title>
<meta name="description" content="${escape(desc)}" />
<meta property="og:title" content="${escape(o.title)} · daily.fresh" />
<meta property="og:description" content="${escape(desc)}" />
<meta property="og:image" content="${escape(ogImage)}" />
<meta property="og:type" content="website" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escape(o.title)} · daily.fresh" />
<meta name="twitter:description" content="${escape(desc)}" />
<meta name="twitter:image" content="${escape(ogImage)}" />
<link rel="icon" type="image/svg+xml" href="/static/favicon.svg" />
<link rel="stylesheet" href="/static/style.css?v=${ASSET_VERSION}" />
<script src="https://unpkg.com/htmx.org@1" defer></script>
<script defer src="https://unpkg.com/alpinejs@3/dist/cdn.min.js"></script>
</head>
<body class="${o.bodyClass ?? ""}">
<header class="topbar ${o.minimalTopbar ? "topbar-minimal" : ""}">
  <a href="/" class="logo">daily.<span>fresh</span></a>
  ${o.minimalTopbar ? "" : `<nav>
    <a href="/trending">Take the quiz</a>
    <a href="/leaderboard">Leaderboard</a>
    <a href="/about">About</a>
  </nav>`}
</header>
<main>
${o.children}
</main>
<div id="konami-toast" class="konami-toast" hidden>HARDCORE MODE UNLOCKED — 20 questions</div>
<script>
(function(){
  const code = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
  let i = 0;
  addEventListener('keydown', (e) => {
    if (e.key === code[i] || e.key.toLowerCase() === code[i]) {
      i++;
      if (i === code.length) {
        i = 0;
        const t = document.getElementById('konami-toast');
        if (t) { t.hidden = false; setTimeout(() => t.hidden = true, 4000); }
        const url = new URL(location.href);
        url.searchParams.set('hardcore', '1');
        if (location.pathname === '/trending') location.href = url.toString();
        else setTimeout(() => location.href = '/trending?hardcore=1', 600);
      }
    } else { i = 0; }
  });
})();
</script>
${o.hideFooter ? "" : `<footer>
  <p>Built for the <a href="https://app.daily.dev/hackathon" rel="noreferrer">daily.dev hackathon 2026</a> · <span class="muted">data from daily.dev Public API</span></p>
</footer>`}
</body>
</html>`;
}

export function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
