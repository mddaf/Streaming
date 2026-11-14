# Live source checks — November 14, 2026

The checks used the deployed Worker and current provider catalogues, with a
bounded selection of sources. Catalogue availability (57 CRICFy groups and
794 HD Streamz TV entries) does not establish playable video.

| Channel/source | Observed result |
| --- | --- |
| CRICFy Red Bull | Master/child playlists and media responded. Chrome in a mobile viewport advanced playback time and decoded video frames. |
| CRICFy UNBEATEN | Playlists and media responded. Chrome in a mobile viewport advanced playback time and decoded video frames. |
| CRICFy T Sports, first source | The initial proxy 403 contained Cloudflare error 1003 (direct IP fetch denied), rather than an upstream authorization rejection. The scoped TCP transport now returns the playlist over HTTPS. A 64 KiB media sample matched direct HTTP byte-for-byte. Browser tests decoded initial frames but sustained playback still stalled. |
| CRICFy T Sports, second source | TLS connection/playlist/media requests were intermittent or timed out. |
| HD Streamz T Sports, source 0 | Proxied playlists and a ranged media segment responded successfully, but repeated real-browser checks stalled without decoded frames. It is not verified playable. |
| HD Streamz T Sports, source 1 | Reproduced HTTP 525 through the proxy and TLS handshake failure directly. |
| CRICFy Willow, selected supported source | HTTP 403 from both direct and proxied manifest requests. Other detail entries include unsupported DRM sources. |
| HD Streamz A Sports HD, source 0 | Resolved a URL, but direct and proxied manifest requests returned 404. |
| HD Streamz beIN Sports 1 | Source 0 returned 404. The sampled remaining sources require unsupported DRM playback. |
| HD Streamz Astro Cricket, source 0 | Resolver correctly reported unsupported DRM playback. |
| Original local FTV T Sports | Homepage and player-page endpoints returned 200 and still publish the channel. The freshly extracted stream URL returned 404 in the later check. Browser cross-origin access to the player page was also blocked. The local-player button opens the native page without requiring a cross-origin read. |
| Alternate local BDIX playlist | Publisher playlist downloaded successfully with 49 channel records targeting `172.16.29.2`. Its T Sports endpoint timed out from this network. It is added as an ISP-restricted alternative, not verified global playback. |

These results can change with provider availability, geography, CDN routing and
expiring URLs. Successful ranged media checks do not establish sustained browser
playback; the T Sports checks demonstrate that distinction. No DRM licenses,
certificate-validation bypasses or replacement provider URLs were added.

The fixes expose CRICFy alternatives to browser failover, preserve each mirror's
headers and signed URLs, correct forwarded Origin values, bound playlist reads,
cancel expired attempts, and stop abandoning sources on recoverable HLS warnings.
Negative checks of one mirror do not mark an entire multi-source channel offline.
Synthetic regression tests cover these behaviors separately from the live checks.

Raw responses, request URLs, APKs, native codec secrets and browser diagnostics
remain in ignored local analysis files.

The older `758d50c` player and the restored player were compared against the same
public T Sports transport. Both decoded initial frames and later stalled; the
remaining stall was not eliminated by returning to the older player. Separately,
two behavior regressions were corrected: catalogue mirrors had displaced the
original FTV mirror, and FTV token refresh had been removed. Those behaviors are
restored without claiming that today's FTV stream returned playable media.

The HTTP transport uses the supported [Cloudflare TCP sockets API](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)
for one observed public origin. The alternate playlist's [publisher documentation](https://github.com/taukir007/TV-Playlists)
states its ISP restrictions. Neither change promises playback from every network.
