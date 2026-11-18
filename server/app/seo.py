from __future__ import annotations

import html
import json
import re
from datetime import datetime, timezone
from typing import Any

CATEGORY_NAMES = {
    "tumblers": "Tumblers",
    "bottles": "Bottles",
    "gift-boxes": "Gift boxes",
    "teddies": "Teddies",
    "mugs": "Mugs",
    "plush": "Plush toys",
}
STATIC_PAGES = ["", "products.html", "track.html", "about.html", "help.html", "contact.html"]
BRAND = "GifToyz Nepal"
DEFAULT_IMAGE = "about-cover-1024.jpg"


def _attr(value: str) -> str:
    return html.escape(value, quote=True)


def _json_ld(data: dict[str, Any]) -> str:
    raw = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    return f'<script type="application/ld+json">{raw}</script>'


def _script_json(name: str, data: Any) -> str:
    raw = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/").replace("<!--", "<\\!--")
    return f"<script>window.{name}={raw};</script>"


def product_url(base: str, product: dict[str, Any]) -> str:
    return f"{base}/product.html?item={product['itemId']}"


def image_url(base: str, image: dict[str, Any], width: int = 1200) -> str:
    return f"{base}{image['src']}-{width}.jpg"


class PageMeta:
    def __init__(self, *, title: str, description: str, canonical: str, image: str = "", og_type: str = "website", noindex: bool = False, image_size: tuple[int, int] = (1200, 1500)) -> None:
        self.image_size = image_size
        self.title = title
        self.description = description
        self.canonical = canonical
        self.image = image
        self.og_type = og_type
        self.noindex = noindex
        self.json_ld: list[dict[str, Any]] = []

    def tags(self) -> str:
        parts = [
            f'<link rel="canonical" href="{_attr(self.canonical)}">',
            f'<meta property="og:site_name" content="{BRAND}">',
            f'<meta property="og:type" content="{self.og_type}">',
            f'<meta property="og:title" content="{_attr(self.title)}">',
            f'<meta property="og:description" content="{_attr(self.description)}">',
            f'<meta property="og:url" content="{_attr(self.canonical)}">',
            '<meta property="og:locale" content="en_NP">',
            '<meta property="og:locale:alternate" content="ne_NP">',
            f'<meta name="twitter:card" content="{"summary_large_image" if self.image else "summary"}">',
            f'<meta name="twitter:title" content="{_attr(self.title)}">',
            f'<meta name="twitter:description" content="{_attr(self.description)}">',
        ]
        if self.image:
            parts += [
                f'<meta property="og:image" content="{_attr(self.image)}">',
                f'<meta property="og:image:width" content="{self.image_size[0]}">',
                f'<meta property="og:image:height" content="{self.image_size[1]}">',
                f'<meta property="og:image:alt" content="{_attr(self.title)}">',
                f'<meta name="twitter:image" content="{_attr(self.image)}">',
            ]
        if self.noindex:
            parts.append('<meta name="robots" content="noindex">')
        parts += [_json_ld(block) for block in self.json_ld]
        return "\n".join(parts)


def breadcrumbs(base: str, trail: list[tuple[str, str]]) -> dict[str, Any]:
    return {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "name": name, "item": url} for i, (name, url) in enumerate(trail)
        ],
    }


def store_ld(base: str, phone: str, same_as: list[str] | None = None, email: str = "") -> dict[str, Any]:
    data = {
        "@context": "https://schema.org",
        "@type": "Store",
        "name": BRAND,
        "url": f"{base}/",
        "logo": f"{base}/icon-512.png",
        "image": f"{base}/{DEFAULT_IMAGE}",
        "description": "Online gift shop in Nepal for teddies, plush toys and tumblers, delivered to 300+ places by Nepal Can Move.",
        "address": {"@type": "PostalAddress", "streetAddress": "New Road", "addressLocality": "Kathmandu", "addressCountry": "NP"},
        "priceRange": "Rs",
        "telephone": f"+977-{phone}",
        "areaServed": "Nepal",
        "currenciesAccepted": "NPR",
        "paymentAccepted": "Cash, Khalti, eSewa, Bank transfer",
        "sameAs": same_as or ["https://www.instagram.com/giftoyz.np/"],
    }
    if email:
        data["email"] = email
    return data


def product_ld(base: str, p: dict[str, Any], cat_names: dict[str, str] = CATEGORY_NAMES) -> dict[str, Any]:
    data: dict[str, Any] = {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": p["name"],
        "sku": p["itemId"],
        "description": p.get("blurb") or p["name"],
        "brand": {"@type": "Brand", "name": "GifToyz"},
        "category": cat_names.get(p["cat"], p["cat"]),
        "url": product_url(base, p),
        "image": [image_url(base, img) for img in p.get("images", [])],
    }
    if p.get("price"):
        data["offers"] = {
            "@type": "Offer",
            "priceCurrency": "NPR",
            "price": str(p["price"]),
            "availability": "https://schema.org/InStock" if p.get("stock", 0) > 0 else "https://schema.org/OutOfStock",
            "itemCondition": "https://schema.org/NewCondition",
            "url": product_url(base, p),
            "seller": {"@type": "Organization", "name": BRAND},
        }
    return data


