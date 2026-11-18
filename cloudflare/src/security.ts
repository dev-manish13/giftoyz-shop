const SCRIPT_TAG = /<script(?=[\s>])/g;

export function nonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function addNonce(html: string, value: string): string {
  return html.replace(SCRIPT_TAG, `<script nonce="${value}"`);
}

export function pagePolicy(value: string, https: boolean): string {
  const parts = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${value}'`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (https) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

export const API_POLICY = "default-src 'none'; frame-ancestors 'none'";

export function tokensMatch(expected: string, provided: string): boolean {
  const enc = new TextEncoder();
  const a = enc.encode(expected);
  const b = enc.encode(provided);
  if (a.byteLength !== b.byteLength) {
    crypto.subtle.timingSafeEqual(a, a);
    return false;
  }
  return crypto.subtle.timingSafeEqual(a, b);
}
