// Auth gate for the Meta Leads Dashboard (leads.fortitudecreative.com).
//
// This is a static site (index.html bootloader → dashboard HTML from Supabase),
// so the gate lives at the Vercel Edge. Two ways in:
//   1. Fortitude Family SSO — a valid `fortitude_family_session` cookie
//      (verified locally by HMAC) when FORTITUDE_FAMILY_SESSION_SECRET is set.
//   2. Interim operator HTTP Basic auth (OPS_USERNAME / OPS_PASSWORD) — the
//      Fortitude user/password, matching council + sketch + the ads tool.
//
// NOTE: the JV2 family-login redirect is intentionally NOT used yet — that page
// returns 503; bouncing there would brick the app. Restore it once JV2 is live.
//
// SECURITY CAVEAT: this gates the PAGE. The dashboard data is fetched
// client-side from Supabase with a public anon key, so the durable data lock is
// Supabase Row-Level Security on the Supabase project — not this middleware.
//
// Fail-open safety: if NEITHER secret is set, requests pass through with a
// warning, so a misconfiguration can never hard-lock the app.

import { next } from "@vercel/edge";

const FAMILY_COOKIE_NAME = "fortitude_family_session";

// Gate every path (incl. index.html / dashboard.html); leave favicon public.
export const config = {
  matcher: "/((?!favicon\\.ico|robots\\.txt).*)",
};

export default async function middleware(req: Request): Promise<Response> {
  // 1) Family SSO fast-path.
  const familySecret = (process.env.FORTITUDE_FAMILY_SESSION_SECRET || "").trim();
  if (familySecret.length >= 32) {
    const token = readCookie(req.headers.get("cookie") || "", FAMILY_COOKIE_NAME);
    if (await verifyFamilyCookie(token, familySecret)) return next();
  }

  // 2) Interim operator Basic auth.
  const opsUsername = (process.env.OPS_USERNAME || "ops").trim();
  const opsPassword = (process.env.OPS_PASSWORD || "").trim();
  if (opsPassword.length > 0) {
    const creds = decodeBasic(req.headers.get("authorization"));
    if (creds && timingSafeEqualStr(creds.user, opsUsername) && timingSafeEqualStr(creds.pass, opsPassword)) {
      return next();
    }
    return new Response("Unauthorized: authentication required", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="Fortitude Meta Leads", charset="UTF-8"',
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }

  // 3) Nothing configured — fail open with a warning (never hard-lock).
  console.warn(
    "[auth] Neither FORTITUDE_FAMILY_SESSION_SECRET nor OPS_PASSWORD is set; the Meta Leads Dashboard is publicly accessible. Set OPS_PASSWORD to gate it.",
  );
  return next();
}

function readCookie(header: string, name: string): string | undefined {
  for (const part of header.split(";")) {
    const [k, ...vparts] = part.trim().split("=");
    if (k === name) return vparts.join("=");
  }
  return undefined;
}

function decodeBasic(header: string | null): { user: string; pass: string } | null {
  if (!header || !header.toLowerCase().startsWith("basic ")) return null;
  let decoded: string;
  try {
    decoded = atob(header.slice(6).trim());
  } catch {
    return null;
  }
  const i = decoded.indexOf(":");
  if (i === -1) return null;
  return { user: decoded.slice(0, i), pass: decoded.slice(i + 1) };
}

function base64urlToBytes(b64url: string): Uint8Array {
  const padLen = (4 - (b64url.length % 4)) % 4;
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(padLen);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  return timingSafeEqualBytes(enc.encode(a), enc.encode(b));
}

async function verifyFamilyCookie(token: string | undefined, secret: string): Promise<boolean> {
  if (!token || !secret || secret.length < 32) return false;
  let decoded: string;
  try {
    decoded = decodeURIComponent(token);
  } catch {
    return false;
  }
  const [payloadB64, sigB64] = decoded.split(".");
  if (!payloadB64 || !sigB64) return false;

  let expectedSigBytes: Uint8Array;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    expectedSigBytes = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64)),
    );
  } catch {
    return false;
  }

  let sigBytes: Uint8Array;
  try {
    sigBytes = base64urlToBytes(sigB64);
  } catch {
    return false;
  }
  if (!timingSafeEqualBytes(sigBytes, expectedSigBytes)) return false;

  try {
    const payload = JSON.parse(new TextDecoder().decode(base64urlToBytes(payloadB64))) as { exp?: number };
    return typeof payload.exp === "number" && payload.exp > Date.now();
  } catch {
    return false;
  }
}
