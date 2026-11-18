#!/usr/bin/env bash
# Checks giftoyz.com through Cloudflare's address, bypassing a stale local DNS cache.
R=(--resolve giftoyz.com:443:104.21.25.211 --resolve www.giftoyz.com:443:104.21.25.211)
for p in / /healthz /admin /products /index.html /robots.txt /sitemap.xml /media/products/q-1f54c0d72790.png /server/.env; do
  echo "$p $(curl "${R[@]}" -s -o /dev/null -w '%{http_code}' "https://giftoyz.com$p")"
done
curl "${R[@]}" -s -o /dev/null -w "www %{http_code} %{redirect_url}\n" https://www.giftoyz.com/about
curl "${R[@]}" -sI https://giftoyz.com/ | grep -iE "strict-transport|x-robots"
curl "${R[@]}" -s https://giftoyz.com/robots.txt | tail -2
curl "${R[@]}" -sv -o /dev/null https://giftoyz.com/ 2>&1 | grep -E "subject:|issuer:|expire"
