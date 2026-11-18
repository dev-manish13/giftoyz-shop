from __future__ import annotations

import hmac
import re
import secrets

_SCRIPT_TAG = re.compile(r"<script(?=[\s>])")


def nonce() -> str:
    return secrets.token_urlsafe(18)


def add_nonce(html: str, value: str) -> str:
    return _SCRIPT_TAG.sub(f'<script nonce="{value}"', html)


def page_policy(value: str, https: bool) -> str:
    parts = [
        "default-src 'self'",
        f"script-src 'self' 'nonce-{value}'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data: blob:",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ]
    if https:
        parts.append("upgrade-insecure-requests")
    return "; ".join(parts)


def tokens_match(expected: str, provided: str) -> bool:
    return hmac.compare_digest(expected.encode(), provided.encode())
