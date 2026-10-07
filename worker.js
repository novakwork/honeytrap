// Labyrinth: a hidden-link bot trap with a private hit log.
// Runs as a Cloudflare Worker with a D1 database bound as DB.
//
// Routes
//   /               the honeypot page (public, not logged)
//   /feed           public JSON of captures for the honeypot (no IPs);
//                   ?since=ID for newer, ?before=ID to page back through older
//   /robots.txt     tells every crawler to keep out of /archive/
//   /archive/...    an endless maze of generated pages, each hit logged
//   /log?key=...    private dashboard of recent hits
//   /log.csv?key=.. full log as CSV

import POT from "./honeytrap.html";

const KNOWN_BOTS = [
  ["GPTBot", "OpenAI"], ["ChatGPT-User", "OpenAI"], ["OAI-SearchBot", "OpenAI"],
  ["ClaudeBot", "Anthropic"], ["Claude-Web", "Anthropic"], ["anthropic-ai", "Anthropic"],
  ["CCBot", "Common Crawl"], ["Bytespider", "ByteDance"], ["PerplexityBot", "Perplexity"],
  ["Perplexity-User", "Perplexity"], ["Amazonbot", "Amazon"], ["Applebot", "Apple"],
  ["meta-externalagent", "Meta"], ["FacebookBot", "Meta"], ["facebookexternalhit", "Meta"],
  ["Googlebot", "Google"], ["GoogleOther", "Google"], ["bingbot", "Microsoft"],
  ["cohere-ai", "Cohere"], ["Diffbot", "Diffbot"], ["ImagesiftBot", "ImageSift"],
  ["Omgilibot", "Webz.io"], ["Timpibot", "Timpi"], ["AI2Bot", "Allen AI"],
  ["YouBot", "You.com"], ["PetalBot", "Huawei"], ["img2dataset", "img2dataset"],
  ["SemrushBot", "Semrush"], ["AhrefsBot", "Ahrefs"], ["DataForSeoBot", "DataForSEO"],
  ["MJ12bot", "Majestic"], ["DotBot", "Moz"], ["python-requests", "script"],
  ["python-httpx", "script"], ["aiohttp", "script"], ["curl/", "script"],
  ["Wget", "script"], ["Go-http-client", "script"], ["Scrapy", "script"],
  ["HeadlessChrome", "headless browser"], ["node-fetch", "script"], ["axios", "script"],
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/robots.txt") {
      return text("User-agent: *\nDisallow: /archive/\nDisallow: /feed\nDisallow: /log\n");
    }
    if (url.pathname === "/") {
      return new Response(
        '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' +
        "</head><body>" + POT + "</body></html>",
        { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } }
      );
    }
    if (url.pathname === "/feed") {
      return feed(env, url);
    }
    if (url.pathname === "/log" || url.pathname === "/log.csv") {
      if (!env.LOG_KEY || url.searchParams.get("key") !== env.LOG_KEY) {
        return new Response("Not found", { status: 404 });
      }
      return url.pathname === "/log.csv" ? csv(env) : dashboard(env, url);
    }
    if (!url.pathname.startsWith("/archive/")) {
      return new Response("Not found", { status: 404 });
    }

    ctx.waitUntil(logHit(request, env, url));

    const delay = Number(env.DELAY_MS || 0);
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));

    return new Response(mazePage(url.pathname), {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "x-robots-tag": "noindex, nofollow, noarchive",
        "cache-control": "no-store",
      },
    });
  },
};

// ---------- logging ----------

function classify(ua) {
  if (!ua) return "no user agent";
  const low = ua.toLowerCase();
  for (const [needle, label] of KNOWN_BOTS) {
    if (low.includes(needle.toLowerCase())) return `${needle} (${label})`;
  }
  if (/bot|crawl|spider|scrape|fetch/i.test(ua)) return "other bot";
  return "browser-like";
}

