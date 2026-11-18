export function scriptJson(name: string, data: unknown): string {
  const raw = JSON.stringify(data).replace(/<\//g, "<\\/").replace(/<!--/g, "<\\!--");
  return `<script>window.${name}=${raw};</script>`;
}

export function robots(base: string, indexable: boolean): string {
  if (!indexable) return "User-agent: *\nDisallow: /\n";
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /admin",
    "Disallow: /checkout",
    "Disallow: /api/",
    "Disallow: /ncm/",
    "",
    `Sitemap: ${base}/sitemap.xml`,
    "",
  ].join("\n");
}