def meta_for(page: str, query: dict[str, str], base: str, catalog: list[dict[str, Any]], default_title: str, default_desc: str, phone: str, cat_names: dict[str, str] = CATEGORY_NAMES, same_as: list[str] | None = None, email: str = "") -> tuple[PageMeta, int]:
    path = "/" if page == "index.html" else f"/{page}"
    meta = PageMeta(title=default_title, description=default_desc, canonical=f"{base}{path}")
    if page == "index.html":
        meta.json_ld.append(store_ld(base, phone, same_as, email))
    elif page == "products.html":
        cat = query.get("cat", "")
        trail = [("Home", f"{base}/"), ("Shop", f"{base}/products.html")]
        if cat in cat_names:
            name = cat_names[cat]
            meta.title = f"{name} | {BRAND}"
            meta.description = f"Shop {name.lower()} online in Nepal with delivery to 301 places through NCM. Pay by Khalti, eSewa, bank QR or cash on delivery."
            meta.canonical = f"{base}/products.html?cat={cat}"
            trail.append((name, meta.canonical))
        meta.json_ld.append(breadcrumbs(base, trail))
    elif page == "product.html":
        item = query.get("item", "")
        product = next((p for p in catalog if p["itemId"] == item), None)
        if product is None:
            meta.noindex = True
            return meta, 404 if item else 200
        meta.title = f"{product['name']} | {BRAND}"
        desc = product.get("blurb") or product["name"]
        if product.get("price"):
            desc = f"Rs {product['price']:,}. {desc}"
        meta.description = desc[:300]
        meta.canonical = product_url(base, product)
        meta.og_type = "product"
        if product.get("images"):
            meta.image = image_url(base, product["images"][0])
        meta.json_ld.append(product_ld(base, product, cat_names))
        meta.json_ld.append(breadcrumbs(base, [
            ("Home", f"{base}/"),
            (cat_names.get(product["cat"], "Shop"), f"{base}/products.html?cat={product['cat']}"),
            (product["name"], meta.canonical),
        ]))
    return meta, 200


_TITLE = re.compile(r"<title>(.*?)</title>", re.S)
_DESC = re.compile(r'<meta name="description" content="([^"]*)">')
_STATIC_LD = re.compile(r'<script type="application/ld\+json">.*?</script>\n?', re.S)
_DATA_JS = re.compile(r'<script src="data\.js[^"]*"></script>')


def render(page_html: str, page: str, query: dict[str, str], *, base: str, catalog: list[dict[str, Any]], config: dict[str, Any], phone: str, settings: dict[str, Any] | None = None, taxonomy: dict[str, Any] | None = None, rates: dict[str, Any] | None = None) -> tuple[str, int]:
    title_match, desc_match = _TITLE.search(page_html), _DESC.search(page_html)
    default_title = html.unescape(title_match.group(1)) if title_match else BRAND
    default_desc = html.unescape(desc_match.group(1)) if desc_match else ""
    cat_names = {c["id"]: c["en"] for c in taxonomy["categories"]} if taxonomy else CATEGORY_NAMES
    s = settings or {}
    same_as = [u for h, u in ((s.get("instagram"), f"https://www.instagram.com/{s.get('instagram')}/"), (s.get("tiktok"), f"https://www.tiktok.com/@{s.get('tiktok')}"), (s.get("facebook"), f"https://www.facebook.com/{s.get('facebook')}")) if h]
    meta, status = meta_for(page, query, base, catalog, default_title, default_desc, phone, cat_names, same_as, s.get("email", ""))
    if not meta.image:
        meta.image, meta.image_size = f"{base}/{DEFAULT_IMAGE}", (1024, 1024)
    out = _STATIC_LD.sub("", page_html)
    out = _TITLE.sub(lambda _: f"<title>{html.escape(meta.title)}</title>", out, count=1)
    out = _DESC.sub(lambda _: f'<meta name="description" content="{_attr(meta.description)}">', out, count=1)
    out = out.replace("</head>", meta.tags() + "\n</head>", 1)
    boot = _script_json("GT_CATALOG", catalog) + _script_json("GT_CONFIG", config) + (_script_json("GT_SETTINGS", settings) if settings else "") + (_script_json("GT_TAXONOMY", taxonomy) if taxonomy else "") + (_script_json("GT_RATES", rates) if rates else "")
    out = _DATA_JS.sub(lambda m: boot + "\n" + m.group(0), out, count=1)
    return out, status


def sitemap(base: str, catalog: list[dict[str, Any]], updated: float) -> str:
    day = datetime.fromtimestamp(updated, timezone.utc).strftime("%Y-%m-%d")
    urls = [(f"{base}/{p}", "weekly" if p in ("", "products.html") else "monthly") for p in STATIC_PAGES]
    cats = sorted({p["cat"] for p in catalog})
    urls += [(f"{base}/products.html?cat={c}", "weekly") for c in cats]
    urls += [(product_url(base, p), "weekly") for p in catalog]
    body = "".join(
        f"<url><loc>{html.escape(u)}</loc><lastmod>{day}</lastmod><changefreq>{freq}</changefreq></url>" for u, freq in urls
    )
    return f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{body}</urlset>\n'


def robots(base: str) -> str:
    return (
        "User-agent: *\n"
        "Allow: /\n"
        "Disallow: /admin.html\n"
        "Disallow: /checkout.html\n"
        "Disallow: /api/\n"
        "Disallow: /ncm/\n"
        f"\nSitemap: {base}/sitemap.xml\n"
    )
