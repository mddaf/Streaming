# Deploy the proxy and browser sniffer

Both Workers are prepared for your Cloudflare account. Nothing has been deployed
from this workspace. The sniffer uses Cloudflare's hosted browser through a
private service binding, so you do not need a VPS, a separate sniffer URL, or a
shared sniffer token for this setup.

## One-time deployment

Run these commands from the project directory in PowerShell with Node.js 24:

```powershell
npm.cmd ci --prefix tools --ignore-scripts
node tools/node_modules/wrangler/bin/wrangler.js login
npm.cmd run deploy --prefix tools
```

Use the Cloudflare account that owns `sports-proxy.md-daf001.workers.dev`.
The login command opens Cloudflare's authorization page. The deployment command
creates or updates `streampulse-sniffer` first, then updates `sports-proxy`.
If your existing proxy has a different name, edit `tools/wrangler.proxy.jsonc`
before deploying and update `PROXY_CONFIG.primary` in `js/proxy-loader.js`.

The sniffer config includes a `BROWSER` binding and disables public/preview URLs.
The proxy config includes a `DYNAMIC_SNIFFER` service binding to it. Do not add a
public route to the private sniffer. Browser use is subject to your Cloudflare
account's browser limits and usage charges; deployment does not change your plan.
See [Cloudflare browser limits](https://developers.cloudflare.com/browser-run/limits/).

Publish the frontend changes through your existing GitHub Pages setup as well.
Worker deployment alone does not update the website's JavaScript.

## Verify

Open the deployed proxy's `/sources` endpoint. It should show the sniffer as
`configured`. This confirms the binding is present, not that an upstream stream
is playable. `/catalog` should return a channel array.

Open the website and select a featured web feed. The proxy first tries static
discovery, then the private browser sniffer. Runtime capture returns a verified
manifest URL and the browser's playback headers; if discovery fails, featured
web channels retain their original embed fallback.

CRICFy's recovered default host failed DNS lookup during verification. Neither
Worker deployment nor the sniffer creates a channel catalog. Existing playlist
channels and available web feeds remain usable independently. If you later
obtain a working catalog, add `CRICFY_CATALOG_URL` as a proxy Worker environment
variable. The deploy configuration preserves dashboard variables. You do not
need to redeploy the frontend for source variable changes.

## Automatic updates

- The website refreshes its Worker catalog every five minutes while visible,
  and catches up after returning to a hidden tab. Playback is not restarted.
- The Worker re-fetches CRICFy's catalog on demand after a 60-second cache
  expires. It retains the last successful catalog in that running Worker
  instance when an upstream refresh fails and reports `stale` source status.
  This cache is not durable across Worker restarts or data centers.
- Stream URLs and SportzFY remote configuration are resolved again at playback
  time. Browser captures are reused for 30 seconds within a sniffer instance.
- A failed catalog refresh keeps the existing browser guide. Successful
  refreshes add/remove catalog channels and mirrors without duplicating static
  servers. Static M3U playlists continue loading on initial load/manual refresh.

To automatically deploy code changes pushed to `main`, add these GitHub
repository Actions secrets once:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Deployment token authorized for your Workers and browser binding |
| `CLOUDFLARE_ACCOUNT_ID` | The account ID that owns the proxy |

The workflow `.github/workflows/deploy-workers.yml` tests the implementation,
checks both deployment bundles, and deploys in the correct order. Without those
secrets, it validates changes and explicitly skips deployment. It also supports
manual runs from GitHub Actions. Frontend publishing stays with your existing
GitHub Pages configuration. Credentials are never added to the website files.
See [Cloudflare's GitHub Actions setup](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/).

## Local checks

```powershell
node --test tests/resolver.test.cjs tests/playback.test.cjs tools/browser-sniffer.test.mjs tools/cloudflare-sniffer.test.mjs tools/site-refresh.test.mjs
npm.cmd run check:deploy --prefix tools
```

The real-browser fixture test needs Chrome, Edge, or Chromium installed locally.
Set `BROWSER_EXECUTABLE_PATH` if it cannot be found automatically. Cloudflare
tests use simulated browser responses; the dry run checks real Wrangler
bundling and binding configuration. A live Cloudflare capture still needs
verification after you deploy.
The website fixture also verifies that a catalog update renders in the real
page while retaining the active embedded player's browsing context.
