HEAD = """<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="icon" href="favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="favicon-32.png">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<meta name="theme-color" content="#F86808">
{extra_head}<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400..700&family=JetBrains+Mono:wght@500;600&family=Noto+Sans+Devanagari:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="styles.css">
<script>try{{var gt=JSON.parse(localStorage.getItem("gt_theme"));document.documentElement.dataset.theme=gt==="dark"?"dark":"light";var gl=JSON.parse(localStorage.getItem("gt_lang"));document.documentElement.lang=gl==="ne"?"ne":"en"}}catch(e){{}}</script>"""

SCRIPTS = """<script src="data.js"></script>
<script src="i18n.js"></script>
<script src="app.js"></script>"""

PAGES = {}

PAGES["index.html"] = dict(
    title="GifToyz Nepal",
    desc="Shop teddies, plush toys and tumblers online in Nepal. Pay by eSewa, bank QR or cash on delivery. Delivery to 300+ places with Nepal Can Move.",
    extra_head='<script type="application/ld+json">{"@context":"https://schema.org","@type":"Store","name":"GifToyz Nepal","telephone":"+977-9709119177","areaServed":"Nepal","sameAs":["https://www.instagram.com/giftoyz.np/"],"currenciesAccepted":"NPR"}</script>\n',
    body_class="",
    body="""<div id="site-header"></div>
<main>
  <section class="promo" id="promo" aria-roledescription="carousel" hidden></section>
  <section class="hero">
    <div class="wrap hero-grid">
      <div>
        <p class="eyebrow" data-i18n="hero_eyebrow"></p>
        <h1 data-i18n="hero_title"></h1>
        <div class="sell-box">
          <h2 data-i18n="sell_title"></h2>
          <ul id="sell-list"></ul>
          <p><span data-icon="truck"></span><span data-i18n="hero_sub"></span></p>
        </div>
        <div class="hero-cta">
          <a class="btn btn-primary" href="/products"><span data-i18n="hero_cta"></span><span data-icon="arrow"></span></a>
        </div>
      </div>
      <div class="hero-media" id="hero-media"></div>
    </div>
  </section>

  <div class="wrap"><div class="trust-row" id="trust"></div></div>

  <section class="section" id="shop" hidden>
    <div class="wrap">
      <div class="section-head"><h2 data-i18n="home_featured"></h2><a class="text-link" id="shop-more" href="/products"><span data-i18n="see_more"></span><span data-icon="arrow"></span></a></div>
      <div class="pills cat-pills" id="cats" role="group" hidden></div>
      <div class="grid" id="featured"></div>
    </div>
  </section>

  <section class="section">
    <div class="wrap">
      <div class="section-head"><h2 data-i18n="steps_title"></h2><a class="text-link" href="/help#how-to-order"><span data-i18n="f_how"></span><span data-icon="arrow"></span></a></div>
      <div class="steps">
        <div class="step"><span class="step-n">1</span><h3 data-i18n="step1_t"></h3><p data-i18n="step1_d"></p></div>
        <div class="step"><span class="step-n">2</span><h3 data-i18n="step2_t"></h3><p data-i18n="step2_d"></p></div>
        <div class="step"><span class="step-n">3</span><h3 data-i18n="step3_t"></h3><p data-i18n="step3_d"></p></div>
      </div>
    </div>
  </section>

  <section class="section-sm" style="padding-top:0">
    <div class="wrap">
      <div class="cta-band">
        <div><h2 data-i18n="insta_title"></h2><p data-i18n="insta_sub"></p></div>
        <a class="btn btn-ig" id="insta-btn" target="_blank" rel="noopener"><span data-icon="camera"></span><span data-i18n="insta_btn"></span></a>
      </div>
    </div>
  </section>
</main>
<div id="site-footer"></div>""",
    script="""(() => {
  const { SEED, t, esc, icon, media, productCard, products, catName, productUrl, pName, db, hydrate } = GT;
  GT.init("home");
  document.querySelectorAll("[data-icon]").forEach((el) => (el.outerHTML = icon(el.dataset.icon)));
  (() => {
    const s = db.settings();
    const banners = (s.banners || []).filter((b) => b && b.image && b.image.src);
    const host = document.getElementById("promo");
    if (!banners.length) return;
    const esc = GT.esc, L = GT.L;
    const set = (img, ext) => (img.widths || [800, 1600, 2400]).map((w) => `${esc(img.src)}-${w}.${ext} ${w}w`).join(", ");
    const sources = (img, media) => ["avif", "webp"].map((ext) => `<source type="image/${ext}" srcset="${set(img, ext)}" sizes="(max-width: 1240px) 100vw, 1240px"${media ? ` media="${media}"` : ""}>`).join("");
    const picture = (b, i) => `<picture>${b.mobile ? sources(b.mobile, "(max-width: 640px)") + `<source srcset="${set(b.mobile, "jpg")}" sizes="100vw" media="(max-width: 640px)">` : ""}${sources(b.image)}<img src="${esc(b.image.src)}-1600.jpg" srcset="${set(b.image, "jpg")}" sizes="(max-width: 1240px) 100vw, 1240px" width="${Number(b.image.w)}" height="${Number(b.image.h)}" alt="${esc(b.alt || L(b.title_en, b.title_ne) || "GifToyz announcement")}" ${i === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async"></picture>`;
    const external = (link) => /^https:/.test(link);
    const slide = (b, i) => {
      const title = L(b.title_en, b.title_ne), text = L(b.text_en, b.text_ne), cta = L(b.cta_en, b.cta_ne);
      const attrs = b.link ? `href="${esc(b.link)}"${external(b.link) ? ' target="_blank" rel="noopener"' : ""}` : "";
      const media = b.link ? `<a class="promo-media" ${attrs} tabindex="${title || text ? -1 : 0}" ${title || text ? 'aria-hidden="true"' : ""}>${picture(b, i)}</a>` : `<div class="promo-media">${picture(b, i)}</div>`;
      const caption = title || text || (cta && b.link) ? `<div class="promo-caption"><div>${title ? `<strong>${esc(title)}</strong>` : ""}${text ? `<span>${esc(text)}</span>` : ""}</div>${b.link ? `<a class="btn btn-primary btn-sm" ${attrs}>${esc(cta || t("promo_more"))}</a>` : ""}</div>` : "";
      return `<div class="promo-slide" role="group" aria-roledescription="slide" aria-label="${i + 1} / ${banners.length}">${media}${caption}</div>`;
    };
    host.setAttribute("aria-label", t("promo_label"));
    host.innerHTML = `<div class="wrap"><div class="promo-frame"><div class="promo-track" id="promo-track" tabindex="-1">${banners.map(slide).join("")}</div>
      ${banners.length > 1 ? `<button class="promo-nav prev" type="button" aria-label="${esc(t("promo_prev"))}">${icon("chevron-left")}</button><button class="promo-nav next" type="button" aria-label="${esc(t("promo_next"))}">${icon("chevron-right")}</button>` : ""}</div>
      ${banners.length > 1 ? `<div class="promo-dots" role="group" aria-label="${esc(t("promo_label"))}">${banners.map((_, i) => `<button type="button" data-go="${i}" aria-label="${i + 1} / ${banners.length}" aria-current="${i === 0}"></button>`).join("")}</div>` : ""}</div>`;
    host.hidden = false;
    if (banners.length < 2) return;
    const track = document.getElementById("promo-track");
    const dots = [...host.querySelectorAll("[data-go]")];
    let current = 0, timer = null;
    const paintDots = () => dots.forEach((d, j) => d.setAttribute("aria-current", String(j === current)));
    const go = (i) => {
      current = (i + banners.length) % banners.length;
      paintDots();
      const target = track.clientWidth * current;
      track.scrollTo({ left: target, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      setTimeout(() => { if (Math.abs(track.scrollLeft - target) > 4) track.scrollLeft = target; }, 700);
    };
    track.addEventListener("scroll", () => {
      const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
      if (i !== current) { current = i; paintDots(); }
    }, { passive: true });
    dots.forEach((d) => d.addEventListener("click", () => { go(Number(d.dataset.go)); restart(); }));
    host.querySelector(".prev").addEventListener("click", () => { go(current - 1); restart(); });
    host.querySelector(".next").addEventListener("click", () => { go(current + 1); restart(); });
    const stop = () => { clearInterval(timer); timer = null; };
    const start = () => { if (!timer && !matchMedia("(prefers-reduced-motion: reduce)").matches) timer = setInterval(() => go(current + 1), Math.max(3, Number(s.banner_seconds) || 6) * 1000); };
    const restart = () => { stop(); start(); };
    host.addEventListener("mouseenter", stop);
    host.addEventListener("mouseleave", start);
    host.addEventListener("focusin", stop);
    host.addEventListener("focusout", start);
    document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
    addEventListener("resize", () => track.scrollTo({ left: track.clientWidth * current }));
    start();
  })();
  document.getElementById("insta-btn").href = `https://www.instagram.com/${db.settings().instagram}/`;
  const list = products();
  const picked = (db.settings().hero || []).map((h) => ({ p: list.find((x) => x.id === h.id), label: h.label })).filter((h) => h.p);
  const auto = list.filter((p) => !picked.some((h) => h.p === p)).sort((a, b) => (b.stock > 0) - (a.stock > 0) || (b.badge === "best") - (a.badge === "best")).map((p) => ({ p, label: "" }));
  document.getElementById("hero-media").innerHTML = [...picked, ...auto].slice(0, 3).map(({ p, label }) => `<a class="tile" href="${productUrl(p)}" aria-label="${esc(pName(p))}">${media(p, { eager: true })}${label ? `<span class="tile-tag">${esc(t(`badge_${label}`))}</span>` : ""}<span class="tile-label">${esc(pName(p))}</span></a>`).join("");
  const rating = window.GT_RATING;
  const happy = Number(db.settings().happy_customers) || 0;
  const people = rating && rating.count >= 5
    ? ["star", t("trust_rating", { avg: rating.average }), t("trust_rating_d", { n: rating.count })]
    : happy > 0 ? ["heart", t("trust_happy", { n: happy.toLocaleString() }), t("trust_happy_d")] : ["shield", t("trust_check"), t("trust_check_d")];
  document.getElementById("trust").innerHTML = [people, ["truck", t("trust_delivery"), t("trust_delivery_d")], ["tag", t("trust_fair"), t("trust_fair_d")], ["qr", t("trust_pay"), t("trust_pay_d")]]
    .map(([i, a, b]) => `<div class="trust-item"><span class="ti">${icon(i)}</span><div><strong>${esc(a)}</strong><span>${esc(b)}</span></div></div>`).join("");
  document.getElementById("sell-list").innerHTML = t("sell_items").split("|").map((x) => `<li>${esc(x)}</li>`).join("");
  const loved = list.filter((p) => p.stock > 0).sort((a, b) => (b.badge === "best") - (a.badge === "best") || (b.compare > b.price) - (a.compare > a.price));
  const cats = SEED.categories.filter((c) => loved.some((p) => p.cat === c.id));
  const shop = document.getElementById("shop");
  const pills = document.getElementById("cats");
  const showCat = (cat) => {
    pills.innerHTML = [["all", t("f_all")], ...cats.map((c) => [c.id, catName(c)])].map(([id, label]) => `<button type="button" class="pill" data-cat="${esc(id)}" aria-pressed="${id === cat}">${esc(label)}</button>`).join("");
    document.getElementById("featured").innerHTML = loved.filter((p) => cat === "all" || p.cat === cat).slice(0, 8).map(productCard).join("");
    document.getElementById("shop-more").href = cat === "all" ? "/products" : `/products#${cat}`;
    hydrate(shop);
  };
  pills.setAttribute("aria-label", t("f_category"));
  pills.hidden = cats.length < 2;
  pills.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-cat]");
    if (!btn || btn.getAttribute("aria-pressed") === "true") return;
    showCat(btn.dataset.cat);
    pills.querySelector('[aria-pressed="true"]').focus({ preventScroll: true });
  });
  shop.hidden = !loved.length;
  showCat("all");
  hydrate();
})();""",
)

