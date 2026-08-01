# PRESS START — Product Facts

**Verified:** 2026-08-01
**Sources:** local product code and committed design documents

- PRESS START is an authenticated, installable personal game-library PWA.
- Current production stack: React 19, TypeScript, Vite, Hono on Cloudflare Workers, D1, and Drizzle.
- Current authenticated destinations are Shelf and Catalog; Stats is proposed as third destination.
- Product records wishlisted, bought, started, story-completed, and Platinum dates.
- Existing shelf DTO also carries ownership, effective state, genres, scores, time-to-beat, and PS+ availability.
- Current design is dark-only: near-black void, faint grid, electric cyan interactive chrome, milestone silver, and rare heat magenta.
- Canonical wordmark is component-based text in Orbitron 900 with neon glow and block cursor, defined in `web/shell/Wordmark.tsx` and `wordmark.css`.
- Product chrome must not use Sony or PlayStation marks. “PlayStation” is descriptive language only.
- Stats mock uses sample values solely to demonstrate layout. Production values will derive from authenticated library data.

No public product-version or release-status claims are needed for this private brownfield design task.
