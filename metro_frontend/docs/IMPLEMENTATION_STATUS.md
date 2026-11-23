# Implementation status

Legend: **T** fully implemented and tested · **I** implemented, not fully tested · **P** partial · **X** unavailable (external dependency) · **L** planned

| Area | Status | Notes |
|---|---|---|
| Route engine (Dijkstra, fastest / fewest changes / accessible) | T | `scripts/test-engine.ts` (10), `test-restrictions.ts` (14), `test-fare-access.ts` (13) |
| Closures: station, section, line, partial, interchange | T | Same Dijkstra consumes restrictions; no second engine |
| Lift outages → accessible routing | T | New closure type `LIFT_OUTAGE`; escalator outage is informational only |
| Dynamic recalculation + reason shown | T | Banner in planner; `recommend()` compares alternatives |
| Fare engine | T (logic) / P (data currency) | Centralised in `src/engine/fareConfig.ts`. Chart dated 14 Feb 2025; a Feb 2026 revision was reported on hold and could not be confirmed officially — see DATA_VERIFICATION.md |
| Station dataset (83 stations, 3 lines) | P | Structural checks tested; names/coordinates/Kannada not independently re-verified against BMRCL |
| Accessibility data model | P | Confidence levels exist; **no facility-level records are loaded** (`src/data/accessibility.json` is empty by design). All stations are "unverified" |
| Smart Alerts (create/verify/resolve, categories, notifications) | T (backend) / I (UI) | pytest; UI not browser-tested end to end |
| Notification de-duplication / cooldown | T | pytest |
| Live data adapters (GTFS-RT, BMTC, OpenCity) | X | No credentials / no verified official feed. Sources report AUTH_REQUIRED; nothing is invented |
| Data-source status, stale detection, fallback | T | pytest (`sources`) |
| LIVE vs HISTORICAL vs ADMIN vs ESTIMATED labelling | P | Alerts carry verification status; crowd labelled AI-predicted station demand. Not every screen audited |
| Crowd prediction (Random Forest) | T (service) / P (evaluation) | Metrics are the stored holdout metrics. The re-evaluation tasks in the V7 brief (per-station breakdown, intervals, baseline comparison) were **not** re-run |
| Lost & Found (lost/found, matching, admin verify, claim) | T (backend) | Submissions are OFF by default (`ASSISTANCE_SUBMISSIONS_ENABLED=false`); the section is marked work-in-progress |
| Emergency information | T | Information only. No dispatch or monitoring exists |
| Passenger reports (validation, status) | T (backend) | pytest |
| Database: fresh start, restart, persistence, migrations, duplicate seed | T | `test_database_lifecycle.py` (7) |
| 3D metro (single coach, transitions, WebGL fallback) | I | Verified in headless software-rendered Chromium for individual transitions; not on real GPUs or phones |
| Accessibility mode (contrast, text size, font, motion, speech) | I | UI tested with stubbed speech; real audio not testable here |
| Frontend `npm ci` / `npm run build` | **Not run** | No network in the build sandbox; `package-lock.json` could not be generated |
| Admin auth, role checks, rate limits | T | pytest `test_notifications_security.py` |
| Responsive layout audit on real devices | L | Only desktop-width screenshots were checked |
