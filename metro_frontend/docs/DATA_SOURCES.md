# Data sources & integration status

| Source | Status in this build | Notes |
|---|---|---|
| BMRCL GTFS-Realtime | `AUTH_REQUIRED` (no URL/key configured) | Adapter exists, makes **no network call** unless `BMRCL_GTFS_RT_*_URL` is set. Parsing path is untested against any real feed. |
| BMRCL announcements | `MANUAL_SOURCE` | Admins enter alerts/closures with a source link or note. |
| Ridership datasets (Aug/Sep 2025) | `MANUAL_SOURCE` (historical) | Used for the demand model only. |
| BMTC / OpenCity | unavailable unless configured | No URLs or auth schemes are assumed. |
| Firebase Cloud Messaging | not configured | In-app + WebSocket/SSE + browser notifications work; FCM adapter never claims delivery. |
| Emergency contacts | provided, not admin-verified | 112, 1800-425-12345, 080-25191091, travelhelp@bmrc.co.in. Admins can mark verified. |

Health of each source is visible on Alerts → Control room → Sources.
