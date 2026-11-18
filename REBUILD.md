# Cloudflare rebuild plan

Decided 2026-11-09. The owner doesn't want to pay for hosting before the shop earns, and isn't in a rush. The plan is to rebuild the shop on Cloudflare's free plan, which allows commercial use and stays online without the owner's Mac. Nothing has launched yet. The current FastAPI version in `server/` stays the reference and the fallback until the new one passes every check below.

Rejected options:
- Oracle and Google free tiers: they declined the owner's Nepali dollar card.
- Vercel Hobby: its free plan is for non-commercial use only.
- Paid VPS ($4–6 a month): rejected for now. `server/deploy/` keeps the files for it.
- Mac + Cloudflare Tunnel: only works while the Mac is on.

## Target stack (all free tier)

| Today | Cloudflare | Free limit |
|---|---|---|
| FastAPI (Python) | **Worker** in TypeScript with **Hono** router, static assets served by the same Worker (Workers Static Assets) | 100k requests/day, ~10 ms CPU/request |
| SQLite `server/data/ncm.sqlite3` | **D1** (SQLite) | 5 GB, 5M reads/day, 100k writes/day |
| `media/products/` files | **R2** bucket `giftoyz-media`, served via the Worker at `/media/products/*` | 10 GB, 1M writes/month, 10M reads/month |
| asyncio NCM poll (15 min) + daily rates | **Cron Triggers** (`*/15 * * * *`, `30 0 * * *`) | 5 crons |
| In-memory rate limits | D1 table, or the Workers Rate Limiting binding | — |
| `server/.env` | `wrangler secret put` (NCM_API_TOKEN, ADMIN_API_KEY, NCM_WEBHOOK_SECRET, PHONE_PEPPER, later KHALTI_SECRET_KEY) and `[vars]` in `wrangler.toml` | — |
| Pillow/HEIC resize on server | **Resize in the admin's browser** before upload (canvas → AVIF/WebP/JPEG at 600/800/1200/1600; banners 800/1600/2400; HEIC via `heic2any` from cdnjs/jsdelivr). Worker only validates type/size and stores | CPU limit makes server resizing impossible |
| QR redraw with segno | Admin uploads the QR image as is; optional: decode in the browser (jsQR) and redraw with `qrcode` lib | — |
| Caddy HTTPS | Cloudflare (automatic) | — |
| backup.sh | Weekly D1 export via `wrangler d1 export` run from the Mac, plus D1 Time Travel (30-day point-in-time restore, built in) | — |

Keep the frontend as it is: the HTML from `build/build.py --local`, plus `app.js`, `admin.js`, `i18n.js`, `data.js`, `styles.css` and the icons. The new Worker must keep the same API paths and JSON shapes. That way the frontend needs only small changes: the upload code and maybe a few helpers.

## New layout

```
cloudflare/
  wrangler.toml          # name giftoyz, assets dir ../ (allowlist via .assetsignore), D1 + R2 bindings, crons, vars
  package.json           # hono, zod, wrangler, vitest, @cloudflare/vitest-pool-workers
  migrations/0001_init.sql   # schema ported from server/app/db.py (+ store.py, rates.py tables)
  src/
    index.ts             # Hono app, middleware (size cap, headers, CSP nonce), routes, scheduled()
    security.ts          # tokensMatch (timing-safe), nonce, addNonce, pagePolicy, requireAdmin + failed-attempt limit
    config.ts            # env typing and validation
    db.ts                # D1 helpers
    catalog.ts taxonomy.ts shopSettings.ts orders.ts rates.ts track.ts invoice.ts seo.ts media.ts
    ncm.ts               # NCM client: retries for reads; create only retried if request never left
    khalti.ts            # dormant unless KHALTI_SECRET_KEY set
  test/                  # vitest in workerd; port every test in server/tests (141)
```

Static files go through Workers Static Assets. `.assetsignore` must exclude `server/`, `cloudflare/`, `build/`, `*.md`, `media/` and any `.env`. Only the public files the current `/{name}` regex allows may be served. Pages are rendered by the Worker: it fetches the HTML asset, then injects meta tags, JSON-LD, `GT_*` and the nonce, so this is not plain static serving.

## Phases

**0. Setup (the owner does this, with guidance)**
- Install Node LTS, then `npm i -g wrangler`, then `wrangler login` in the owner's terminal. Never paste tokens in chat.
- Create D1 `giftoyz-db` and R2 `giftoyz-media` (enable R2 on the free plan; Cloudflare may ask for the card already on file, with no charge inside the free limits).
- Done when `wrangler whoami` works.

**1. Skeleton and static pages**
- Hono Worker that serves the pages with the same allowlist, security headers and CSP nonce, plus `/healthz`, `robots.txt` and `sitemap.xml`.
- Deploy to `giftoyz.<account>.workers.dev`. This is the hidden test address; don't index it (send `X-Robots-Tag: noindex` while on workers.dev).
- Done when every page loads on workers.dev with no CSP errors.