PAGES["products.html"] = dict(
    title="Shop gifts | GifToyz Nepal",
    desc="Browse teddies, plush toys and tumblers. Prices in NPR, live stock and delivery to 300+ places across Nepal.",
    extra_head="", body_class="",
    body="""<div id="site-header"></div>
<main>
  <section class="page-head">
    <div class="wrap">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="/" data-i18n="crumb_home"></a><span>/</span><span id="crumb"></span></nav>
      <h1 id="shop-title"></h1>
      <p class="lead" id="shop-lead"></p>
    </div>
  </section>
  <div class="wrap shop">
    <aside class="filters" aria-label="Filters">
      <div class="filter-group"><h3 data-i18n="f_category"></h3><div class="filter-list" id="f-cat"></div></div>
      <div class="filter-group" id="g-occ" hidden><h3 data-i18n="f_occasion"></h3><div class="filter-list" id="f-occ"></div></div>
      <div class="filter-group"><h3 data-i18n="f_price"></h3><div class="filter-list" id="f-price"></div></div>
      <label class="check"><input type="checkbox" id="f-stock"><span data-i18n="f_instock"></span></label>
    </aside>
    <section style="min-width:0">
      <div class="m-filters" id="m-filters"></div>
      <div class="toolbar">
        <span class="count" id="count" role="status"></span>
        <select class="select" id="sort" aria-label="Sort"></select>
      </div>
      <div class="grid" id="grid"></div>
      <div class="load-more"><button class="btn btn-secondary" type="button" id="more" hidden></button></div>
    </section>
  </div>
</main>
<div id="site-footer"></div>""",
    script="""(() => {
  const { SEED, t, esc, art, productCard, products, catName, occName, searchProducts, hydrate } = GT;
  GT.init("shop");
  const PAGE = 12;
  const prices = [
    { id: "all", key: "f_any_price", test: () => true },
    { id: "u1000", key: "p_u1000", test: (p) => p.price < 1000 },
    { id: "mid", key: "p_mid", test: (p) => p.price >= 1000 && p.price <= 2500 },
    { id: "o2500", key: "p_o2500", test: (p) => p.price > 2500 }
  ];
  const sorts = [["featured", "sort_featured"], ["price-asc", "sort_low"], ["price-desc", "sort_high"], ["offers", "sort_offers"]];
  document.getElementById("sort").innerHTML = sorts.map(([v, k]) => `<option value="${v}">${t(k)}</option>`).join("");
  const state = { cat: "all", occ: "all", price: "all", stock: false, sort: "featured", q: "", shown: PAGE };

  const fromHash = () => {
    const h = decodeURIComponent(location.hash.slice(1)) || new URLSearchParams(location.search).get("cat") || "";
    Object.assign(state, { cat: "all", occ: "all", q: "", shown: PAGE });
    if (SEED.categories.some((c) => c.id === h)) state.cat = h;
    else if (SEED.occasions.some((o) => o.id === h)) state.occ = h;
    else if (h === "search") { try { state.q = sessionStorage.getItem("gt_q") || ""; } catch {} }
  };
  const list = () => {
    let items = state.q ? searchProducts(state.q).products : products();
    items = items.filter((p) => (state.cat === "all" || p.cat === state.cat) && (state.occ === "all" || p.occasions.includes(state.occ)) && prices.find((x) => x.id === state.price).test(p) && (!state.stock || p.stock > 0));
    const by = {
      featured: (a, b) => (b.stock > 0) - (a.stock > 0) || (b.badge === "best") - (a.badge === "best") || a.id - b.id,
      "price-asc": (a, b) => a.price - b.price,
      "price-desc": (a, b) => b.price - a.price,
      offers: (a, b) => ((b.compare || 0) - b.price) - ((a.compare || 0) - a.price)
    };
    if (!state.q || state.sort !== "featured") items = items.slice().sort(by[state.sort]);
    return items;
  };
  const fbtn = (group, id, label, n) => `<button type="button" data-group="${group}" data-id="${id}" aria-pressed="${state[group] === id}"><span>${esc(label)}</span>${n !== undefined ? `<span class="n">${n}</span>` : ""}</button>`;
  const render = () => {
    const all = products();
    document.getElementById("f-cat").innerHTML = fbtn("cat", "all", t("f_all"), all.length) + GT.shopCategories().map((c) => fbtn("cat", c.id, catName(c), all.filter((p) => p.cat === c.id).length)).join("");
    document.getElementById("g-occ").hidden = !SEED.occasions.length;
    document.getElementById("f-occ").innerHTML = fbtn("occ", "all", t("f_any_occ")) + SEED.occasions.map((o) => fbtn("occ", o.id, occName(o), all.filter((p) => p.occasions.includes(o.id)).length)).join("");
    document.getElementById("f-price").innerHTML = prices.map((x) => fbtn("price", x.id, t(x.key))).join("");
    document.getElementById("f-stock").checked = state.stock;
    document.getElementById("sort").value = state.sort;
    document.getElementById("m-filters").innerHTML = [["all", t("f_all")], ...GT.shopCategories().map((c) => [c.id, catName(c)]), ...SEED.occasions.map((o) => [o.id, occName(o)])]
      .map(([id, label]) => {
        const isCat = id === "all" || SEED.categories.some((c) => c.id === id);
        return `<button class="pill" type="button" data-chip="${id}" aria-pressed="${isCat ? state.cat === id && state.occ === "all" : state.occ === id}">${esc(label)}</button>`;
      }).join("");
    const cat = SEED.categories.find((c) => c.id === state.cat);
    const occ = SEED.occasions.find((o) => o.id === state.occ);
    const title = state.q ? t("results_for", { q: state.q }) : cat ? catName(cat) : occ ? occName(occ) : t("shop_title");
    document.getElementById("shop-title").textContent = title;
    document.getElementById("crumb").textContent = title;
    document.title = `${title} | GifToyz Nepal`;
    document.getElementById("shop-lead").innerHTML = state.q ? `<button class="text-btn" type="button" id="clear-q">${t("clear_search")}</button>` : esc(t("shop_sub"));
    document.getElementById("clear-q")?.addEventListener("click", () => { try { sessionStorage.removeItem("gt_q"); } catch {} history.replaceState(null, "", location.pathname); fromHash(); render(); });

    const items = list();
    const grid = document.getElementById("grid");
    const more = document.getElementById("more");
    document.getElementById("count").textContent = items.length === 1 ? t("n_gift") : t("n_gifts", { n: items.length });
    if (!items.length) {
      grid.style.display = "block";
      grid.innerHTML = `<div class="empty"><div class="empty-art">${art("teddy", "#C47A3D")}</div><h3>${t("empty_title")}</h3><p>${t("empty_sub")}</p><button class="btn btn-primary" type="button" id="reset">${t("clear_filters")}</button></div>`;
      document.getElementById("reset").addEventListener("click", () => { Object.assign(state, { cat: "all", occ: "all", price: "all", stock: false, q: "", shown: PAGE }); history.replaceState(null, "", location.pathname); render(); });
      more.hidden = true;
      return;
    }
    grid.style.display = "";
    grid.innerHTML = items.slice(0, state.shown).map(productCard).join("");
    more.hidden = items.length <= state.shown;
    more.textContent = t("show_more", { n: items.length - state.shown });
    hydrate(grid);
  };
  document.querySelector(".filters").addEventListener("click", (e) => { const b = e.target.closest("button[data-group]"); if (b) { state[b.dataset.group] = b.dataset.id; state.shown = PAGE; render(); } });
  document.getElementById("m-filters").addEventListener("click", (e) => {
    const b = e.target.closest("[data-chip]"); if (!b) return;
    const id = b.dataset.chip;
    if (id === "all" || SEED.categories.some((c) => c.id === id)) { state.cat = id; state.occ = "all"; } else { state.occ = id; state.cat = "all"; }
    state.shown = PAGE; render();
  });
  document.getElementById("f-stock").addEventListener("change", (e) => { state.stock = e.target.checked; render(); });
  document.getElementById("sort").addEventListener("change", (e) => { state.sort = e.target.value; render(); });
  document.getElementById("more").addEventListener("click", () => { state.shown += PAGE; render(); });
  addEventListener("hashchange", () => { fromHash(); render(); });
  fromHash(); render();
})();""",
)

