# Stream resolution

The website calls the Cloudflare Worker at playback time. Deploy the updated
`cloudflare_worker.js` to the Worker configured as `PROXY_CONFIG.primary` in
`js/proxy-loader.js`; local file changes alone do not update the deployed Worker.
For the prepared Cloudflare proxy + private sniffer deployment and automatic
updates, follow [DEPLOY.md](./DEPLOY.md). The local Node service described below
is an alternative for other hosting environments.

| Endpoint | Result |
| --- | --- |
| `GET /catalog` | Public channel metadata, merged into the website guide |
| `GET /resolve?id=CHANNEL_ID` | Fresh `{url, headers}` from the channel's resolver chain |
| `GET /sniff?url=ENCODED_EMBED_URL` | First verified HLS manifest discovered in an embed page |
| `GET /feed` | Current SportzFY `livetv` page URL from its remote configuration |
| `GET /sources` | CRICFy and HD Streamz catalog availability, fetch errors and sniffer configuration status |

The default catalog includes SportzFY's config-driven feed and the existing test
streams, plus channels fetched from CRICFy's recovered catalog URL:
`https://cfydjjufvbh146.top/categories/sports.txt`. This replacement host was
recovered from the running APK's activated Firebase Remote Config. Its encoded
response was decoded and verified against the APK's native decoder on November
12, 2026. It supplied 57 channel groups. Failed catalog requests are cached for
60 seconds and do not hide the existing guide. Counts describe catalog entries,
not verified working broadcasts. Local APK analysis artifacts stay outside Git.

Set `CRICFY_CATALOG_URL` to a working replacement or hosted copy of the APK's
catalog schema. Set `CRICFY_ENABLED=false` to disable that source. The adapter
reads `title`, `image`, `cat`, `slug`, and `formats[].webLink`. Empty webLink fields
use the actual APK fallback `channels/<lowercase-slug>.txt`; the resulting
`ChannelItem` contains `streamUrls`, which are tried in order. The server-side
`CRICFY_CODEC_KEYS` secret contains a JSON array of `{key,iv}` hexadecimal AES
catalog codec variants. It is configured on the deployed Worker and is never
included in browser code, public catalog responses, or repository files.

HD Streamz's runtime catalog supplied 850 entries: 794 TV and 56 radio. The TV
guide imports enabled TV entries and resolves a source on demand using the APK's
observed `313537.php?id=<channel>&quality=<index>&type=0&app=188` contract.
The source response codec uses server secret `HDSTREAMZ_CODEC_KEY`. The adapter
supports direct/default HTTP(S) HLS sources and the supported playback headers;
DRM/DASH, native `self` extraction, native tokens and URL modifiers are skipped
with explicit errors so the next quality can be tried. Source metadata alone
does not prove that a stream is reachable in the viewer's region.

Optional Worker variables `HDSTREAMZ_CATALOG_URL`, `HDSTREAMZ_SOURCE_URL`,
`HDSTREAMZ_BASE_URL`, and `HDSTREAMZ_IMAGE_URL` override recovered endpoints.
Set `HDSTREAMZ_ENABLED=false` to disable this catalog. Neither APK's analytics
or advertising configuration is imported into the website.

Set the Worker's `CATALOG_URL` environment variable to a JSON array you host.
Configured catalog errors are returned explicitly rather than silently replacing
your channels with demo streams. `SPORTZ_CONFIG_URL` and `SPORTZ_FEED_FIELD`
optionally override the default remote config URL and `livetv` field.
SportzFY's current `livetv` URL is a highlights page, so a feed with no discovered
HLS manifest returns `{url, type: "web"}` for iframe playback. Browser embedding
depends on the upstream's frame policy; the player's pop-out opens the resolved
page directly. Feed pages are not marked as verified live video by health checks.
The supplied SportzFY v1.0 APK's live-menu quality choices also route to its
football highlights activity. That specific binary did not supply a separate
verified live-TV catalog; it is retained as a web feed.

Example catalog structure (replace example hosts and IDs with your sources):

