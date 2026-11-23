# Test report (2026-11-16, build sandbox)

```
## test-engine
✓ schematic: all 83 stations placed, min pair distance 1.00 (spacing 1)

10 checks passed
## test-restrictions
✓ no-route case reported for all recommendation kinds

14 restriction checks passed
## test-transition
✓ transition math + manager (continuity, flash timing, monotone motion, double-trigger guard, kind rollover)
✓ cinematic guarantees (no clipping, no jumps, soft flashes, turn-before-travel, zoom-in dolly, zoom-out, reduced motion)
## test-fare-access
✓ all lines suspended: unreachable

13 fare/accessibility checks passed
..............................................................           [100%]
62 passed in 7.91s
```

Commands: `npm test` (TypeScript engine/transition/fare tests via tsx) and `npm run test:backend` (pytest).

## Not run (and why)
- `npm ci`, `npm run build`, `vite build`: no network access in the build sandbox, so packages could not be installed and `package-lock.json` could not be generated. Type-checking was done with a standalone compiler; only environment noise (missing React/Vite types) remained.
- Real GPU 3D rendering, real speech audio, real-device responsiveness, live BMRCL feeds.
- Not written: browser end-to-end journey test and admin-workflow UI test (the admin workflow is covered at API level in pytest).
