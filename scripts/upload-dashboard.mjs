/**
 * Upload dashboard.html to the Supabase dashboard_pages row.
 *
 * Wired to Vercel's buildCommand so every deploy of this repo pushes
 * the latest dashboard.html into the live row that leads.fortitudecreative.com
 * fetches at runtime. The bootloader (index.html) is unchanged — it still
 * fetches `dashboard_pages?id=eq.meta-leads&select=html` and renders it;
 * this script is just the writer half of that pair.
 *
 * Required env (set on Vercel project: fortitude-leads-frontend):
 *   SUPABASE_URL                  e.g. https://lnpgnjkkdjpkltevliiq.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY     the service-role key (NOT the anon key)
 *   DASHBOARD_PAGE_ID             optional, defaults to 'meta-leads'
 *
 * Behavior:
 *   - Reads dashboard.html from the repo root
 *   - PATCH-upserts the row via PostgREST
 *   - Backs up the previous html into dashboard_pages_backup before overwriting,
 *     so a bad deploy can be rolled back by copying from the backup table.
 *   - Logs the byte count so you can spot accidental zero-length uploads.
 *   - Skips entirely if SKIP_DASHBOARD_UPLOAD=1 (escape hatch for emergency
 *     deploys without env access).
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const PAGE_ID = process.env.DASHBOARD_PAGE_ID || 'meta-leads'
const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (process.env.SKIP_DASHBOARD_UPLOAD === '1') {
  console.log('[upload-dashboard] SKIP_DASHBOARD_UPLOAD=1 — skipping')
  process.exit(0)
}

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('[upload-dashboard] FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required')
  console.error('[upload-dashboard] Set them on the Vercel project env, or run with SKIP_DASHBOARD_UPLOAD=1 to bypass.')
  process.exit(1)
}

const htmlPath = resolve(process.cwd(), 'dashboard.html')
let html
try {
  html = readFileSync(htmlPath, 'utf8')
} catch (e) {
  console.error(`[upload-dashboard] FATAL: cannot read ${htmlPath}: ${e.message}`)
  process.exit(1)
}

if (!html || html.length < 1000) {
  console.error(`[upload-dashboard] FATAL: dashboard.html is suspiciously small (${html?.length ?? 0} bytes)`)
  console.error('[upload-dashboard] Refusing to overwrite the live dashboard with a near-empty payload.')
  process.exit(1)
}

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=minimal',
}

async function main() {
  // 1. Snapshot the current row into dashboard_pages_backup before overwriting,
  //    so an "oh no I broke prod" rollback is one SQL statement away.
  try {
    const cur = await fetch(
      `${SUPABASE_URL}/rest/v1/dashboard_pages?id=eq.${encodeURIComponent(PAGE_ID)}&select=html,updated_at`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    )
    if (cur.ok) {
      const rows = await cur.json()
      if (rows[0]?.html) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        const backupId = `${PAGE_ID}-${stamp}`
        const backupRes = await fetch(`${SUPABASE_URL}/rest/v1/dashboard_pages_backup`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            id: backupId,
            html: rows[0].html,
            backed_up_at: new Date().toISOString(),
          }),
        })
        if (!backupRes.ok && backupRes.status !== 409) {
          console.warn(
            `[upload-dashboard] backup write returned ${backupRes.status}: ${(await backupRes.text()).slice(0, 200)}`
          )
        } else {
          console.log(`[upload-dashboard] backed up previous row as ${backupId} (${rows[0].html.length} bytes)`)
        }
      }
    }
  } catch (e) {
    console.warn('[upload-dashboard] backup attempt failed (continuing):', e.message)
  }

  // 2. Upsert the new HTML.
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/dashboard_pages?id=eq.${encodeURIComponent(PAGE_ID)}`,
    {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ html, updated_at: new Date().toISOString() }),
    }
  )
  if (!res.ok) {
    const text = await res.text()
    console.error(`[upload-dashboard] PATCH failed (${res.status}): ${text.slice(0, 500)}`)
    process.exit(1)
  }
  console.log(`[upload-dashboard] ok — ${html.length} bytes pushed to dashboard_pages.id='${PAGE_ID}'`)
}

main().catch((e) => {
  console.error('[upload-dashboard] uncaught:', e)
  process.exit(1)
})