**2. Database and catalog**
- Port the schema to `migrations/0001_init.sql`.
- Port the catalog, taxonomy, shop settings and banners APIs, plus their admin CRUD.
- Port SEO: per-page meta, Product and Breadcrumb JSON-LD, and `GT_*` injection.
- Done when the admin can sign in and edit products, categories and settings, and the shop shows them.

**3. Media**
- R2 upload endpoint `/api/admin/media?kind=photo|qr|banner`. Keep the same file-name rules as the current regex: `u-*`, `b-*`, `q-*.png`.
- Browser-side resize in `admin.js`, including HEIC.
- Serve media with long cache headers.
- Done when the admin can upload a phone photo (HEIC) and it shows in the shop on mobile.

**4. Orders, checkout and bill**
- Order creation with server-side prices, stock, fee, pause and COD advance.
- Order token (stored hashed) and phone digest with pepper.
- `/api/orders/{id}?token`, the `/invoice/{id}` bill and the admin order list and status.
- Manual eSewa/bank QR flow with the "I have paid" WhatsApp button.
- Done when a full checkout works on the phone and the bill downloads.

**5. NCM**
- Client, `/ncm/*` routes, shipment idempotency and the uncertain-timeout lock.
- Admin "ship" action, the webhook (`/api/ncm/webhook` with secret) and `/api/track` with the timeline.
- Rates table with `ncm_name` mapping (port `NCM_NAMES`), rate sync and the cron jobs.
- **Point at NCM's demo host for all tests.** `.env` today is live, so real shipments are created.
- Done when a demo shipment is created, tracked and updated by the cron.

**6. Tests and hardening**
- Port all 141 tests: security, pricing, stock, tokens, rate limit, NCM status mapping, timeline, Khalti dormant.
- Check D1 write counts against the free limits. Polling only active shipments keeps this small.
- Done when all tests are green and a security pass (headers, CSP, admin brute force, upload validation, injection) is complete.

**7. Data move and launch**
- Copy products, taxonomy, settings, QR codes, banners and rates from `ncm.sqlite3` into D1 (one script: sqlite dump to SQL, then `wrangler d1 execute --file`), and `media/products/*` into R2.
- Add the custom domain giftoyz.com and www in the Worker settings. Cloudflare DNS and the SSL certificate are automatic.
- Set `PUBLIC_BASE_URL=https://giftoyz.com`, then register the NCM webhook.
- Submit the sitemap in Google Search Console.
- Done when giftoyz.com is live over HTTPS and one real order runs end to end.

**8. Later**
- Khalti after business registration.
- giftoyz.com.np, as a redirect or second domain.
- Email routing for hello@giftoyz.com.
- Turnstile (free) on checkout if spam appears.

## Rules for the rebuild

- Same behaviour and same security as `server/`. When in doubt, read the Python version and match it.
- Secrets only through `wrangler secret put` in the owner's terminal. Never in code, chat or `wrangler.toml`.
- Never create real NCM shipments while testing.
- Keep `server/` untouched until launch. After launch, keep it as a backup for a month.
- One phase per session where possible. Check off the phases here as they finish.

## Owner's change requests (do these during the rebuild)

1. **Done.** **Admin product form: one name field only (English).** Remove the separate Nepali name fields (product name, category, colour, occasion, wherever there are EN and NE pairs).
   - In Nepali mode, the shop shows a Nepali translation if one exists, and otherwise the English text unchanged.
   - Translations can come from `i18n.js` or a small optional lookup. They must never be required in the admin.
   - Existing `name_ne`-style fields become optional or are dropped in the D1 schema. Keep the data model simple.
2. **Done.** **Product reviews.**
   - Customers can review a product: 1–5 stars, a short text and a name.
   - Only customers with a delivered order may review, checked by order ID and phone. Each review is held until the owner approves it in the admin (approve, hide, delete).
   - The review section on a product shows **only when it has approved reviews**. Show the average stars and the count.
   - Add `AggregateRating` and `Review` JSON-LD for SEO, using real reviews only.
   - D1 table `reviews`.
3. **Done.** **Trust strip on the home page,** below the banner and editable in Admin > Setup.
   - Items: "100+ happy customers" (number set by the owner), "Delivery to 300+ places across Nepal", "Fair prices", and "Cash on delivery".
   - Once real reviews exist, show the real average rating (for example "4.9 from 120 reviews"). Never a made-up rating.
   - Pricing wording, final (owner agreed): strip item "Fair pricing" / "उचित मूल्य". Optional tagline: "Great gifts, fair pricing" / "राम्रो उपहार, उचित मूल्य". No "cheaper than market" claims.

## Progress

