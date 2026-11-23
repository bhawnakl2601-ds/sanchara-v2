# Known limitations (honest list)

- **No live BMRCL data.** Everything "live" is admin-entered or from configured adapters; with none configured, the UI says so. GTFS-RT parsing is written but untested against a real feed.
- **Demand model = historical pattern.** Trained on Aug 1–18 and Sep 1–30, 2025 (no data for 19–31 Aug). It is only modestly better than the same-hour average baseline on the final window and not in every week; ranges cover ≈75% of held-out values. It is not validated for events, holidays other than 15 Aug, or disruptions, and is not coach-level crowding.
- **Aug file direction** (entries) is inferred. The station matrix is not used.
- **Event scenarios** are what-ifs driven by assumptions the admin supplies.
- **Small network** (3 lines): many closures leave no alternative route; the engine reports that honestly.
- **Lost & found** matching is text/attribute similarity only; no image matching; staff verification is required.
- **Storage** is SQLite (schema is SQLAlchemy/PostgreSQL-ready, not migrated). Rate limiting is in-process.
- **FastAPI adapter and the real Vite build were not executed in the authoring sandbox** (no package installs). The business logic (45 tests) and the stdlib server were run; the UI was exercised in Chromium via an esbuild bundle with stubbed three/framer-motion.
- The WebSocket attempt logs a console 404 when running the `--stdlib` server; the app then falls back to SSE/polling.
- Browser notifications work only while the app is open; no Firebase push.
- Emergency numbers must be re-verified periodically against bmrc.co.in.
