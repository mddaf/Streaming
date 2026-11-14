# Live source checks — November 14, 2026

The checks used the deployed Worker and current provider catalogues, with a
bounded selection of sources. Catalogue availability (57 CRICFy groups and
794 HD Streamz TV entries) does not establish playable video.

| Channel/source | Observed result |
| --- | --- |
| CRICFy Red Bull | Master/child playlists and media responded. Chrome in a mobile viewport advanced playback time and decoded video frames. |
| CRICFy UNBEATEN | Playlists and media responded. Chrome in a mobile viewport advanced playback time and decoded video frames. |
| CRICFy T Sports, first source | HTTP playlist and media worked directly from the test machine; cloud proxy returned 403. An HTTPS website cannot rely on directly loading this HTTP stream. |
| CRICFy T Sports, second source | TLS connection/playlist/media requests were intermittent or timed out. |
| HD Streamz T Sports, source 0 | Proxied playlists and a ranged media segment responded successfully, but repeated real-browser checks stalled without decoded frames. It is not verified playable. |
| HD Streamz T Sports, source 1 | Reproduced HTTP 525 through the proxy and TLS handshake failure directly. |
| CRICFy Willow, selected supported source | HTTP 403 from both direct and proxied manifest requests. Other detail entries include unsupported DRM sources. |
| HD Streamz A Sports HD, source 0 | Resolved a URL, but direct and proxied manifest requests returned 404. |
| HD Streamz beIN Sports 1 | Source 0 returned 404. The sampled remaining sources require unsupported DRM playback. |
| HD Streamz Astro Cricket, source 0 | Resolver correctly reported unsupported DRM playback. |

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
