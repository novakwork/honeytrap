# Labyrinth

Hidden links on your real site lead into an endless maze of generated pages.
People never see the links. Anything that follows them, and ignores the
"keep out" in robots.txt, gets logged. You read the log on a private page.

Runs free on a Cloudflare Worker. Your main site can be hosted anywhere.

## The honeypot page

The front page of the Worker (`https://labyrinth.<you>.workers.dev/`) is a
live artwork: a glass jar on a blank page, a quarter full of honey. Every
capture in the log arrives as a fly, drops in through the opening and joins
the heap. It checks for new captures every 10 seconds and never forgets old
ones. The heap starts as a small oval on the honey and spreads to its edge
(about 3,700 flies), then rises in layers. The pot holds about 84,000 before
it's full to the brim; after that the count keeps climbing.

- Under the pot: the total caught, the date and time of the latest catch
  with the crawler and its network, and how long it's been catching for
  (counted from the first catch).
- "View all catches" opens the full list, newest first, with a button to
  load earlier ones.
- Hover or tap a fly to see which crawler it was and when.
- Each capture always lands in the same spot, so the image is the same on
  every screen and every reload.
- Add `?demo` to the address to see it with simulated flies.
- The page itself carries hidden links into the maze, so it's bait too.
- It shows crawler names, network owners and times. It never shows IPs.

Put it full screen on a display, link to it, or embed it on your site with:

```html
<iframe src="https://labyrinth.<you>.workers.dev/" title="Honey · Pot"
  style="width:100%;aspect-ratio:4/3;border:0"></iframe>
```

## Setup (about 10 minutes)

You need Node.js and a free Cloudflare account.

1. In this folder: `npm install`
2. `npx wrangler login`
3. `npx wrangler d1 create labyrinth-log`
   Copy the `database_id` it prints into `wrangler.toml`.
4. `npx wrangler d1 execute labyrinth-log --remote --file=schema.sql`
5. Set a private key for the log page (pick a long random string):
   `npx wrangler secret put LOG_KEY`
6. `npx wrangler deploy`
   It prints an address like `https://labyrinth.<you>.workers.dev`

The honeypot: `https://labyrinth.<you>.workers.dev/`
Your log: `https://labyrinth.<you>.workers.dev/log?key=YOUR_KEY`
CSV export: same address with `/log.csv?key=YOUR_KEY`

## Add the hidden links to your site

Paste one or more of these into pages on your real site, ideally in the
footer of every page. Change the last part of each link so they differ.

```html
<a href="https://labyrinth.<you>.workers.dev/archive/index-2019"
   rel="nofollow" aria-hidden="true" tabindex="-1"
   style="position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden">Archive</a>
```

`aria-hidden` and `tabindex="-1"` keep it out of screen readers and keyboard
navigation, so real visitors never land in the maze.

## Using your own domain (optional)

If your domain's DNS is on Cloudflare, you can serve the maze from a path on
your own site instead (e.g. `yoursite.com/archive/*`) by adding a route in
`wrangler.toml`. Then also add `Disallow: /archive/` to your main robots.txt.
Bots are more likely to follow same-site links, so this catches more.

## Settings (wrangler.toml)

- `DELAY_MS` adds a pause to every maze page to waste crawler time. Default 1.5s.
- `RETENTION_DAYS` blanks IP addresses after this many days. Default 90.
  The rest of each record stays, so no flies disappear.

## What the log records

Time, path, user agent, a best-guess label (GPTBot, CCBot, Bytespider,
python scripts and so on), IP, country, and network owner (ASN). The
network owner is often the most telling column: user agents are easy to
fake, the network an IP belongs to isn't.

IPs are personal information under the NZ Privacy Act if a person ends up
in the maze. The links are hidden, so that should be rare, and IPs are
blanked after 90 days.