```json
[
  {
    "id": "my-live-channel",
    "name": "My Live Channel",
    "group": "Sports",
    "headers": { "Referer": "https://player.example/", "User-Agent": "Mozilla/5.0" },
    "resolvers": [
      { "type": "api", "api": "https://api.example/channel/%s", "link": "https://player.example/my-channel", "field": "playback_url" },
      { "type": "lookup", "api": "https://api.example/lookup", "key": "server_key", "template": "https://{key}.cdn.example/{id}/index.m3u8" },
      { "type": "sniff", "link": "https://player.example/embed/my-channel" },
      { "type": "direct", "link": "https://backup.example/live.m3u8" }
    ]
  }
]
```

Resolvers run in order until one returns a valid HTTP(S) URL. API/lookup requests
use `requestHeaders` when supplied, otherwise playback `headers`; header names
accept both HTTP spelling and the frontend's `referer`, `origin`, `userAgent` form.
Only the sniffer verifies manifest content before returning a candidate.
APK numeric types 0, 1, 2, 3, 4, 6, and 9 are adapted. Type 5 uses general
embed discovery, including `hls_ondemand` and `itemprop="embedUrl"`; VK listing
navigation is not fully reproduced. DASH/DRM type 7 and type 8's special key
replacement are unsupported and skipped so another stream URL can be tried.

The APK's premium lookup contract is supported as
`{"id":"your-id","name":"Your Channel","type":"premium","channelId":"KNOWN_NUMERIC_ID"}`.
It calls `dokoplay.xyz/server_lookup.php`, builds the observed `new.newkso.ru`
URL, and attaches the observed `newembedplay.xyz` playback headers.
Use `type: "feed"` with `api` and optional `field` for config-to-embed discovery.

Static sniffing handles literal/escaped M3U8 URLs, data attributes, relative
player URLs, base64 strings, and nested iframe pages (two levels, at most three
frames per page). It tries up to eight candidates per page and verifies
`#EXTM3U`. The Worker does not execute page scripts or inspect cross-origin
iframe network traffic. The optional browser service below captures runtime
M3U8 responses, including requests inside nested frames. Featured web channels
retain iframe playback when discovery fails. Static discovery has a shared
five-second budget, individual resolver fetches ten seconds, the browser service
twelve seconds after launch, and frontend resolution thirty-five seconds.

## Runtime browser sniffer

The service in `tools/browser-sniffer.mjs` uses the Playwright library and an
installed Chromium browser. It watches successful manifest responses and returns
the request's Referer, Origin and User-Agent. It starts with a fresh browser
session, so streams requiring a signed-in account or persistent session cookies
are not supported. It does not implement the APK's TLS-error bypass.

Install dependencies and run it (PowerShell):

```powershell
npm.cmd ci --prefix tools --ignore-scripts
$env:SNIFFER_TOKEN = 'your-random-service-token'
# Optional if Chrome/Edge/Chromium is not found automatically:
# $env:BROWSER_EXECUTABLE_PATH = 'C:\path\to\chrome.exe'
node tools/browser-sniffer.mjs
```

It binds to `127.0.0.1:4174` by default and requires a bearer token. To use it
from a deployed Worker, host it behind a reachable HTTPS endpoint and configure
Worker environment variable `DYNAMIC_SNIFFER_URL=https://your-host/sniff` and
Worker secret `DYNAMIC_SNIFFER_TOKEN` with the matching token. A cloud Worker
cannot reach the local loopback service. Set `SNIFFER_HOST` and `SNIFFER_PORT`
for your hosting environment. At most two capture requests run simultaneously.
Keep the service token on the server; the frontend only calls the Worker.

The alternative Node browser service has not been deployed. The deployed
Cloudflare setup uses `tools/cloudflare-sniffer.mjs` and the proxy's
`DYNAMIC_SNIFFER` service binding instead of a public service URL/token.

Channel switching cancels pending browser requests and ignores stale results.
Headerless resolved streams use direct-first routing; sources requiring playback
headers use the proxy. This preserves the viewer's region for public HLS feeds.
Resolved URLs stay out of saved recents and catalog entries, so reload requests
a fresh URL. Playback headers are forwarded through rewritten child playlists,
segments, and HLS keys.

Run Worker/player integration tests and the real-browser fixture tests with:

```sh
node --test tests/resolver.test.cjs tests/playback.test.cjs tools/browser-sniffer.test.mjs tools/cloudflare-sniffer.test.mjs tools/site-refresh.test.mjs
```

The browser test loads a local iframe that builds its manifest URL dynamically
and verifies capture of its actual Referer. These tests do not establish
successful third-party live video playback.
