# fortitude-meta-leads

Source for the Meta Lead Ads dashboard at **leads.fortitudecreative.com**.

## Architecture

```
[ Meta Lead Ads ] → "FB Leads" Google Sheet (Meta's native CRM integration)
                              ↓
                    meta-leads-proxy Edge Function (proxies CSV with CORS)
                              ↓
                    dashboard.html (this repo) — fetches every 3min, renders
                              ↓
                    [ leads.fortitudecreative.com ]
```

The dashboard ALSO writes lead-status changes (qualified / unqualified / booked / won)
back to a `lead_statuses` Supabase table, which the `capi-batch` Edge Function reads
to send conversion events to Meta CAPI.

## What's in this repo

- `index.html` — bootloader. Fetches `dashboard_pages?id=eq.meta-leads&select=html`
  from Supabase and `document.write`s it. Injects the shared Fortitude header
  (Leads / Branding / Marketing / SEO / PPC) on top.
- `dashboard.html` — **the actual dashboard UI** (HTML + CSS + JS). 50KB.
  Edit this when you want to change anything visual or behavioral.
- `scripts/upload-dashboard.mjs` — runs on every Vercel deploy. Snapshots the
  current `dashboard_pages.html` row into `dashboard_pages_backup`, then PATCHes
  the live row with the new contents of `dashboard.html`.
- `vercel.json` — wires the upload script to Vercel's `buildCommand`.

## Editing the dashboard

1. Edit `dashboard.html` locally.
2. (Optional sanity check) Open `dashboard.html` directly in a browser — it'll
   throw on the Supabase fetches but lets you eyeball layout / CSS without
   deploying.
3. `git commit && git push origin main`.
4. Vercel auto-deploys → the build step uploads `dashboard.html` to Supabase
   → the change goes live within ~30s of the deploy finishing.
5. Hard-refresh https://leads.fortitudecreative.com (Ctrl+Shift+R) to bypass
   the 60s edge cache on the bootloader.

## Required Vercel env vars

Set on the **fortitude-leads-frontend** Vercel project (Settings → Environment Variables):

- `SUPABASE_URL` = `https://lnpgnjkkdjpkltevliiq.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY` = (the service-role key — NOT the anon key)
- `DASHBOARD_PAGE_ID` = `meta-leads` (optional, only set if you ever rename)

## Rolling back a bad deploy

Every deploy snapshots the previous row into `dashboard_pages_backup` with
id `meta-leads-<timestamp>`. To restore:

```sql
UPDATE dashboard_pages SET html = (
  SELECT html FROM dashboard_pages_backup
  WHERE id LIKE 'meta-leads-%'
  ORDER BY backed_up_at DESC LIMIT 1
)
WHERE id = 'meta-leads';
```

## Emergency bypass

If you need to deploy `index.html` (the bootloader) without touching the
dashboard.html upload, set Vercel env `SKIP_DASHBOARD_UPLOAD=1` for that
deploy (or temporarily). The build script will exit cleanly without writing.