PAGES["product.html"] = dict(
    title="Product | GifToyz Nepal",
    desc="Gift details, price in NPR, stock and delivery fee to your area in Nepal.",
    extra_head="", body_class="with-sticky",
    body="""<div id="site-header"></div>
<main id="root"></main>
<section class="section" id="reviews-wrap" hidden>
  <div class="wrap">
    <div class="section-head"><div><h2 data-i18n="reviews_t"></h2><p class="muted" id="reviews-sum"></p></div></div>
    <div class="reviews" id="reviews"></div>
  </div>
</section>
<section class="section surface-band" id="related-wrap" hidden>
  <div class="wrap">
    <div class="section-head"><h2 data-i18n="related"></h2><a class="text-link" href="/products"><span data-i18n="see_all"></span></a></div>
    <div class="grid" id="related"></div>
  </div>
</section>
<div id="site-footer"></div>""",
    script="""(() => {
  const { SEED, t, esc, rs, icon, art, media, productById, products, categoryById, catName, colorName, colorHex, pName, pBlurb, pSpecs, stockNote, productCard, cart, waLink, mountLocationPicker, hydrate } = GT;
  GT.init("shop");
  const root = document.getElementById("root");
  const itemParam = new URLSearchParams(location.search).get("item");
  const p = itemParam ? GT.productByItemId(itemParam) : productById(Number((location.hash.match(/item-(\\d+)/) || [])[1]));
  addEventListener("hashchange", () => location.reload());
  if (!p || p.visible === false) {
    document.body.classList.remove("with-sticky");
    root.innerHTML = `<div class="wrap section"><div class="empty"><div class="empty-art">${art("teddy", "#C47A3D")}</div><h3>${t("not_found_t")}</h3><p>${t("not_found_d")}</p><a class="btn btn-primary" href="/products">${t("browse_all")}</a></div></div>`;
    return;
  }
  const cat = categoryById(p.cat);
  const sale = p.compare && p.compare > p.price;
  const state = { color: p.colors[0], qty: 1, loc: null, img: 0 };
  document.title = `${pName(p)} | GifToyz Nepal`;
  if (!window.GT_CATALOG) {
    document.querySelector('meta[name="description"]').content = `${pName(p)}, ${rs(p.price)}. ${pBlurb(p)}`;
    const ld = document.createElement("script");
    ld.type = "application/ld+json";
    ld.textContent = JSON.stringify({ "@context": "https://schema.org", "@type": "Product", name: p.name, sku: p.itemId || `GT-${p.id}`, description: p.blurb, brand: { "@type": "Brand", name: "GifToyz" }, offers: { "@type": "Offer", priceCurrency: "NPR", price: p.price, availability: p.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock" } });
    document.head.appendChild(ld);
  }
  const images = p.images || [];

  root.innerHTML = `
<div class="wrap">
  <nav class="crumbs" aria-label="Breadcrumb" style="padding-top:32px"><a href="/">${t("crumb_home")}</a><span>/</span><a href="/products#${cat.id}">${catName(cat)}</a><span>/</span><span>${esc(pName(p))}</span></nav>
  <div class="pdp">
    <div class="gallery"><div class="thumbs" id="thumbs"></div><div id="main"></div></div>
    <div class="pdp-info">
      <div>
        <p class="eyebrow">${catName(cat)} · ${t("item_no", { n: p.itemId || p.id })} · ${t("kg", { kg: Number(p.weight_kg || 0.5) })}</p>
        <h1>${esc(pName(p))}</h1>
        <div class="pdp-price"><span class="price">${rs(p.price)}</span>${sale ? `<span class="price-was">${rs(p.compare)}</span><span class="save">${t("you_save", { n: rs(p.compare - p.price) })}</span>` : ""}</div>
        <div style="margin-top:8px">${stockNote(p)}</div>
      </div>
      <p class="pdp-blurb">${esc(pBlurb(p))}</p>
      <div><div class="opt-label">${t("colour")}<span id="color-name"></span></div><div class="swatch-row" id="swatches"></div></div>
      ${p.stock > 0 ? `
      <div class="buy-stack">
        <div class="buy-row">
          <div class="qty" aria-label="${t("qty")}"><button type="button" id="q-minus" aria-label="-">&minus;</button><output id="q-val">1</output><button type="button" id="q-plus" aria-label="+">+</button></div>
          <button class="btn btn-primary" type="button" id="add">${t("add_to_cart")}</button>
        </div>
        <a class="btn btn-secondary" id="wa" target="_blank" rel="noopener">${icon("chat")}<span>${t("order_wa")}</span></a>
      </div>` : `
      <div class="buy-stack">
        <div class="note">${icon("info")}<span>${t("sold_out_note")}</span></div>
        <a class="btn btn-primary" href="${waLink(t("notify_msg", { p: p.name, id: p.id }))}" target="_blank" rel="noopener">${t("notify_wa")}</a>
      </div>`}
      <div class="box">
        <h3>${t("delivery_check")}</h3>
        <div class="field loc">
          <label for="loc-input">${t("loc_label")}</label>
          <input class="input" id="loc-input" type="text" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="loc-list" placeholder="${esc(t("loc_ph"))}">
          <div class="loc-list" id="loc-list" role="listbox" hidden></div>
        </div>
        <div id="loc-result" class="muted small">${t("loc_hint")}</div>
        <p id="pd-weight" class="muted small" style="margin-top:10px"></p>
      </div>
      <div class="assure">
        <div>${icon("truck")}<span>${t("assure_track")}</span></div>
        <div>${icon("cash")}<span>${t("assure_pay")}</span></div>
        <div>${icon("shield")}<span>${t("assure_check")}</span></div>
      </div>
      <div>
        <details class="acc" open><summary>${t("details")}${icon("plus")}</summary><div class="acc-body"><ul>${pSpecs(p).map((s) => `<li>${esc(s)}</li>`).join("")}</ul></div></details>
        <details class="acc"><summary>${t("delivery_payment")}${icon("plus")}</summary><div class="acc-body"><p>${t("acc_delivery")}</p><a class="text-link" href="/help#delivery">${t("see_rates")}</a></div></details>
        <details class="acc"><summary>${t("returns")}${icon("plus")}</summary><div class="acc-body"><p>${t("acc_returns")}</p><a class="text-link" href="/help#returns">${t("read_policy")}</a></div></details>
      </div>
    </div>
  </div>
</div>
${p.stock > 0 ? `<div class="sticky-buy"><span class="price">${rs(p.price)}</span><button class="btn btn-primary" type="button" id="add-sticky">${t("add_to_cart")}</button></div>` : ""}`;
  if (p.stock <= 0) document.body.classList.remove("with-sticky");

  const paint = () => {
    const main = document.getElementById("main");
    const thumbs = document.getElementById("thumbs");
    document.querySelector(".gallery").classList.toggle("single", images.length ? images.length < 2 : p.colors.length < 2);
    if (images.length) {
      main.innerHTML = media(p, { image: images[state.img], cls: "main", eager: true });
      thumbs.innerHTML = images.length > 1 ? images.map((img, i) => `<button type="button" data-img-i="${i}" aria-pressed="${i === state.img}" aria-label="Photo ${i + 1}">${media(p, { image: img, cls: "square" })}</button>`).join("") : "";
    } else {
      main.innerHTML = media(p, { color: state.color, cls: "main" });
      thumbs.innerHTML = p.colors.length > 1 ? p.colors.map((k) => `<button type="button" data-color="${k}" aria-pressed="${k === state.color}" aria-label="${esc(colorName(k))}">${media(p, { color: k, cls: "square" })}</button>`).join("") : "";
    }
    document.getElementById("color-name").textContent = colorName(state.color);
    document.getElementById("swatches").innerHTML = p.colors.map((k) => `<button class="swatch-btn" type="button" data-color="${k}" aria-pressed="${k === state.color}" aria-label="${esc(colorName(k))}" style="background:${colorHex(k)}"></button>`).join("");
    const wa = document.getElementById("wa");
    if (wa) {
      const lines = [t("wa_order_msg", { qty: state.qty, p: p.name, id: p.id, c: colorName(state.color), price: rs(p.price * state.qty) })];
      if (state.loc) lines.push(t("wa_deliver_to", { loc: `${state.loc.name}${state.loc.district ? ", " + state.loc.district : ""}` }));
      wa.href = waLink(lines.join("\\n"));
    }
    const q = document.getElementById("q-val");
    if (q) q.textContent = state.qty;
    hydrate(root);
  };
  root.addEventListener("click", (e) => {
    const c = e.target.closest("[data-color]");
    if (c) {
      state.color = c.dataset.color;
      const match = images.findIndex((img) => img.color === state.color);
      if (match >= 0) state.img = match;
      paint();
    }
    const im = e.target.closest("[data-img-i]");
    if (im) { state.img = Number(im.dataset.imgI); if (images[state.img].color) state.color = images[state.img].color; paint(); }
  });
  document.getElementById("q-minus")?.addEventListener("click", () => { state.qty = Math.max(1, state.qty - 1); paint(); showLoc(); });
  document.getElementById("q-plus")?.addEventListener("click", () => { state.qty = Math.min(p.stock, state.qty + 1); paint(); showLoc(); });
  const add = () => cart.add(p.id, state.color, state.qty);
  document.getElementById("add")?.addEventListener("click", add);
  document.getElementById("add-sticky")?.addEventListener("click", add);
  const showLoc = () => {
    const row = state.loc;
    const pw = document.getElementById("pd-weight");
    if (pw) pw.textContent = t("pd_weight", { kg: GT.parcelKg([{ weight_kg: p.weight_kg, qty: state.qty }]) });
    const out = document.getElementById("loc-result");
    if (!out) return;
    if (!row) { out.className = "muted small"; out.textContent = t("loc_hint"); }
    else {
      out.className = "";
      const kg = GT.parcelKg([{ weight_kg: p.weight_kg, qty: state.qty }]);
      out.innerHTML = `<div class="choice-grid"><div class="choice static"><span class="c-title">${t("home_delivery")}<span class="c-price">${rs(GT.weightedFee(row.home, kg))}</span></span><span class="c-sub">${esc(t("to_door", { p: row.name }))}</span></div><div class="choice static"><span class="c-title">${t("branch_pickup")}<span class="c-price">${rs(GT.weightedFee(row.branch, kg))}</span></span><span class="c-sub">${esc(t("collect_from", { p: row.name }))}</span></div></div>`;
    }
  };
  mountLocationPicker({
    input: document.getElementById("loc-input"),
    list: document.getElementById("loc-list"),
    onPick(row) {
      state.loc = row;
      showLoc();
      paint();
    }
  });
  paint();
  showLoc();
  const related = products().filter((x) => x.id !== p.id && x.stock > 0).sort((a, b) => (b.cat === p.cat) - (a.cat === p.cat) || b.occasions.filter((o) => p.occasions.includes(o)).length - a.occasions.filter((o) => p.occasions.includes(o)).length).slice(0, 4);
  document.getElementById("related").innerHTML = related.map(productCard).join("");
  document.getElementById("related-wrap").hidden = !related.length;
  const rv = window.GT_REVIEWS;
  if (rv && rv.count > 0) {
    const stars = (n) => `<span class="stars" aria-label="${esc(t("rate_stars", { n }))}">${[1, 2, 3, 4, 5].map((i) => `<span class="${i <= Math.round(n) ? "on" : ""}">${icon("star")}</span>`).join("")}</span>`;
    document.getElementById("reviews-sum").innerHTML = `${stars(rv.average)} ${esc(t(rv.count === 1 ? "reviews_n1" : "reviews_n", { avg: rv.average, n: rv.count }))}`;
    document.getElementById("reviews").innerHTML = rv.reviews.map((r) => `<article class="review">${stars(r.stars)}<p>${esc(r.body)}</p><p class="muted small">${esc(r.name)} · ${esc(new Date(r.at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }))}</p></article>`).join("");
    document.getElementById("reviews-wrap").hidden = false;
  }
  hydrate(document.getElementById("related"));
})();""",
)
