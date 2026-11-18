(() => {
  const SEED = window.GT_DATA;
  const I18N = window.GT_I18N;
  const SEED_VERSION = 4;

  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
    remove(key) {
      try { localStorage.removeItem(key); } catch {}
    }
  };

  const idb = (() => {
    let dbPromise;
    const open = () => {
      if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
          try {
            const req = indexedDB.open("giftoyz", 1);
            req.onupgradeneeded = () => req.result.createObjectStore("images");
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          } catch (error) {
            reject(error);
          }
        });
      }
      return dbPromise;
    };
    const tx = async (mode, fn) => {
      const db = await open();
      return new Promise((resolve, reject) => {
        const t = db.transaction("images", mode);
        const req = fn(t.objectStore("images"));
        t.oncomplete = () => resolve(req && req.result);
        t.onerror = () => reject(t.error);
      });
    };
    return {
      put: (id, blob) => tx("readwrite", (s) => s.put(blob, id)),
      get: (id) => tx("readonly", (s) => s.get(id)).catch(() => null),
      del: (id) => tx("readwrite", (s) => s.delete(id)).catch(() => null)
    };
  })();

  const defaultSettings = {
    phone: "9709119177",
    whatsapp: "9779709119177",
    instagram: "giftoyz.np",
    tiktok: "giftoyz.np",
    facebook: "",
    email: "",
    hours_en: "Every day, 9 am to 8 pm",
    hours_ne: "हरेक दिन, बिहान ९ देखि बेलुका ८ बजेसम्म",
    orders_paused: false,
    pause_en: "",
    pause_ne: "",
    announce_en: "Delivery to 300+ places across Nepal.",
    announce_ne: "नेपालभर ३००+ ठाउँमा डेलिभरी।",
    codAdvance: true,
    lowStock: 5,
    pin: "1234",
    qr: { esewa: null, khalti: null, bank: null }
  };

  if (store.get("gt_seed_v", 0) !== SEED_VERSION) {
    store.set("gt_products", SEED.products);
    store.set("gt_seed_v", SEED_VERSION);
    store.remove("gt_rates");
  }

  const SERVER = window.GT_CONFIG || null;
  const db = {
    products: () => (Array.isArray(window.GT_CATALOG) && !window.GT_ADMIN ? window.GT_CATALOG : store.get("gt_products", SEED.products)),
    saveProducts: (list) => store.set("gt_products", list),
    orders: () => store.get("gt_orders", []),
    saveOrders: (list) => store.set("gt_orders", list),
    settings: () => {
      const saved = window.GT_SETTINGS && !window.GT_ADMIN ? window.GT_SETTINGS : store.get("gt_settings", {});
      return { ...defaultSettings, ...saved, qr: { ...defaultSettings.qr, ...(saved.qr || {}) } };
    },
    saveSettings: (s) => store.set("gt_settings", s),
    rates: () => (window.GT_RATES ? SEED.ncm : store.get("gt_rates", SEED.ncm)),
    saveRates: (r) => store.set("gt_rates", r)
  };

  const lang = () => (store.get("gt_lang", "en") === "ne" ? "ne" : "en");
  const t = (key, vars) => {
    let text = (I18N[lang()] && I18N[lang()][key]) ?? I18N.en[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) text = text.split(`{${k}}`).join(v);
    return text;
  };
  const L = (en, ne) => (lang() === "ne" && ne ? ne : en);
  const pName = (p) => L(p.name, p.ne_name);
  const pBlurb = (p) => L(p.blurb, p.ne_blurb);
  const pSpecs = (p) => (lang() === "ne" && p.ne_specs && p.ne_specs.length ? p.ne_specs : p.specs || []);
  const catName = (c) => L(c.en, c.ne);
  const occName = (o) => L(o.en, o.ne);
  const colorName = (k) => (SEED.swatch[k] ? L(SEED.swatch[k].en, SEED.swatch[k].ne) : k);

  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const rs = (n) => `${lang() === "ne" ? "रु" : "Rs"} ${Number(n || 0).toLocaleString("en-IN")}`;

  const theme = {
    current() {
      const saved = store.get("gt_theme", null);
      return saved === "dark" ? "dark" : "light";
    },
    apply() {
      document.documentElement.dataset.theme = theme.current();
    },
    toggle() {
      const next = theme.current() === "dark" ? "light" : "dark";
      store.set("gt_theme", next);
      document.documentElement.dataset.theme = next;
      document.querySelectorAll("[data-theme-toggle]").forEach(paintThemeButton);
    }
  };
  theme.apply();
  document.documentElement.lang = lang();

  const icon = (name) => {
    const p = {
      search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
      bag: '<path d="M5 8h14l-1.2 12.1a1 1 0 0 1-1 .9H7.2a1 1 0 0 1-1-.9L5 8Z"/><path d="M9 8V7a3 3 0 0 1 6 0v1"/>',
      cart: '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2.5 3h2.3l2.4 11.2a1.5 1.5 0 0 0 1.5 1.2h9.1a1.5 1.5 0 0 0 1.5-1.1L21 7H5.8"/>',
      plus: '<path d="M12 5v14M5 12h14"/>',
      star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z"/>',
      menu: '<path d="M4 8h16M4 16h16"/>',
      close: '<path d="M6 6l12 12M18 6 6 18"/>',
      arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
      check: '<path d="m5 12 4.5 4.5L19 7"/>',
      truck: '<path d="M3 6h11v10H3z"/><path d="M14 9h4l3 3v4h-7"/><circle cx="7" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/>',
      cash: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
      qr: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z"/><path d="M14 14h2v2h-2zM18 14h2M14 18v2M18 18h2v2"/>',
      gift: '<rect x="3.5" y="8" width="17" height="4" rx="1"/><path d="M5 12v8h14v-8M12 8v12"/><path d="M12 8c-1.5-3.5-5.5-3.8-5.5-1.5S10 8 12 8c2 0 5.5 0 5.5-1.5S13.5 4.5 12 8Z"/>',
      shield: '<path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
      chat: '<path d="M4.5 19.5 5.6 16A8 8 0 1 1 8.5 19l-4 .5Z"/>',
      camera: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5h.01"/>',
      phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
      pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>',
      clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
      "chevron-left": '<path d="m15 18-6-6 6-6"/>',
      "chevron-right": '<path d="m9 18 6-6-6-6"/>',
      image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
      music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
      mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
      layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
      download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
      box: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5v-9Z"/><path d="m3 7.5 9 4.5 9-4.5M12 12v9"/>',
      info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
      sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
      moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z"/>',
      tag: '<path d="M3 12V4h8l10 10-8 8L3 12Z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
      heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/>',
      user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
      x: '<path d="M6 6l12 12M18 6 6 18"/>'
    }[name] || "";
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  };

  const K = "currentColor";
  const isDark = (hex) => {
    const n = parseInt(String(hex).slice(1), 16);
    return ((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11 < 90;
  };
  const shade = (hex, amount) => {
    const n = parseInt(hex.slice(1), 16);
    const mix = (c) => Math.max(0, Math.min(255, Math.round(c * (1 - amount))));
    return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => mix(c).toString(16).padStart(2, "0")).join("")}`;
  };
  const accentFor = (c) => (c.toLowerCase() === "#f86808" ? "#1E1E1E" : "#F86808");
  const shapes = {
    tumbler: (c) => `<path d="M136 76 C170 76 172 134 136 142" fill="none" stroke="${K}" stroke-width="13" stroke-linecap="round"/><path d="M136 76 C170 76 172 134 136 142" fill="none" stroke="${c}" stroke-width="8" stroke-linecap="round"/><path d="M112 48 L126 8" stroke="${K}" stroke-width="8" stroke-linecap="round"/><path d="M112 48 L126 8" stroke="${accentFor(c)}" stroke-width="4" stroke-linecap="round"/><path d="M62 60 H138 L127 177 Q126 188 115 188 H85 Q74 188 73 177 Z" fill="${c}" stroke="${K}" stroke-width="3" stroke-linejoin="round"/><rect x="54" y="40" width="92" height="24" rx="10" fill="${isDark(c) ? "#3a3836" : shade(c, 0.12)}" stroke="${K}" stroke-width="3"/><path d="M84 80 L80 166" stroke="#fff" stroke-opacity="${isDark(c) ? 0.25 : 0.65}" stroke-width="6" stroke-linecap="round"/>`,
    bottle: (c) => `<rect x="77" y="12" width="46" height="28" rx="10" fill="${isDark(c) ? "#F86808" : "#2a2a2c"}" stroke="${K}" stroke-width="3"/><rect x="85" y="38" width="30" height="16" fill="${shade(c, 0.1)}" stroke="${K}" stroke-width="3"/><rect x="62" y="52" width="76" height="136" rx="28" fill="${c}" stroke="${K}" stroke-width="3"/><rect x="62" y="116" width="76" height="22" fill="${isDark(c) ? "#333336" : shade(c, 0.1)}" stroke="${K}" stroke-width="2.5"/><path d="M82 74 L82 104 M82 150 L82 168" stroke="#fff" stroke-opacity="${isDark(c) ? 0.25 : 0.7}" stroke-width="6" stroke-linecap="round"/>`,
    mug: (c) => `<path d="M140 92 C182 92 182 156 140 156" fill="none" stroke="${K}" stroke-width="15" stroke-linecap="round"/><path d="M140 92 C182 92 182 156 140 156" fill="none" stroke="${c}" stroke-width="9" stroke-linecap="round"/><rect x="40" y="58" width="104" height="128" rx="18" fill="${c}" stroke="${K}" stroke-width="3"/><path d="M40 80 H144" stroke="${K}" stroke-width="2.5" opacity="0.5"/><path d="M92 156 L70 134 C60 124 66 108 80 108 C86 108 90 112 92 116 C94 112 98 108 104 108 C118 108 124 124 114 134 Z" fill="${accentFor(c)}" stroke="${K}" stroke-width="2.5" stroke-linejoin="round"/>`,
    teddy: (c) => {
      const light = "#F6E4CC";
      const bow = c.toLowerCase() === "#f86808" ? "#1E1E1E" : "#F86808";
      return `<circle cx="60" cy="50" r="21" fill="${c}" stroke="${K}" stroke-width="3"/><circle cx="140" cy="50" r="21" fill="${c}" stroke="${K}" stroke-width="3"/><circle cx="60" cy="50" r="9" fill="${light}"/><circle cx="140" cy="50" r="9" fill="${light}"/><ellipse cx="56" cy="140" rx="15" ry="24" transform="rotate(20 56 140)" fill="${c}" stroke="${K}" stroke-width="3"/><ellipse cx="144" cy="140" rx="15" ry="24" transform="rotate(-20 144 140)" fill="${c}" stroke="${K}" stroke-width="3"/><ellipse cx="100" cy="150" rx="47" ry="42" fill="${c}" stroke="${K}" stroke-width="3"/><ellipse cx="100" cy="156" rx="25" ry="23" fill="${light}"/><ellipse cx="72" cy="186" rx="19" ry="12" fill="${c}" stroke="${K}" stroke-width="3"/><ellipse cx="128" cy="186" rx="19" ry="12" fill="${c}" stroke="${K}" stroke-width="3"/><circle cx="100" cy="82" r="45" fill="${c}" stroke="${K}" stroke-width="3"/><ellipse cx="100" cy="99" rx="19" ry="15" fill="${light}"/><circle cx="83" cy="76" r="5" fill="#1E1E1E"/><circle cx="117" cy="76" r="5" fill="#1E1E1E"/><ellipse cx="100" cy="93" rx="6.5" ry="4.5" fill="#1E1E1E"/><path d="M100 97 V103 M92 104 Q100 110 108 104" fill="none" stroke="#1E1E1E" stroke-width="2.5" stroke-linecap="round"/><path d="M100 128 L82 119 L82 137 Z M100 128 L118 119 L118 137 Z" fill="${bow}" stroke="${K}" stroke-width="2.5" stroke-linejoin="round"/><circle cx="100" cy="128" r="5" fill="${bow}" stroke="${K}" stroke-width="2.5"/>`;
    },
    giftbox: (c) => {
      const r = isDark(c) ? "#F86808" : c.toLowerCase() === "#f86808" ? "#1E1E1E" : "#F86808";
      return `<rect x="46" y="100" width="108" height="86" rx="8" fill="${c}" stroke="${K}" stroke-width="3"/><rect x="91" y="100" width="18" height="86" fill="${r}"/><rect x="36" y="78" width="128" height="30" rx="8" fill="${c}" stroke="${K}" stroke-width="3"/><rect x="91" y="78" width="18" height="30" fill="${r}"/><path d="M100 78 C80 46 52 54 62 72 C68 84 90 80 100 78 Z" fill="${r}" stroke="${K}" stroke-width="3" stroke-linejoin="round"/><path d="M100 78 C120 46 148 54 138 72 C132 84 110 80 100 78 Z" fill="${r}" stroke="${K}" stroke-width="3" stroke-linejoin="round"/><circle cx="100" cy="78" r="8" fill="${r}" stroke="${K}" stroke-width="3"/>`;
    },
    hamper: (c) => `<path d="M44 112 C44 30 156 30 156 112" fill="none" stroke="${K}" stroke-width="7" stroke-linecap="round"/><path d="M44 112 C44 30 156 30 156 112" fill="none" stroke="#D9A066" stroke-width="3.5" stroke-linecap="round"/><circle cx="90" cy="96" r="26" fill="#C47A3D" stroke="${K}" stroke-width="3"/><circle cx="82" cy="92" r="3.5" fill="#1E1E1E"/><circle cx="98" cy="92" r="3.5" fill="#1E1E1E"/><ellipse cx="90" cy="102" rx="9" ry="6" fill="#F6E4CC"/><rect x="116" y="70" width="34" height="44" rx="6" fill="${c}" stroke="${K}" stroke-width="3"/><path d="M34 110 H166 L150 184 Q148 192 140 192 H60 Q52 192 50 184 Z" fill="#D9A066" stroke="${K}" stroke-width="3" stroke-linejoin="round"/><path d="M44 134 H156 M48 156 H152 M52 176 H148" stroke="${K}" stroke-width="2" opacity="0.25"/><rect x="28" y="104" width="144" height="16" rx="6" fill="#C98B4F" stroke="${K}" stroke-width="3"/>`
  };
  const art = (type, color) => `<svg viewBox="0 0 200 200" aria-hidden="true">${(shapes[type] || shapes.giftbox)(color || "#F86808")}</svg>`;
  const artGroup = (type, color, x, y, scale, rotate = 0) => `<g transform="translate(${x} ${y}) rotate(${rotate} ${100 * scale} ${100 * scale}) scale(${scale})">${shapes[type](color)}</g>`;

  const colorHex = (k) => (SEED.swatch[k] || SEED.swatch.orange).hex;
  const categories = () => SEED.categories;
  const shopCategories = () => SEED.categories.filter((c) => products().some((p) => p.cat === c.id));
  const categoryById = (id) => SEED.categories.find((c) => c.id === id) || SEED.categories[0];
  const allProducts = () => db.products();
  const products = () => allProducts().filter((p) => p.visible !== false);
  const productById = (id) => allProducts().find((p) => p.id === Number(id));
  const productByItemId = (itemId) => allProducts().find((p) => p.itemId === String(itemId).toUpperCase());
  const productUrl = (p) => (p.itemId ? `/product?item=${encodeURIComponent(p.itemId)}` : `/product#item-${p.id}`);

  const SIZES = {
    main: "(max-width: 900px) 100vw, 560px",
    square: "(max-width: 640px) 25vw, 120px",
    card: "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 300px"
  };
  const srcset = (image, ext) => (image.widths || [600, 1200]).map((w) => `${esc(image.src)}-${w}.${ext} ${w}w`).join(", ");
  const imgTag = (image, alt, eager, sizes = SIZES.card) => {
    const fx = image.focal ? image.focal.x : 50;
    const fy = image.focal ? image.focal.y : 50;
    const fit = image.fit === "contain" ? "contain" : "cover";
    const loading = eager ? 'fetchpriority="high"' : 'loading="lazy"';
    if (image.src) {
      const formats = image.formats || ["avif", "webp", "jpg"];
      const smallest = (image.widths || [600])[0];
      const sources = formats.filter((f) => f !== "jpg").map((f) => `<source type="image/${f}" srcset="${srcset(image, f)}" sizes="${sizes}">`).join("");
      return `<picture>${sources}<img src="${esc(image.src)}-${smallest}.jpg" srcset="${srcset(image, "jpg")}" sizes="${sizes}" width="${Number(image.w) || 1200}" height="${Number(image.h) || 1500}" data-fit="${fit}" alt="${esc(image.alt || alt)}" style="object-position:${fx}% ${fy}%" ${loading} decoding="async"></picture>`;
    }
    return `<img data-img="${esc(image.id)}" data-fit="${fit}" alt="${esc(alt)}" width="1200" height="1500" style="object-position:${fx}% ${fy}%" ${loading} decoding="async">`;
  };
  const media = (p, { image, color, cls = "", eager = false } = {}) => {
    const img = image || (p.images && p.images[0]);
    const tint = color || (img && img.color) || p.colors[0];
    const sizes = /\bmain\b/.test(cls) ? SIZES.main : /\bsquare\b/.test(cls) ? SIZES.square : SIZES.card;
    return `<div class="media ${cls}${img && img.src ? " has-photo" : ""}">${img ? imgTag(img, pName(p), eager, sizes) : ""}<span class="art">${art(p.art, colorHex(tint))}</span></div>`;
  };

  const urlCache = new Map();
  const hydrate = async (root = document) => {
    const nodes = [...root.querySelectorAll("img[data-img]:not([src])")];
    await Promise.all(nodes.map(async (img) => {
      const id = img.dataset.img;
      let url = urlCache.get(id);
      if (!url) {
        const blob = await idb.get(id);
        if (!blob) return;
        url = URL.createObjectURL(blob);
        urlCache.set(id, url);
      }
      img.src = url;
      img.closest(".media")?.classList.add("has-photo");
    }));
  };

  const stockNote = (p) => {
    const low = db.settings().lowStock;
    if (p.stock <= 0) return `<span class="stock out">${t("sold_out")}</span>`;
    if (p.stock <= low) return `<span class="stock low">${t("only_left", { n: p.stock })}</span>`;
    return `<span class="stock ok">${t("in_stock")}</span>`;
  };
  const badgeFor = (p) => {
    if (p.stock <= 0) return `<span class="card-badge out">${t("sold_out")}</span>`;
    if (p.compare && p.compare > p.price) return `<span class="card-badge sale">${t("save", { n: (p.compare - p.price).toLocaleString("en-IN") })}</span>`;
    if (p.badge) return `<span class="card-badge">${t(`badge_${p.badge}`)}</span>`;
    return "";
  };
  const priceBlock = (p) => `<div class="price-row"><span class="price">${rs(p.price)}</span>${p.compare && p.compare > p.price ? `<span class="price-was">${rs(p.compare)}</span>` : ""}</div>`;

  const productCard = (p) => `
<article class="card">
  <div class="card-mw">
    <a href="${productUrl(p)}" aria-label="${esc(pName(p))}">${badgeFor(p)}${media(p)}</a>
    ${p.stock > 0 ? `<button class="quick-add" type="button" data-add="${p.id}" aria-label="${esc(t("add_to_cart"))}: ${esc(pName(p))}">${icon("plus")}</button>` : ""}
  </div>
  <div class="card-info">
    <a class="card-title" href="${productUrl(p)}">${esc(pName(p))}</a>
    ${priceBlock(p)}
    ${p.stock <= db.settings().lowStock ? stockNote(p) : ""}
    <div class="swatches">${p.colors.map((k) => `<span class="dot" style="background:${colorHex(k)}" title="${esc(colorName(k))}"></span>`).join("")}</div>
  </div>
</article>`;

  const FREE_KG = 2;
  const parcelKg = (items) => Math.round(items.reduce((s, i) => s + Number(i.weight_kg ?? 0.5) * i.qty, 0) * 100) / 100;
  const weightedFee = (base, kg) => (kg <= FREE_KG ? base : Math.round(base * (kg - 1)));

  const waLink = (text, number) => `https://wa.me/${number || db.settings().whatsapp}?text=${encodeURIComponent(text)}`;

  const cart = {
    items: () => store.get("gt_cart", []).filter((l) => {
      const p = productById(l.id);
      return p && p.visible !== false && p.stock > 0;
    }),
    save(items) {
      store.set("gt_cart", items);
      updateCartCount();
    },
    add(id, color, qty = 1) {
      const p = productById(id);
      if (!p || p.stock <= 0) return;
      const chosen = color || p.colors[0];
      const items = cart.items();
      const line = items.find((l) => l.id === p.id && l.color === chosen);
      if (line) line.qty = Math.min(line.qty + qty, p.stock);
      else items.push({ id: p.id, color: chosen, qty: Math.min(qty, p.stock) });
      cart.save(items);
      toast(t("added"), "/checkout", t("view_cart"), "data-cart-open");
    },
    change(btn) {
      const items = cart.items();
      const i = Number(btn.dataset.dec ?? btn.dataset.inc ?? btn.dataset.remove);
      if (!items[i]) return items;
      if ("dec" in btn.dataset) items[i].qty = Math.max(1, items[i].qty - 1);
      if ("inc" in btn.dataset) items[i].qty = Math.min(productById(items[i].id).stock, items[i].qty + 1);
      if ("remove" in btn.dataset) items.splice(i, 1);
      cart.save(items);
      return items;
    },
    linesHtml: () => cart.items().map((l, i) => {
      const p = productById(l.id);
      return `<div class="line">${media(p, { color: l.color, cls: "" })}<div style="min-width:0"><div class="l-name">${esc(pName(p))}</div><div class="l-meta">${esc(colorName(l.color))} · ${t("each", { p: rs(p.price) })} · ${t("kg", { kg: Number(p.weight_kg || 0.5) })}</div><div class="line-controls"><div class="mini-qty"><button type="button" data-dec="${i}" aria-label="-">&minus;</button><output>${l.qty}</output><button type="button" data-inc="${i}" aria-label="+">+</button></div><button class="text-btn" type="button" data-remove="${i}">${t("remove")}</button></div></div><div class="l-price">${rs(p.price * l.qty)}</div></div>`;
    }).join(""),
    count: () => cart.items().reduce((n, l) => n + l.qty, 0),
    weight: () => parcelKg(cart.items().map((l) => ({ weight_kg: productById(l.id).weight_kg, qty: l.qty }))),
    subtotal: () => cart.items().reduce((n, l) => n + productById(l.id).price * l.qty, 0)
  };

  const cartPanel = {
    el: null,
    paint() {
      const has = cart.items().length > 0;
      cartPanel.el.innerHTML = `<div class="cart-panel-head"><h2>${t("your_cart")}</h2><button class="icon-btn" type="button" data-cart-close aria-label="${esc(t("close"))}">${icon("close")}</button></div>
${has ? `<div class="cart-panel-lines">${cart.linesHtml()}</div>
<div class="cart-panel-foot"><div class="cart-panel-sub"><span>${t("subtotal")}</span><strong>${rs(cart.subtotal())}</strong></div><p class="cart-panel-note">${cart.weight() > FREE_KG ? t("cart_heavy", { kg: cart.weight() }) : t("cart_fee_note")}</p><a class="btn btn-primary" href="/checkout">${t("to_checkout")}</a><button class="text-btn" type="button" data-cart-close>${t("keep_shopping")}</button></div>`
        : `<div class="cart-panel-empty"><h3>${t("cart_empty_t")}</h3><p>${t("cart_empty_d")}</p><a class="btn btn-primary" href="/products">${t("hero_cta")}</a></div>`}`;
      hydrate(cartPanel.el);
    },
    open() {
      if (!cartPanel.el) {
        const el = (cartPanel.el = document.createElement("dialog"));
        el.className = "cart-panel";
        el.setAttribute("aria-label", t("your_cart"));
        document.body.appendChild(el);
        el.addEventListener("click", (e) => {
          if (e.target === el || e.target.closest("[data-cart-close]")) return el.close();
          const btn = e.target.closest("[data-dec],[data-inc],[data-remove]");
          if (btn) { cart.change(btn); cartPanel.paint(); }
        });
      }
      const note = document.querySelector(".toast");
      if (note) note.hidden = true;
      cartPanel.paint();
      if (!cartPanel.el.open) cartPanel.el.showModal();
    }
  };

  let toastTimer;
  const toast = (message, href, linkText, attr = "") => {
    let el = document.querySelector(".toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "toast";
      el.setAttribute("role", "status");
      document.body.appendChild(el);
    }
    el.innerHTML = `<span>${esc(message)}</span>${href ? `<a href="${href}" ${attr}>${esc(linkText)}</a>` : ""}`;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 3000);
  };

  function updateCartCount() {
    const n = cart.count();
    document.querySelectorAll("[data-cart-count]").forEach((el) => {
      el.textContent = n;
      el.hidden = n === 0;
    });
  }

  const nepaliPlaces = { "काठमाडौं": "kathmandu", "काठमाडौँ": "kathmandu", "ललितपुर": "lalitpur", "भक्तपुर": "bhaktapur", "पोखरा": "pokhara", "चितवन": "chitwan", "बुटवल": "butwal", "विराटनगर": "biratnagar", "धरान": "dharan", "वीरगञ्ज": "birgunj", "हेटौंडा": "hetauda", "जनकपुर": "janakpur", "नेपालगञ्ज": "nepalgunj", "धनगढी": "dhangadhi", "इटहरी": "itahari", "कास्की": "kaski", "रुपन्देही": "rupandehi", "झापा": "jhapa", "मोरङ": "morang", "सुनसरी": "sunsari", "काभ्रे": "kavrepalanchok", "बाँके": "banke", "दाङ": "dang", "कैलाली": "kailali" };
  const placeAliases = { "new road": "NEWROAD", "bharatpur": "CHITWAN", "narayangarh": "CHITWAN", "narayangadh": "CHITWAN", "koteshwor": "TINKUNE", "baneshwor": "TINKUNE", "gongabu": "NAYA BUSPARK", "balaju": "NAYA BUSPARK", "boudha": "CHABAHIL", "kirtipur": "KALANKI", "kalimati": "KALANKI", "thamel": "NEWROAD", "asan": "NEWROAD", "patan": "TINKUNE", "lalitpur": "TINKUNE", "bhaktapur": "SURYABINAYAK", "siddharthanagar": "BHAIRAHAWA", "tansen": "PALPA" };
  const normalize = (s) => {
    let v = String(s || "").trim().toLowerCase();
    for (const [ne, en] of Object.entries(nepaliPlaces)) if (v.includes(ne)) v = v.replace(ne, en);
    return v.replace(/\s+/g, " ");
  };

  const searchProducts = (q) => {
    const query = normalize(q);
    if (!query) return { products: [], cats: [] };
    const words = query.split(" ");
    const found = products().map((p) => {
      const cat = categoryById(p.cat);
      const name = `${p.name} ${p.ne_name || ""}`.toLowerCase();
      const hay = [name, cat.en, cat.ne, ...p.colors.map((k) => `${SEED.swatch[k]?.en} ${SEED.swatch[k]?.ne}`), ...p.occasions.map((o) => { const occ = SEED.occasions.find((x) => x.id === o); return occ ? `${occ.en} ${occ.ne}` : o; })].join(" ").toLowerCase();
      let score = 0;
      for (const w of words) {
        if (name.startsWith(w)) score += 4;
        else if (name.includes(w)) score += 3;
        else if (hay.includes(w)) score += 1;
        else if (w.length > 3 && hay.includes(w.slice(0, -1))) score += 0.5;
        else return null;
      }
      return { p, score };
    }).filter(Boolean).sort((a, b) => b.score - a.score || b.p.stock - a.p.stock).map((x) => x.p);
    const cats = shopCategories().filter((c) => c.en.toLowerCase().includes(query) || c.ne.includes(q.trim()) || (query.length > 3 && query.includes(c.en.toLowerCase().slice(0, -1))));
    return { products: found, cats };
  };

  const highlight = (text, q) => {
    const w = normalize(q).split(" ")[0];
    const i = w ? text.toLowerCase().indexOf(w) : -1;
    if (i < 0) return esc(text);
    return `${esc(text.slice(0, i))}<mark>${esc(text.slice(i, i + w.length))}</mark>${esc(text.slice(i + w.length))}`;
  };

  const mountSearch = (root) => {
    const input = root.querySelector("input");
    const panel = root.querySelector(".suggest");
    let active = -1;
    const close = () => { panel.hidden = true; active = -1; input.setAttribute("aria-expanded", "false"); };
    const render = () => {
      const q = input.value;
      if (!q.trim()) return close();
      const { products: found, cats } = searchProducts(q);
      let html = "";
      if (cats.length) {
        html += `<div class="suggest-label">${t("sg_categories")}</div>` + cats.map((c) => {
          const sample = products().find((p) => p.cat === c.id);
          return `<a role="option" href="/products#${c.id}"><span class="thumb">${sample ? media(sample, { cls: "square" }) : ""}</span><span class="s-name">${highlight(catName(c), q)}</span><span class="s-meta">${t("items_n", { n: products().filter((p) => p.cat === c.id).length })}</span></a>`;
        }).join("");
      }
      if (found.length) {
        html += `<div class="suggest-label">${t("sg_products")}</div>` + found.slice(0, 6).map((p) => `<a role="option" href="${productUrl(p)}"><span class="thumb">${media(p, { cls: "square" })}</span><span class="s-name">${highlight(pName(p), q)}</span><span class="s-meta">${rs(p.price)}</span></a>`).join("");
      }
      panel.innerHTML = html || `<div class="suggest-empty">${esc(t("sg_empty", { q: q.trim() }))}</div>`;
      panel.hidden = false;
      input.setAttribute("aria-expanded", "true");
      active = -1;
      hydrate(panel);
    };
    const opts = () => [...panel.querySelectorAll("a[role=option]")];
    input.addEventListener("input", render);
    input.addEventListener("focus", () => input.value.trim() && render());
    input.addEventListener("keydown", (e) => {
      const list = opts();
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        active = e.key === "ArrowDown" ? Math.min(active + 1, list.length - 1) : Math.max(active - 1, -1);
        list.forEach((a, i) => a.setAttribute("aria-selected", String(i === active)));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (active >= 0 && list[active]) location.href = list[active].getAttribute("href");
        else if (input.value.trim()) {
          try { sessionStorage.setItem("gt_q", input.value.trim()); } catch {}
          if (location.pathname === "/products" && location.hash === "#search") location.reload();
          else location.href = "/products#search";
        }
      } else if (e.key === "Escape") close();
    });
    document.addEventListener("click", (e) => !root.contains(e.target) && close());
  };

  const searchMarkup = (id) => `<div class="search" data-search role="search"><span class="search-icon">${icon("search")}</span><input id="${id}" type="search" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="${id}-list" aria-label="${esc(t("search_label"))}" placeholder="${esc(t("search_ph"))}"><div class="suggest" id="${id}-list" role="listbox" hidden></div></div>`;

  function paintThemeButton(btn) {
    const dark = theme.current() === "dark";
    btn.innerHTML = icon(dark ? "sun" : "moon");
    btn.setAttribute("aria-label", t(dark ? "theme_to_light" : "theme_to_dark"));
    btn.title = t(dark ? "theme_to_light" : "theme_to_dark");
  }

  const renderHeader = (active) => {
    const host = document.getElementById("site-header");
    if (!host) return;
    const s = db.settings();
    const links = [["/", "nav_home", "home"], ["/products", "nav_shop", "shop"], ["/about", "nav_about", "about"], ["/help", "nav_help", "help"], ["/contact", "nav_contact", "contact"]];
    const nav = links.map(([href, key, id]) => `<a href="${href}"${id === active ? ' aria-current="page"' : ""}>${t(key)}</a>`).join("");
    const announce = L(s.announce_en, s.announce_ne);
    host.innerHTML = `
${announce ? `<div class="announce"><div class="wrap">${esc(announce)}</div></div>` : ""}
<header class="site-header">
  <div class="wrap header-row">
    <a class="brand" href="/" aria-label="GifToyz"><img class="logo-light" src="logo.png" alt="GifToyz" width="80" height="34"><img class="logo-dark" src="logo-dark.png" alt="GifToyz" width="80" height="34"></a>
    <nav class="main-nav" aria-label="Main">${nav}</nav>
    <div class="header-tools">
      <a class="track-cta" href="/track"${active === "track" ? ' aria-current="page"' : ""}>${icon("truck")}<span class="track-cta-long">${t("track_cta")}</span><span class="track-cta-short" aria-hidden="true">${t("track_cta_short")}</span></a>
      ${searchMarkup("q-desktop")}
      <button class="icon-btn search-btn" type="button" aria-label="${esc(t("search_label"))}" data-menu="search">${icon("search")}</button>
      <button class="lang-btn" type="button" data-lang-toggle aria-label="${esc(t("language"))}">${lang() === "en" ? "नेपाली" : "English"}</button>
      <button class="icon-btn" type="button" data-theme-toggle></button>
      <a class="cart-btn" href="/checkout" aria-label="${esc(t("cart"))}">${icon("cart")}<span class="cart-label" aria-hidden="true">${t("cart")}</span><span class="count-dot" data-cart-count hidden>0</span></a>
      <button class="icon-btn menu-btn" type="button" aria-label="${esc(t("menu"))}" aria-expanded="false" data-menu="menu">${icon("menu")}</button>
    </div>
  </div>
  <div class="mobile-panel" data-open="false">
    <div class="wrap">
      ${searchMarkup("q-mobile")}
      <nav aria-label="Mobile">${nav}<a href="/track">${t("track")}</a></nav>
      <div class="panel-tools"><button class="lang-btn" type="button" data-lang-toggle aria-label="${esc(t("language"))}">${lang() === "en" ? "नेपाली" : "English"}</button><button class="icon-btn" type="button" data-theme-toggle></button></div>
    </div>
  </div>
</header>`;
    host.querySelectorAll("[data-search]").forEach(mountSearch);
    host.querySelectorAll("[data-theme-toggle]").forEach((b) => {
      paintThemeButton(b);
      b.addEventListener("click", theme.toggle);
    });
    host.querySelectorAll("[data-lang-toggle]").forEach((b) => b.addEventListener("click", () => {
      store.set("gt_lang", lang() === "en" ? "ne" : "en");
      location.reload();
    }));
    const panel = host.querySelector(".mobile-panel");
    const menuBtn = host.querySelector(".menu-btn");
    host.querySelectorAll("[data-menu]").forEach((btn) => btn.addEventListener("click", () => {
      const open = panel.dataset.open !== "true";
      panel.dataset.open = String(open);
      menuBtn.setAttribute("aria-expanded", String(open));
      menuBtn.innerHTML = icon(open ? "close" : "menu");
      menuBtn.setAttribute("aria-label", t(open ? "close" : "menu"));
      if (open && btn.dataset.menu === "search") panel.querySelector("input").focus();
    }));
  };

  const renderFooter = () => {
    const host = document.getElementById("site-footer");
    if (!host) return;
    const s = db.settings();
    host.innerHTML = `
<footer class="site-footer">
  <div class="wrap">
    <div class="footer-top">
      <div class="footer-brand">
        <a class="footer-logo" href="/" aria-label="GifToyz"><img class="logo-light" src="logo.png" alt="GifToyz" width="80" height="34"><img class="logo-dark" src="logo-dark.png" alt="GifToyz" width="80" height="34"></a>
        <p>${t("f_blurb")}</p>
      </div>
      <div class="footer-col"><h4>${t("f_shop")}</h4><ul>${shopCategories().map((c) => `<li><a href="/products#${c.id}">${catName(c)}</a></li>`).join("")}</ul></div>
      <div class="footer-col"><h4>${t("f_help")}</h4><ul>
        <li><a href="/help#how-to-order">${t("f_how")}</a></li>
        <li><a href="/help#delivery">${t("f_rates")}</a></li>
        <li><a href="/help#payment">${t("f_pay")}</a></li>
        <li><a href="/track">${t("f_track")}</a></li>
        <li><a href="/help#returns">${t("f_returns")}</a></li>
      </ul></div>
      <div class="footer-col"><h4>${t("f_company")}</h4><ul>
        <li><a href="/about">${t("nav_about")}</a></li>
        <li><a href="/contact">${t("nav_contact")}</a></li>
        <li><a href="https://www.instagram.com/${esc(s.instagram)}/" target="_blank" rel="noopener">Instagram</a></li>
        ${s.tiktok ? `<li><a href="https://www.tiktok.com/@${esc(s.tiktok)}" target="_blank" rel="noopener">TikTok</a></li>` : ""}
        ${s.facebook ? `<li><a href="https://www.facebook.com/${esc(s.facebook)}" target="_blank" rel="noopener">Facebook</a></li>` : ""}
        <li><a href="${waLink("Hi GifToyz")}" target="_blank" rel="noopener">WhatsApp</a></li>
      </ul></div>
    </div>
    <div class="footer-bottom">
      <span>&copy; ${new Date().getFullYear()} GifToyz Nepal</span>
      <div class="pay-tags" aria-label="Payment options"><span>eSewa</span><span>Bank QR</span><span>${t("pay_cod")}</span></div>
      <div class="footer-legal"><a href="/help#privacy">${t("f_privacy")}</a><a href="/help#terms">${t("f_terms")}</a></div>
    </div>
  </div>
</footer>`;
  };

  const searchLocations = (q, limit = 14) => {
    const query = normalize(q);
    if (!query) return [];
    const rates = db.rates();
    const groups = [];
    const seen = new Set();
    const push = (label, rows) => {
      const fresh = rows.filter((r) => r && !seen.has(r.key));
      fresh.forEach((r) => seen.add(r.key));
      if (fresh.length) groups.push({ label, rows: fresh });
    };
    const byDistrict = {};
    rates.forEach((r) => { if (r.district) (byDistrict[r.district.toLowerCase()] ||= []).push(r); });
    for (const [d, rows] of Object.entries(byDistrict)) {
      if (d.startsWith(query) || (query.length > 3 && d.includes(query))) push(t("loc_district", { d: rows[0].district }), rows);
    }
    const alias = Object.entries(placeAliases).filter(([k]) => k.startsWith(query) || (query.length > 3 && query.startsWith(k)));
    if (alias.length) push(t("loc_nearest"), alias.map(([, key]) => rates.find((r) => r.key === key)));
    const starts = rates.filter((r) => r.name.toLowerCase().startsWith(query));
    const contains = rates.filter((r) => !r.name.toLowerCase().startsWith(query) && r.name.toLowerCase().includes(query));
    push(t("loc_places"), [...starts, ...contains]);
    let total = 0;
    return groups.map((g) => {
      const rows = g.rows.slice(0, Math.max(0, limit - total));
      total += rows.length;
      return { ...g, rows };
    }).filter((g) => g.rows.length);
  };

  const mountLocationPicker = ({ input, list, onPick }) => {
    let active = -1;
    let flat = [];
    const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); };
    const render = () => {
      if (!input.value.trim()) return close();
      const groups = searchLocations(input.value);
      flat = groups.flatMap((g) => g.rows);
      if (!flat.length) list.innerHTML = `<div class="loc-empty">${esc(t("loc_none", { q: input.value.trim() }))}</div>`;
      else {
        let i = 0;
        list.innerHTML = groups.map((g) => `<div class="l-group">${esc(g.label)}</div>` + g.rows.map((r) => `<button type="button" role="option" data-i="${i++}" aria-selected="false"><span><span class="l-name">${esc(r.name)}</span><span class="l-dist">${esc(r.district || t("loc_branch_area"))}</span></span><span class="l-price">${t("from_price", { p: rs(r.branch) })}</span></button>`).join("")).join("");
      }
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
      active = -1;
    };
    const pick = (i) => {
      const row = flat[i];
      if (!row) return;
      input.value = row.district ? `${row.name}, ${row.district}` : row.name;
      close();
      onPick(row);
    };
    input.addEventListener("input", () => { render(); onPick(null); });
    input.addEventListener("focus", () => input.value.trim() && render());
    input.addEventListener("keydown", (e) => {
      const opts = [...list.querySelectorAll("button[role=option]")];
      if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(active + 1, opts.length - 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(active - 1, 0); }
      else if (e.key === "Enter") { if (!list.hidden) { e.preventDefault(); pick(active >= 0 ? active : 0); } return; }
      else if (e.key === "Escape") return close();
      else return;
      opts.forEach((o, i) => o.setAttribute("aria-selected", String(i === active)));
      opts[active]?.scrollIntoView({ block: "nearest" });
    });
    list.addEventListener("mousedown", (e) => e.preventDefault());
    list.addEventListener("click", (e) => {
      const btn = e.target.closest("button[role=option]");
      if (btn) pick(Number(btn.dataset.i));
    });
    input.addEventListener("blur", () => setTimeout(close, 120));
  };

  const copyText = async (text, btn) => {
    try {
      await navigator.clipboard.writeText(text);
      if (btn) {
        const prev = btn.textContent;
        btn.textContent = t("copied");
        setTimeout(() => (btn.textContent = prev), 1400);
      }
    } catch {
      const target = btn?.parentElement?.querySelector("code, .c-value");
      if (target) {
        const range = document.createRange();
        range.selectNodeContents(target);
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
  };

  const applyI18n = (root = document) => {
    root.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
    root.querySelectorAll("[data-i18n-ph]").forEach((el) => (el.placeholder = t(el.dataset.i18nPh)));
  };

  const init = (active) => {
    renderHeader(active);
    renderFooter();
    updateCartCount();
    applyI18n();
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-add]");
      if (btn) { e.preventDefault(); cart.add(Number(btn.dataset.add)); }
      if (!location.pathname.startsWith("/checkout") && e.target.closest(".cart-btn, [data-cart-open]")) { e.preventDefault(); cartPanel.open(); }
    });
    hydrate();
  };

  const apiReady = () => !!SERVER || location.protocol === "https:" || /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
  const api = async (path, { method = "GET", body, key } = {}) => {
    if (!apiReady()) throw Object.assign(new Error("The shipping server isn't connected yet."), { status: 0 });
    const headers = { Accept: "application/json" };
    if (body) headers["Content-Type"] = "application/json";
    if (key) headers.Authorization = `Bearer ${key}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 35000);
    try {
      const res = await fetch(path, {
        method, headers, body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal, credentials: "same-origin", referrerPolicy: "no-referrer", cache: "no-store", redirect: "error"
      });
      if (!(res.headers.get("content-type") || "").includes("application/json")) {
        throw Object.assign(new Error("The shipping server isn't running. Start it with server/run.sh."), { status: 0 });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = typeof data.detail === "string" ? data.detail : Array.isArray(data.detail) ? "Some order details are missing or invalid." : `Request failed (${res.status})`;
        throw Object.assign(new Error(detail), { status: res.status });
      }
      return data;
    } catch (err) {
      if (err.name === "AbortError" || err instanceof TypeError) throw Object.assign(new Error("Couldn't reach the shipping server."), { status: 0 });
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };

  window.GT = {
    SEED, store, idb, db, t, L, lang, esc, rs, icon, art, artGroup, colorHex, colorName, catName, occName, pName, pBlurb, pSpecs,
    categories, shopCategories, categoryById, products, allProducts, productById, productUrl, media, imgTag, hydrate, stockNote, priceBlock, badgeFor, productCard,
    cart, parcelKg, weightedFee, FREE_KG, waLink, toast, searchProducts, searchLocations, mountLocationPicker, copyText, applyI18n, init, theme, defaultSettings, api, apiReady,
    productByItemId, server: SERVER
  };
})();
