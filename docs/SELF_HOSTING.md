# Self-hosting Parranda — your machine, a public link

Parranda runs as a small Node server that talks to open data (OpenStreetMap via
Overpass, Nominatim, Wikidata, municipal event feeds). There is no database and
no secret to manage, so the honest hosting model is the simple one:

**your machine is the server, and a tunnel gives it a public HTTPS address.**

No hosting company holds the app, nothing is deployed, and the cache lives on a
real disk — so a place looked up once stays fast for everyone who asks later.
The trade is that the app is reachable while your machine is awake.

---

## 1. Start the server in share mode

```bash
npm run share
```

That command is not the same as `npm run dev`. It:

- binds to **127.0.0.1 only** — the tunnel becomes the sole way in;
- sets `PARRANDA_TRUST_PROXY_HOPS=1`, so per-visitor limits count the real
  visitor instead of lumping everyone under the tunnel's own address (safe
  *because* of the loopback bind above — the two belong together);
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
tailscale up
tailscale funnel 8000
```

`tailscale funnel` prints the public address — something like
`https://your-mac.your-tailnet.ts.net`. That link is what you send to friends.
It stays the same every time, so it is worth saving.

Stop sharing at any time:

```bash
tailscale funnel --https=443 off
```

**Alternative, no account at all:** `cloudflared tunnel --url http://localhost:8000`
gives an instant `trycloudflare.com` link with no signup — but the URL changes
every restart and it is capped at 200 concurrent requests, so it suits a quick
demo rather than a link you hand to friends.

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
that **outbound**. Share mode adds the **inbound** half, on by default:

| Guard | Default | Why |
| --- | --- | --- |
| Per-visitor rate limit | 20 upstream requests / 60 s | One crawler could otherwise fan out into thousands of distinct lookups and get your IP banned |
| Global concurrency | 3 in flight | The place resolver's queue is serial at ~1.1 s; capping the door bounds the wait instead of letting it pile up |
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

`PARRANDA_PUBLIC_GUARD=disabled` exists for single-user local runs. Do not use
it on a public link.

## Being a good neighbour

Parranda is built on donated infrastructure. If you share the link widely rather
than with friends, raise the cache TTLs before raising the limits, and consider
running your own Overpass instance. The honest failure states are there on
purpose: when a source is unreachable, the app says so instead of inventing a
day.