- [x] 0 Setup: Node 26 via nvm, wrangler login, workers.dev subdomain `manishkandel-co` (D1/R2 not created yet: do at the start of phases 2 and 3)
- [x] 1 Skeleton (2026-11-09): `cloudflare/` Hono Worker, pages with nonce CSP and headers, 19 tests. Live test site https://giftoyz.manishkandel-co.workers.dev (noindex). Run tests and deploys from a terminal tab: the Bash sandbox can't open ports. Use Node from `~/.nvm` and `npm_config_cache=$TMPDIR/npm-cache` in the sandbox
- [x] 2 Database and catalog (2026-11-09): D1 `giftoyz-db` (id 87d021da-36a0-4f77-b594-eb37e9edf5c8, binding `DB`), schema in `cloudflare/migrations/0001_init.sql` (also `rate_limits`, `reviews`), catalog/taxonomy/settings APIs, admin auth with D1 rate limit, SEO render and sitemap. `ADMIN_API_KEY` secret set from `server/.env`. 39 tests. Owner change request 1 (single name field) not done yet. Data copy from SQLite is still phase 7
- [x] 3 Media (2026-11-09): R2 bucket `giftoyz-media` (binding `MEDIA`, keys `products/<name>`), resizing by the Cloudflare **Images binding** (`IMAGES`; free tier is 5,000 unique transformations a month, about 6 per photo), not in the browser. HEIC, EXIF rotation and AVIF/WebP/JPEG were checked live. `/media/products/*` is served through the edge cache. 45 tests. `cloudflare/scripts/upload-check.sh <file>` does a live upload, checks it and deletes the files
- [x] 4 Orders (2026-11-09): order creation (server prices, D1 batch with a `json('out-of-stock')` guard so stock can't oversell, COD advance, pause, 5/min per IP), order token (hashed), phone HMAC with the pepper in `shipment_meta` (copy the old pepper in phase 7 so old digests still match), `/api/orders/{id}`, `/invoice/{id}` bill, admin list and status with stock return on cancel, `GT_RATES`. Rate card seeded by `migrations/0002_rates.sql` (from `scripts/seed-rates.mjs`). Khalti routes return 503 (dormant). `/api/track` and admin ship are phase 5. 59 tests
- [x] 5 NCM (2026-11-10): `src/ncm.ts` client (create never retried; any network error on create marks the shipment uncertain), `src/shipping.ts` (ship, resolve, `/ncm/*`, `/api/track`, webhook, poll), `src/ratesync.ts`. The free plan allows 50 outside calls per run, so work is batched: cron `*/15` checks 10 shipments (oldest-checked first), and cron `7,22,37,52` refreshes 12 places per run (daily, state in `jobs`). Admin rate polling also advances it, so a manual refresh takes about 2 minutes. Migration 0003. The test site reads from NCM's **live** portal (real prices and tracking) with `NCM_ALLOW_CREATE=false`, so it can't create shipments; set it to `true` at launch. Live refresh: 303/303 places, 0 failed. `NCM_WEBHOOK_SECRET` isn't set yet: create one at launch, put it with `wrangler secret put`, then register the webhook from the admin. 79 tests. Scripts: `push-secrets.sh`, `rates-check.sh`
- [x] 6 Tests and changes (2026-11-10): full admin and shop walk-through on local `wrangler dev` (launch config `worker-dev`, test key in `cloudflare/.dev.vars`): every admin page, photo upload, checkout, bill, tracking and review flow. Fixed: a stray named export in `src/index.ts` that broke startup, the star picker order, and the review date format. Security: API bodies must be JSON (415 otherwise), which blocks cross-site form posts. Owner requests 1–3 are done: one English name field in the admin (Nepali text is cleared when the English changes), reviews (`src/reviews.ts`, tracking-page form after delivery, admin Reviews page, product section shown only with approved reviews, AggregateRating JSON-LD), and the home trust strip (`happy_customers` setting, real rating after 5 approved reviews, "Fair pricing"). 85 tests
- [x] 7 Launch (2026-11-10): settings and pepper copied (the old DB had no products or orders), QR PNGs copied to R2, `NCM_WEBHOOK_SECRET` set, live on **https://giftoyz.com** (www redirects there, Google Trust Services certificate, `INDEXABLE=true`, `NCM_ALLOW_CREATE=true`, workers.dev turned off), NCM webhook registered. 86 tests. Production deploys are run by the owner (`scripts/launch.sh`, or `npm run deploy` in `cloudflare/`); test locally with the `worker-dev` launch config
- [x] 8 Clean addresses and home tidy-up (2026-11-10): pages served without `.html` (old addresses, `/index` and trailing slashes 301), sitemap/canonical/robots updated, home category cards and occasions replaced by category pills over "Most loved" with a "See more" link, "What we sell" box in the hero, brand-coloured Instagram/TikTok/Facebook buttons. 94 tests
- [x] 9 Light default and collections (2026-11-10): the site opens in light mode unless the visitor chose dark; occasions removed and kept as optional "Collections" (migration 0004 clears old occasions from the taxonomy and products). 94 tests
