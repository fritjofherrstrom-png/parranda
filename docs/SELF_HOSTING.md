# Self-hosting Parranda — your machine, a public link

Parranda runs as a small Node server that talks to open data (OpenStreetMap via
Overpass, Nominatim, Wikidata, municipal event feeds). There is no database and
no secret to manage, so the honest hosting model is the simple one:

**your machine is the server, and a tunnel gives it a public HTTPS address.**

The application and cache remain on your machine; the tunnel provider carries
encrypted traffic to it. A place looked up once therefore stays fast for later
visitors without moving Parranda's cache to a hosted runtime.
The trade is that the app is reachable while your machine is awake.

---

## 1. Start the server in share mode

```bash
npm run share
```

That command is not the same as `npm run dev`. It:

- binds to **127.0.0.1 only** — the tunnel becomes the sole way in;
- explicitly enables the inbound public guard;
- uses the direct tunnel peer as the conservative default identity;
- turns on the live sources (loader, place resolvers, Wikidata, events);
- points the cache at `~/.parranda/source-cache`, durable across restarts;
- holds the Mac awake for as long as it runs (Ctrl-C restores normal sleep).

It prints what it enabled, the cache path, and the active guard limits.

## 2. Give it a public address

[Tailscale Funnel](https://tailscale.com/docs/features/tailscale-funnel) is the
recommended tunnel: free on the personal plan, a stable HTTPS URL, real
certificates, no credit card, and you can sign in with the GitHub account you
already use for this repo.

```bash
brew install --cask tailscale
```

Then open the Tailscale app and sign in (GitHub works). The `tailscale` command
is **not** on your PATH until you ask for it: in the app's settings, find the
CLI integration section, choose "Install Now" and enter your admin password —
that creates `/usr/local/bin/tailscale`. (If you installed the App Store version
instead, there is no launcher; either use the full path
`/Applications/Tailscale.app/Contents/MacOS/Tailscale` or alias it.)

With the CLI available:

```bash
tailscale funnel 8000
```

That prints the public address — something like
`https://your-mac.your-tailnet.ts.net`. That link is what you send to friends.
It stays the same every time, so it is worth saving.

Prefer no GUI at all? `brew install tailscale` installs the CLI and daemon
instead, but the daemon needs to be started with admin rights
(`sudo brew services start tailscale`) before `tailscale up`.

Stop sharing at any time:

```bash
tailscale funnel --https=443 off
```

**Alternative, no account at all:** `cloudflared tunnel --url http://localhost:8000`
gives an instant `trycloudflare.com` link with no signup — but the URL changes
every restart and it is capped at 200 concurrent requests, so it suits a quick
demo rather than a link you hand to friends.

Cloudflare Tunnel supplies a reviewed `CF-Connecting-IP` visitor header. To use
per-visitor limits instead of the conservative shared tunnel identity, start:

```bash
PARRANDA_PUBLIC_CLIENT_IDENTITY=cloudflare npm run share
```

Do not use that mode with another proxy. Tailscale/custom tunnels stay on the
safe direct identity until their client-IP transport is explicitly configured.

## 3. Keep it up (optional)

For a link that survives reboots, run the server as a launchd service. Create
`~/Library/LaunchAgents/com.parranda.share.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>com.parranda.share</string>
    <key>ProgramArguments</key>
    <array>
      <string>/usr/local/bin/npm</string>
      <string>run</string>
      <string>share</string>
    </array>
    <key>WorkingDirectory</key><string>REPLACE_WITH_REPO_PATH</string>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>/tmp/parranda-share.log</string>
    <key>StandardErrorPath</key><string>/tmp/parranda-share.err</string>
  </dict>
</plist>
```

Then `launchctl load ~/Library/LaunchAgents/com.parranda.share.plist`. Check
`which npm` first — Homebrew on Apple Silicon puts it at `/opt/homebrew/bin/npm`.

---

## What protects the app once the link is public

A public URL is an open door to the open-data services Parranda depends on, and
those services ask for restraint: Nominatim wants roughly one request per second
per client, Overpass wants clients not to hammer it. Parranda already honors
that **outbound**. `npm run share` explicitly adds the **inbound** half; normal
`npm start` and Render behavior remain unchanged:

| Guard | Default | Why |
| --- | --- | --- |
| Per-client identity limit | 20 upstream requests / 60 s | One crawler could otherwise fan out into thousands of distinct lookups and get your IP banned; the conservative tunnel-peer identity is shared unless a reviewed mode is selected |
| Global concurrency | 8 in flight | Bounds public bursts before they enter the resolver/loader queues |
| `robots.txt` | `Disallow: /` | Keeps search engines from crawling the expensive surface |
| `/api/candidate-inspect` | 404 unless dogfood | Debug projection with internal engine shape, not for strangers |

Refusals are honest: a real `429` with `Retry-After`, never a silent empty
result that would read as "we looked and found nothing".

Tune them if you need to (all optional):

```bash
PARRANDA_PUBLIC_GUARD_MAX=40          # requests per window per visitor
PARRANDA_PUBLIC_GUARD_WINDOW_MS=60000 # window length
PARRANDA_PUBLIC_GUARD_CONCURRENCY=4   # simultaneous upstream-touching requests
```

`PARRANDA_PUBLIC_GUARD=enabled` is set by `npm run share`. Do not enable it on a
normal deployment without deliberately accepting the public-share limits.

## Being a good neighbour

Parranda is built on donated infrastructure. If you share the link widely rather
than with friends, raise the cache TTLs before raising the limits, and consider
running your own Overpass instance. The honest failure states are there on
purpose: when a source is unreachable, the app says so instead of inventing a
day.