async function logHit(request, env, url) {
  const cf = request.cf || {};
  const ua = request.headers.get("user-agent") || "";
  try {
    await env.DB.prepare(
      `INSERT INTO hits (ts, path, ua, label, ip, country, asn, as_org, referer)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      new Date().toISOString(),
      (url.pathname + url.search).slice(0, 500),
      ua.slice(0, 500),
      classify(ua),
      request.headers.get("cf-connecting-ip") || "",
      cf.country || "",
      cf.asn ? String(cf.asn) : "",
      cf.asOrganization || "",
      (request.headers.get("referer") || "").slice(0, 500)
    ).run();

    // Roughly 1 in 200 hits, blank out IP addresses older than the retention window.
    // Rows stay, so every fly stays on the honeypot.
    if (Math.random() < 0.005) {
      const days = Number(env.RETENTION_DAYS || 90);
      const cutoff = new Date(Date.now() - days * 864e5).toISOString();
      await env.DB.prepare("UPDATE hits SET ip = '' WHERE ts < ? AND ip != ''").bind(cutoff).run();
    }
  } catch (err) {
    console.error("log failed", err);
  }
}

// ---------- public feed for the honeypot ----------

async function feed(env, url) {
  const since = Math.max(0, parseInt(url.searchParams.get("since") || "0", 10) || 0);
  const before = Math.max(0, parseInt(url.searchParams.get("before") || "0", 10) || 0);
  const top = await env.DB.prepare("SELECT MAX(id) AS m FROM hits").first();
  const maxId = (top && top.m) || 0;
  let rows, firstTs;
  if (before > 0) {
    rows = (await env.DB.prepare(
      "SELECT id, ts, label, as_org FROM hits WHERE id < ? ORDER BY id DESC LIMIT 200").bind(before).all()).results;
  } else if (since === 0) {
    const first = await env.DB.prepare("SELECT ts FROM hits ORDER BY id LIMIT 1").first();
    firstTs = first ? first.ts : null;
    rows = (await env.DB.prepare(
      "SELECT id, ts, label, as_org FROM hits ORDER BY id DESC LIMIT 200").all()).results.reverse();
  } else {
    rows = (await env.DB.prepare(
      "SELECT id, ts, label, as_org FROM hits WHERE id > ? ORDER BY id LIMIT 500").bind(since).all()).results;
  }
  const hits = rows.map((r) => ({ id: r.id, ts: r.ts, label: r.label, org: r.as_org }));
  return new Response(JSON.stringify({ maxId, firstTs, hits }), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

// ---------- maze ----------

const WORDS = (
  "archive field index study notes series record survey frame signal tide " +
  "harbour colour drawing light grid surface vessel garden river weather glass " +
  "paper ledger catalogue room hour season edition plate print sample source " +
  "pattern measure line margin layer north south coast valley ridge cloud tree " +
  "flower sound chorus element current holding material register volume part " +
  "method document report entry collection reading early later second third " +
  "quiet open public private small large partial complete revised original"
).split(" ");

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mazePage(path) {
  const r = rng(hash(path));
  const pick = () => WORDS[Math.floor(r() * WORDS.length)];
  const cap = (s) => s[0].toUpperCase() + s.slice(1);
  const sentence = () => {
    const n = 6 + Math.floor(r() * 12);
    const w = Array.from({ length: n }, pick);
    return cap(w.join(" ")) + ".";
  };
  const para = () => Array.from({ length: 3 + Math.floor(r() * 4) }, sentence).join(" ");
  const slug = () =>
    `${pick()}-${pick()}-${Math.floor(r() * 0xffffff).toString(16).padStart(6, "0")}`;

  const title = cap(`${pick()} ${pick()} ${pick()}`);
  const links = Array.from({ length: 5 + Math.floor(r() * 6) }, () => {
    const s = slug();
    return `<li><a href="/archive/${s}">${cap(s.split("-").slice(0, 2).join(" "))}</a></li>`;
  }).join("\n");
  const body = Array.from({ length: 3 + Math.floor(r() * 3) }, () => `<p>${para()}</p>`).join("\n");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title></head>
<body><h1>${title}</h1>
${body}
<h2>Related</h2><ul>
${links}
</ul></body></html>`;
}

// ---------- dashboard ----------

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

async function dashboard(env, url) {
  const key = encodeURIComponent(url.searchParams.get("key"));
  const db = env.DB;
  const [total, last24, byLabel, byOrg, recent] = await Promise.all([
    db.prepare("SELECT COUNT(*) n FROM hits").first(),
    db.prepare("SELECT COUNT(*) n FROM hits WHERE ts > ?")
      .bind(new Date(Date.now() - 864e5).toISOString()).first(),
    db.prepare("SELECT label, COUNT(*) n, MAX(ts) last FROM hits GROUP BY label ORDER BY n DESC LIMIT 30").all(),
    db.prepare("SELECT as_org, asn, COUNT(*) n FROM hits GROUP BY as_org, asn ORDER BY n DESC LIMIT 30").all(),
    db.prepare("SELECT * FROM hits ORDER BY ts DESC LIMIT 200").all(),
  ]);

  const rows = (list, cols) =>
    list.results.map((r) => `<tr>${cols.map((c) => `<td>${esc(r[c])}</td>`).join("")}</tr>`).join("");

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="robots" content="noindex, nofollow">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Labyrinth log</title>
<style>
:root{--bg:#f6f5f2;--fg:#1b1b1b;--mute:#6b6b6b;--line:#dddad3;--accent:#c2185b}
@media (prefers-color-scheme:dark){:root{--bg:#121212;--fg:#ececec;--mute:#9a9a9a;--line:#2b2b2b;--accent:#f06292}}
body{margin:0;padding:24px 16px;background:var(--bg);color:var(--fg);font:14px/1.45 ui-monospace,Menlo,Consolas,monospace}
h1{font-size:18px;margin:0 0 4px}h2{font-size:14px;margin:28px 0 8px;color:var(--accent)}
.stats{display:flex;gap:24px;color:var(--mute)}.stats b{color:var(--fg);font-size:20px}
.wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;min-width:600px}
td,th{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
th{color:var(--mute);font-weight:normal}td{word-break:break-word;max-width:420px}
a{color:var(--accent)}
</style></head><body>
<h1>Labyrinth log</h1>
<div class="stats"><span><b>${total.n}</b> hits</span><span><b>${last24.n}</b> in last 24h</span>
<span><a href="/log.csv?key=${key}">Download CSV</a></span></div>
<h2>By crawler</h2><div class="wrap"><table><tr><th>Label</th><th>Hits</th><th>Last seen (UTC)</th></tr>
${rows(byLabel, ["label", "n", "last"])}</table></div>
<h2>By network</h2><div class="wrap"><table><tr><th>Organisation</th><th>ASN</th><th>Hits</th></tr>
${rows(byOrg, ["as_org", "asn", "n"])}</table></div>
<h2>Latest 200</h2><div class="wrap"><table><tr><th>Time (UTC)</th><th>Label</th><th>Path</th><th>Org</th><th>Country</th><th>IP</th><th>User agent</th></tr>
${rows(recent, ["ts", "label", "path", "as_org", "country", "ip", "ua"])}</table></div>
</body></html>`;
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

async function csv(env) {
  const { results } = await env.DB.prepare("SELECT * FROM hits ORDER BY ts DESC").all();
  const cols = ["ts", "label", "path", "ua", "ip", "country", "asn", "as_org", "referer"];
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const body = [cols.join(","), ...results.map((r) => cols.map((c) => q(r[c])).join(","))].join("\n");
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="labyrinth-log.csv"',
    },
  });
}

function text(body) {
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
