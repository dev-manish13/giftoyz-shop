(() => {
  const { SEED, store, idb, db, esc, icon, art, media, hydrate, colorHex, theme, defaultSettings } = GT;
  const rs = (n) => `Rs ${Number(n || 0).toLocaleString("en-IN")}`;
  const root = document.getElementById("admin");
  const STATUS = {
    payment_pending: "Check payment",
    received: "New order",
    confirmed: "Confirmed",
    with_ncm: "With NCM",
    in_transit: "On the way",
    delivered: "Delivered",
    cancelled: "Cancelled"
  };
  const WALLET = { esewa: "eSewa", khalti: "Khalti", bank: "Bank QR" };
  const BADGES = { "": "None", best: "Best seller", new: "New", gift: "Gift ready", personal: "Personalised" };
  const pill = (s) => `<span class="pill-s s-${s}">${STATUS[s] || s}</span>`;
  const day = 86400000;
  const fmtDate = (iso) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const fmtTime = (iso) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const unlocked = () => { try { return sessionStorage.getItem("gt_admin") === "1" && (!GT.server || !!sessionStorage.getItem("gt_ncm_key")); } catch { return false; } };
  const ncmKey = () => { try { return sessionStorage.getItem("gt_ncm_key") || ""; } catch { return ""; } };
  const ncmLive = () => GT.apiReady() && !!ncmKey();
  const SERVER_FIELDS = ["itemId", "id", "slug", "name", "ne_name", "cat", "art", "price", "compare", "stock", "colors", "badge", "occasions", "blurb", "ne_blurb", "specs", "ne_specs", "images", "weight_kg", "visible"];
  const toServer = (p) => {
    const out = Object.fromEntries(SERVER_FIELDS.filter((k) => p[k] !== undefined).map((k) => [k, p[k]]));
    out.images = (p.images || []).filter((img) => img.src);
    out.price = p.price > 0 ? p.price : null;
    out.visible = !!p.visible && out.price !== null;
    return out;
  };
  const pushProduct = async (p) => {
    if (!p.itemId || !ncmLive()) return;
    try { await GT.api(`/api/admin/products/${encodeURIComponent(p.itemId)}`, { method: "PUT", key: ncmKey(), body: toServer(p) }); }
    catch (e) {
      toast(`Not saved on the shop server: ${e.message}`);
      synced = false;
      syncServer();
    }
  };
  const saveProducts = (list, changed = []) => { db.saveProducts(list); changed.forEach(pushProduct); };
  const catCode = (id) => (SEED.categories.find((c) => c.id === id) || {}).code || id.slice(0, 3).toUpperCase();
  const slugify = (text) => text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "product";
  const assignServerIds = (p, others) => {
    const code = catCode(p.cat);
    const used = others.map((x) => x.itemId).filter((x) => x && x.startsWith(`GFT-${code}-`)).map((x) => Number(x.slice(8)));
    p.itemId = `GFT-${code}-${String(Math.max(0, ...used) + 1).padStart(3, "0")}`;
    const base = slugify(p.name);
    let slug = base, n = 2;
    while (others.some((x) => x.slug === slug)) slug = `${base}-${n++}`;
    p.slug = slug;
    if (others.some((x) => x.id === p.id) || p.id < 1000) p.id = Math.max(1000, ...others.map((x) => x.id)) + 1;
    p.weight_kg = p.weight_kg || 0.5;
  };
  const uploadPhoto = async (file, alt) => {
    const res = await fetch(`/api/admin/media?alt=${encodeURIComponent(alt)}`, { method: "POST", body: file, headers: { Authorization: `Bearer ${ncmKey()}`, "Content-Type": "application/octet-stream" }, credentials: "same-origin" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : `Upload failed (${res.status})`);
    return data.image;
  };
  const SETTING_KEYS = ["phone", "whatsapp", "instagram", "tiktok", "facebook", "email", "hours_en", "hours_ne", "orders_paused", "pause_en", "pause_ne", "announce_en", "announce_ne", "codAdvance", "lowStock", "happy_customers", "qr", "qr_info", "banners", "banners_enabled", "banner_seconds", "hero", "bills_enabled"];
  const pushSettings = async (next) => {
    const body = Object.fromEntries(SETTING_KEYS.map((k) => [k, next[k]]));
    body.qr = Object.fromEntries(Object.entries(next.qr || {}).map(([k, v]) => [k, typeof v === "string" && v.startsWith("/media/") ? v : null]));
    const r = await GT.api("/api/admin/settings", { method: "PUT", key: ncmKey(), body });
    db.saveSettings({ ...db.settings(), ...r.settings });
  };
  const replaceOrder = (o) => db.saveOrders(db.orders().map((x) => (x.id === o.id ? { ...x, ...o } : x)));
  let synced = false;
  let syncedAt = 0;
  const syncServer = async () => {
    if (synced || !ncmLive()) return;
    synced = true;
    syncedAt = Date.now();
    try {
      const [{ products }, { orders }, { settings }] = await Promise.all([
        GT.api("/api/admin/products", { key: ncmKey() }),
        GT.api("/api/admin/orders", { key: ncmKey() }),
        GT.api("/api/admin/settings", { key: ncmKey() })
      ]);
      db.saveSettings({ ...db.settings(), ...settings });
      const pending = db.products().filter((p) => !p.itemId && !SEED.products.some((s) => s.id === p.id));
      const moved = [];
      for (const local of pending) {
        try {
          const p = JSON.parse(JSON.stringify(local));
          const images = [];
          for (const img of p.images || []) {
            if (img.src) { images.push(img); continue; }
            const blob = img.id ? await idb.get(img.id) : null;
            if (blob) images.push({ ...(await uploadPhoto(blob, p.name || "Product photo")), focal: img.focal || { x: 50, y: 50 }, fit: img.fit || "cover", color: img.color || "" });
          }
          p.images = images;
          assignServerIds(p, [...products, ...moved]);
          const r = await GT.api(`/api/admin/products/${encodeURIComponent(p.itemId)}`, { method: "PUT", key: ncmKey(), body: toServer(p) });
          moved.push(r.product);
        } catch (e) {
          toast(`Couldn't move ${local.name || "a product"} to the server: ${e.message}`);
        }
      }
      if (moved.length) toast(`Moved ${moved.length} product${moved.length > 1 ? "s" : ""} from this browser to the shop server`);
      db.saveProducts([...products, ...moved]);
      const ids = new Set(orders.map((o) => o.id));
      db.saveOrders([...orders, ...db.orders().filter((o) => !ids.has(o.id) && !o.server && !o.sample)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      const busy = document.querySelector(".drawer") || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
      if (!busy) render();
    } catch (e) {
      synced = false;
      if (e.status === 401) { try { sessionStorage.removeItem("gt_ncm_key"); } catch {} render(); return; }
      toast(`Couldn't load from the shop server: ${e.message}`);
    }
  };
  const serverAction = async (o, path, body) => {
    const r = await GT.api(`/api/admin/orders/${encodeURIComponent(o.id)}/${path}`, { method: "POST", key: ncmKey(), body });
    replaceOrder(r.order);
    GT.api("/api/admin/products", { key: ncmKey() }).then(({ products }) => db.saveProducts(products)).catch(() => {});
    return r;
  };
  const ncmTimeline = (n) => {
    if (!n || !Array.isArray(n.timeline) || !n.timeline.length) return "";
    return `${n.branch ? `<p class="small" style="margin:12px 0 0">Branch: <strong>${esc(n.branch)}</strong>${n.branch_phone ? ` · <a href="tel:${esc(String(n.branch_phone).replace(/[^0-9+]/g, ""))}">${esc(n.branch_phone)}</a>` : ""}${n.trackid ? ` · NCM tracking ID <span class="mono">${esc(n.trackid)}</span>` : ""}</p>` : ""}
      <ol class="timeline" style="margin-top:12px">${n.timeline.map((x, i) => `<li class="${i === 0 ? "now" : "done"}"><span class="t-dot">${icon(i === 0 ? "truck" : "check")}</span><div><div class="t-title">${esc(x.status || "")}</div><div class="t-sub">${esc(x.at || "")}</div></div></li>`).join("")}</ol>
      ${n.checked ? `<p class="muted small">Updated automatically every 15 minutes. Last check ${fmtTime(n.checked)}.</p>` : ""}`;
  };
  const shipmentBody = (o) => ({
    ref: o.id,
    name: String(o.name || "").slice(0, 80),
    phone: o.phone,
    phone2: o.phone2 || "",
    address: String(o.address || "").slice(0, 200),
    branch: o.location.key,
    delivery: o.location.type === "home" ? "home" : "branch",
    cod_charge: Math.max(0, Math.round(o.payment.due || 0)),
    package: o.items.map((i) => `${i.qty} x ${i.name}`).join(", ").slice(0, 120),
    instruction: o.gift?.hideSlip ? "Gift parcel. No price slip inside." : ""
  });

  let toastTimer;
  const toast = (msg) => {
    let el = document.querySelector(".toast");
    if (!el) { el = document.createElement("div"); el.className = "toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
    el.innerHTML = `<span>${esc(msg)}</span>`;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 2400);
  };

  const seedSampleOrders = () => {
    if (store.get("gt_sample_done", false)) return;
    const names = ["Sita Sharma", "Ram Thapa", "Anisha Gurung", "Bikash Shrestha", "Pooja Rai", "Suman Karki", "Nisha Magar", "Aayush Adhikari", "Priya Tamang", "Rohan KC", "Srijana Poudel", "Kiran Bhandari", "Asmita Limbu", "Nabin Basnet", "Rabina Khadka"];
    const rates = db.rates();
    const popular = ["TINKUNE", "NEWROAD", "KALANKI", "CHABAHIL", "NAYA BUSPARK", "POKHARA", "BUTWAL", "CHITWAN", "BIRATNAGAR", "DHARAN", "ITAHARI", "HETAUDA", "BHAIRAHAWA", "BIRTAMOD", "NEPALGUNJ", "BANEPA"];
    const prods = db.products().filter((p) => p.price);
    let seed = 7;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    const pickOne = (arr) => arr[Math.floor(rnd() * arr.length)];
    const orders = [];
    for (let i = 0; i < 46; i++) {
      const ageDays = Math.floor(rnd() * 28);
      const created = new Date(Date.now() - ageDays * day - Math.floor(rnd() * 10) * 3600000);
      const loc = rates.find((r) => r.key === pickOne(popular)) || rates[0];
      const type = rnd() < 0.7 ? "home" : "branch";
      const fee = type === "home" ? loc.home : loc.branch;
      const items = [];
      const n = rnd() < 0.75 ? 1 : 2;
      for (let k = 0; k < n; k++) {
        const p = pickOne(prods);
        items.push({ id: p.id, name: p.name, color: pickOne(p.colors), qty: rnd() < 0.85 ? 1 : 2, price: p.price });
      }
      const subtotal = items.reduce((s, it) => s + it.price * it.qty, 0);
      const total = subtotal + fee;
      const mode = rnd() < 0.62 ? "cod" : "full";
      const paidNow = mode === "full" ? total : fee;
      let status;
      if (ageDays > 6) status = rnd() < 0.9 ? "delivered" : "cancelled";
      else if (ageDays > 3) status = pickOne(["delivered", "in_transit", "with_ncm"]);
      else if (ageDays > 1) status = pickOne(["with_ncm", "confirmed", "in_transit"]);
      else status = pickOne(["payment_pending", "payment_pending", "confirmed"]);
      const d = created;
      const id = `GT-${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${1000 + Math.floor(rnd() * 9000)}`;
      orders.push({
        id, sample: true, createdAt: d.toISOString(), name: pickOne(names), phone: `98${String(10000000 + Math.floor(rnd() * 89999999))}`, phone2: "",
        location: { key: loc.key, name: loc.name, district: loc.district, type, fee }, address: "Sample address, near the main chowk",
        gift: rnd() < 0.4 ? { note: "Happy birthday! Love you.", hideSlip: true } : null,
        payment: { mode, wallet: pickOne(["esewa", "khalti", "bank"]), txn: `TX${100000 + Math.floor(rnd() * 899999)}`, paidNow, due: total - paidNow, screenshot: null, verified: status !== "payment_pending" },
        items, subtotal, total, status,
        ncm: ["with_ncm", "in_transit", "delivered"].includes(status) ? { id: String(4000000 + Math.floor(rnd() * 999999)), at: d.toISOString() } : null,
        history: [{ at: d.toISOString(), status: "payment_pending" }, ...(status !== "payment_pending" ? [{ at: new Date(d.getTime() + 3600000).toISOString(), status }] : [])]
      });
    }
    orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    db.saveOrders([...db.orders(), ...orders]);
    store.set("gt_sample_done", true);
  };

  const route = () => {
    const h = location.hash.slice(1);
    return ["overview", "orders", "products", "catalog", "banners", "rates", "reviews", "setup"].includes(h) ? h : "overview";
  };

  const renderServerLock = () => {
    root.innerHTML = `
<div class="lock">
  <form class="lock-card" id="lock">
    <picture><img class="logo-light" src="logo.png" alt="GifToyz"></picture>
    <h1>Shop admin</h1>
    <p class="muted small">Sign in with your admin key to manage orders, products and delivery rates.</p>
    <input class="input" id="key" type="password" autocomplete="current-password" spellcheck="false" aria-label="Admin key" placeholder="Admin key" style="font-family:var(--mono)">
    <p class="error small" id="key-err" style="color:var(--danger)" hidden></p>
    <button class="btn btn-primary btn-block" type="submit" id="key-btn">Sign in</button>
    <p class="muted small">The key is kept only until you close this browser or lock the admin.</p>
    <a class="text-link" href="/" style="justify-self:center">Back to the shop</a>
  </form>
</div>`;
    const input = document.getElementById("key");
    const errEl = document.getElementById("key-err");
    const btn = document.getElementById("key-btn");
    input.focus();
    document.getElementById("lock").addEventListener("submit", async (e) => {
      e.preventDefault();
      const key = input.value.trim();
      errEl.hidden = true;
      if (key.length < 32) { errEl.textContent = "The admin key is at least 32 characters."; errEl.hidden = false; return; }
      btn.disabled = true;
      try {
        await GT.api("/api/admin/products", { key });
        try { sessionStorage.setItem("gt_ncm_key", key); sessionStorage.setItem("gt_admin", "1"); } catch {}
        synced = false;
        render();
      } catch (err) {
        errEl.textContent = err.status === 401 ? "That key isn't right. Try again." : err.message;
        errEl.hidden = false;
        btn.disabled = false;
        input.select();
      }
    });
  };

  const renderLock = () => {
    if (GT.server) return renderServerLock();
    root.innerHTML = `
<div class="lock">
  <form class="lock-card" id="lock">
    <picture><img class="logo-light" src="logo.png" alt="GifToyz"></picture>
    <h1>Shop admin</h1>
    <p class="muted small">Enter your PIN to manage orders, products and delivery rates.</p>
    <input class="input" id="pin" inputmode="numeric" maxlength="8" autocomplete="off" aria-label="PIN" placeholder="••••">
    <p class="error small" id="pin-err" style="color:var(--danger)" hidden>That PIN isn't right. Try again.</p>
    <button class="btn btn-primary btn-block" type="submit">Unlock</button>
    <p class="muted small">Preview PIN is 1234. Change it in Setup. The live admin uses a proper login with two-step verification.</p>
    <a class="text-link" href="/" style="justify-self:center">Back to the shop</a>
  </form>
</div>`;
    document.getElementById("pin").focus();
    document.getElementById("lock").addEventListener("submit", (e) => {
      e.preventDefault();
      if (document.getElementById("pin").value === db.settings().pin) {
        try { sessionStorage.setItem("gt_admin", "1"); } catch {}
        render();
      } else {
        document.getElementById("pin-err").hidden = false;
        document.getElementById("pin").select();
      }
    });
  };

  const shell = (active, content) => {
    const pending = db.orders().filter((o) => o.status === "payment_pending" || o.status === "received").length;
    const links = [["overview", "Overview", "tag"], ["orders", "Orders", "box"], ["products", "Products", "gift"], ["catalog", "Catalog setup", "layers"], ["banners", "Banners", "image"], ["rates", "Delivery rates", "truck"], ["reviews", "Reviews", "star"], ["setup", "Setup", "shield"]];
    root.innerHTML = `
<div class="admin">
  <aside class="side">
    <a class="brand" href="#overview"><img class="logo-light" src="logo.png" alt="GifToyz"><img class="logo-dark" src="logo-dark.png" alt="GifToyz" style="display:none"><span>Admin</span></a>
    <nav aria-label="Admin">${links.map(([id, label, ic]) => `<a href="#${id}" ${id === active ? 'aria-current="page"' : ""}>${icon(ic)}<span>${label}</span>${id === "orders" && pending ? `<span class="badge">${pending}</span>` : ""}</a>`).join("")}</nav>
    <div class="side-foot">
      <button type="button" data-theme-toggle>${icon(theme.current() === "dark" ? "sun" : "moon")}<span>${theme.current() === "dark" ? "Light mode" : "Dark mode"}</span></button>
      <a href="/" target="_blank" rel="noopener">${icon("bag")}<span>View shop</span></a>
      <button type="button" id="lock-btn">${icon("user")}<span>Lock admin</span></button>
    </div>
  </aside>
  <main class="main" id="view">${content}</main>
</div>`;
    const dark = theme.current() === "dark";
    root.querySelector(".side .logo-light").style.display = dark ? "none" : "";
    root.querySelector(".side .logo-dark").style.display = dark ? "" : "none";
    root.querySelector("[data-theme-toggle]").addEventListener("click", () => { theme.toggle(); render(); });
    root.querySelector("#lock-btn").addEventListener("click", () => { try { sessionStorage.removeItem("gt_admin"); sessionStorage.removeItem("gt_ncm_key"); } catch {} render(); });
    hydrate(root);
  };

  const sampleBanner = () => db.orders().some((o) => o.sample)
    ? `<div class="banner"><span><strong>Showing sample orders.</strong> They're here so you can see how the dashboard works. Real orders from the shop appear alongside them.</span><button class="btn btn-secondary btn-sm" type="button" id="drop-sample">Remove sample orders</button></div>` : "";
  const bindSampleBanner = () => document.getElementById("drop-sample")?.addEventListener("click", () => { db.saveOrders(db.orders().filter((o) => !o.sample)); toast("Sample orders removed"); render(); });

  const barChart = (series) => {
    const W = 640, H = 220, pad = { l: 44, r: 8, t: 10, b: 26 };
    const max = Math.max(1000, ...series.map((d) => d.value));
    const step = Math.pow(10, Math.floor(Math.log10(max))) / 2;
    const top = Math.ceil(max / step) * step;
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const bw = iw / series.length;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => top * f);
    const fmt = (v) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(Math.round(v)));
    const labelEvery = Math.ceil(series.length / 8);
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Revenue by day">
      ${ticks.map((v) => { const y = pad.t + ih - (v / top) * ih; return `<line class="grid-line" x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}"/><text x="${pad.l - 8}" y="${y + 4}" text-anchor="end">${fmt(v)}</text>`; }).join("")}
      ${series.map((d, i) => { const h = Math.max(d.value ? 2 : 0, (d.value / top) * ih); const x = pad.l + i * bw + bw * 0.18; return `<rect class="bar" x="${x}" y="${pad.t + ih - h}" width="${bw * 0.64}" height="${h}" rx="3"><title>${d.full}: ${rs(d.value)} from ${d.count} orders</title></rect>${i % labelEvery === 0 ? `<text x="${x + bw * 0.32}" y="${H - 6}" text-anchor="middle">${d.label}</text>` : ""}`; }).join("")}
    </svg>`;
  };
  const hbars = (rows, accent) => {
    const max = Math.max(1, ...rows.map((r) => r.value));
    return rows.length ? `<div class="hbars">${rows.map((r) => `<div class="hbar"><span class="h-label">${esc(r.label)}</span><span class="h-val">${r.display ?? r.value}</span><div class="h-track"><div class="h-fill ${accent ? "accent" : ""}" style="width:${(r.value / max) * 100}%"></div></div></div>`).join("")}</div>` : `<p class="muted small">No data yet.</p>`;
  };

  const renderOverview = () => {
    const range = store.get("gt_admin_range", 14);
    const since = Date.now() - range * day;
    const all = db.orders();
    const inRange = all.filter((o) => new Date(o.createdAt).getTime() >= since);
    const live = inRange.filter((o) => o.status !== "cancelled");
    const revenue = live.reduce((s, o) => s + o.total, 0);
    const prevSince = since - range * day;
    const prevRevenue = all.filter((o) => { const t = new Date(o.createdAt).getTime(); return t >= prevSince && t < since && o.status !== "cancelled"; }).reduce((s, o) => s + o.total, 0);
    const change = prevRevenue ? Math.round(((revenue - prevRevenue) / prevRevenue) * 100) : null;
    const needs = all.filter((o) => ["payment_pending", "received", "confirmed"].includes(o.status));
    const series = Array.from({ length: range }, (_, i) => {
      const d = new Date(Date.now() - (range - 1 - i) * day);
      const key = d.toDateString();
      const os = live.filter((o) => new Date(o.createdAt).toDateString() === key);
      return { label: d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }), full: d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }), value: os.reduce((s, o) => s + o.total, 0), count: os.length };
    });
    const statusRows = Object.keys(STATUS).map((s) => ({ label: STATUS[s], value: inRange.filter((o) => o.status === s).length })).filter((r) => r.value);
    const prodQty = {};
    live.forEach((o) => o.items.forEach((it) => { prodQty[it.name] = (prodQty[it.name] || 0) + it.qty; }));
    const topProducts = Object.entries(prodQty).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, value]) => ({ label, value, display: `${value} sold` }));
    const areas = {};
    live.forEach((o) => { const k = o.location.district || o.location.name; areas[k] = (areas[k] || 0) + 1; });
    const topAreas = Object.entries(areas).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, value]) => ({ label, value, display: `${value} ${value === 1 ? "order" : "orders"}` }));
    const low = db.products().filter((p) => p.visible !== false && p.stock <= db.settings().lowStock).sort((a, b) => a.stock - b.stock);
    const advance = live.reduce((s, o) => s + o.payment.paidNow, 0);
    const codDue = live.filter((o) => o.status !== "delivered").reduce((s, o) => s + o.payment.due, 0);
    const todayKey = new Date().toDateString();
    const today = all.filter((o) => o.status !== "cancelled" && new Date(o.createdAt).toDateString() === todayKey);
    const toShip = all.filter((o) => o.status === "confirmed");
    const withNcm = all.filter((o) => o.status === "with_ncm" || o.status === "in_transit");
    const deliveredInRange = inRange.filter((o) => o.status === "delivered");
    const deliveryDays = deliveredInRange.map((o) => {
      const done = (o.history || []).find((h) => h.status === "delivered");
      return done ? (new Date(done.at) - new Date(o.createdAt)) / day : null;
    }).filter((d) => d !== null && d >= 0);
    const avgDays = deliveryDays.length ? (deliveryDays.reduce((a, b) => a + b, 0) / deliveryDays.length).toFixed(1) : null;
    const payWay = (o) => (o.payment.paidNow <= 0 ? "Cash on delivery only" : o.payment.gateway === "khalti" ? "Khalti (online)" : WALLET[o.payment.wallet] || "Other");
    const payRows = Object.entries(live.reduce((m, o) => ((m[payWay(o)] = (m[payWay(o)] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value, display: `${value}` }));
    const typeRows = [["Home delivery", "home"], ["Branch pickup", "branch"]].map(([label, k]) => ({ label, value: live.filter((o) => o.location.type === k).length })).filter((r) => r.value);
    const phones = live.reduce((m, o) => ((m[o.phone] = (m[o.phone] || 0) + 1), m), {});
    const customers = Object.keys(phones).length;
    const repeat = Object.values(phones).filter((n) => n > 1).length;
    const prods = db.products();
    const onShop = prods.filter((p) => p.visible !== false && p.price > 0);
    const drafts = prods.filter((p) => p.visible === false || !(p.price > 0));
    const outOfStock = onShop.filter((p) => p.stock <= 0);
    const stockValue = onShop.reduce((s, p) => s + (p.price || 0) * Math.max(0, p.stock || 0), 0);
    const cancelRate = inRange.length ? Math.round(((inRange.length - live.length) / inRange.length) * 100) : 0;

    shell("overview", `
<div class="main-head">
  <div><h1>Overview</h1><p>How the shop is doing.</p></div>
  <div class="head-tools"><div class="seg" role="group" aria-label="Range">${[7, 14, 30].map((r) => `<button type="button" data-range="${r}" aria-pressed="${r === range}">${r} days</button>`).join("")}</div><button class="btn btn-secondary btn-sm" type="button" id="export-csv">${icon("download")}<span>Export CSV</span></button></div>
</div>
${sampleBanner()}
<div class="today-strip">
  <div><span>Today</span><strong>${today.length} ${today.length === 1 ? "order" : "orders"}</strong><em>${rs(today.reduce((s, o) => s + o.total, 0))}</em></div>
  <a href="#orders"><span>Ready to ship</span><strong>${toShip.length}</strong><em>Confirmed, not yet with NCM</em></a>
  <a href="#orders"><span>With NCM now</span><strong>${withNcm.length}</strong><em>Status updates every 15 min</em></a>
  <div><span>Cash still to collect</span><strong>${rs(codDue)}</strong><em>NCM riders collect on delivery</em></div>
</div>
<div class="kpis">
  <div class="kpi"><span class="k-label">${icon("tag")}Revenue</span><span class="k-value">${rs(revenue)}</span><span class="k-sub">${change === null ? `Last ${range} days` : `${change >= 0 ? "Up" : "Down"} ${Math.abs(change)}% on the ${range} days before`}</span></div>
  <div class="kpi"><span class="k-label">${icon("box")}Orders</span><span class="k-value">${live.length}</span><span class="k-sub">${inRange.length - live.length} cancelled</span></div>
  <div class="kpi"><span class="k-label">${icon("bag")}Average order</span><span class="k-value">${rs(live.length ? Math.round(revenue / live.length) : 0)}</span><span class="k-sub">Including delivery</span></div>
  <a class="kpi ${needs.length ? "attention" : ""}" href="#orders"><span class="k-label">${icon("info")}Needs your action</span><span class="k-value">${needs.length}</span><span class="k-sub">Payments to check or parcels to send</span></a>
</div>
<div class="two">
  <section class="panel chart"><div class="panel-head"><h2>Revenue by day</h2><span class="muted">${rs(advance)} collected online, ${rs(codDue)} still due as cash</span></div>${barChart(series)}</section>
  <section class="panel"><div class="panel-head"><h2>Orders by status</h2></div>${hbars(statusRows)}</section>
</div>
<div class="three">
  <section class="panel"><div class="panel-head"><h2>Best sellers</h2></div>${hbars(topProducts, true)}</section>
  <section class="panel"><div class="panel-head"><h2>Top delivery areas</h2></div>${hbars(topAreas)}</section>
  <section class="panel"><div class="panel-head"><h2>Low stock</h2><a class="text-link small" href="#products">Products</a></div>${low.length ? `<div class="hbars">${low.slice(0, 6).map((p) => `<div class="hbar"><span class="h-label">${esc(p.name)}</span><span class="h-val" style="color:${p.stock ? "var(--warn)" : "var(--danger)"}">${p.stock ? `${p.stock} left` : "Sold out"}</span></div>`).join("")}</div>` : `<p class="muted small">Everything is well stocked.</p>`}</section>
</div>
<div class="three">
  <section class="panel"><div class="panel-head"><h2>Delivery</h2></div>
    <dl class="stat-list"><dt>Delivered in ${range} days</dt><dd>${deliveredInRange.length}</dd><dt>Average days to deliver</dt><dd>${avgDays === null ? "Not enough data" : `${avgDays} days`}</dd><dt>Cancelled</dt><dd>${cancelRate}% of orders</dd></dl>
    ${typeRows.length ? hbars(typeRows) : ""}
  </section>
  <section class="panel"><div class="panel-head"><h2>How customers pay</h2></div>${payRows.length ? hbars(payRows) : '<p class="muted small">No orders in this period.</p>'}</section>
  <section class="panel"><div class="panel-head"><h2>Customers and stock</h2><a class="text-link small" href="#products">Products</a></div>
    <dl class="stat-list"><dt>Customers</dt><dd>${customers}</dd><dt>Ordered more than once</dt><dd>${repeat}${customers ? ` (${Math.round((repeat / customers) * 100)}%)` : ""}</dd><dt>Products on the shop</dt><dd>${onShop.length}</dd><dt>Hidden or without a price</dt><dd>${drafts.length ? `<a class="text-link" href="#products">${drafts.length}</a>` : "0"}</dd><dt>Sold out</dt><dd>${outOfStock.length}</dd><dt>Stock value</dt><dd>${rs(stockValue)}</dd></dl>
  </section>
</div>
<section class="panel" style="padding:0;overflow:hidden">
  <div class="panel-head" style="padding:20px 22px 4px"><h2>Latest orders</h2><a class="text-link small" href="#orders">All orders</a></div>
  ${orderTable(all.slice(0, 6))}
</section>`);
    document.querySelectorAll("[data-range]").forEach((b) => b.addEventListener("click", () => { store.set("gt_admin_range", Number(b.dataset.range)); renderOverview(); }));
    document.getElementById("export-csv")?.addEventListener("click", () => {
      const cell = (v) => { const t = String(v ?? ""); return /^[=+\-@]/.test(t) ? `"'${t.replace(/"/g, '""')}"` : `"${t.replace(/"/g, '""')}"`; };
      const head = ["Order", "Date", "Status", "Customer", "Phone", "Place", "District", "Delivery", "Items", "Subtotal", "Delivery fee", "Total", "Paid now", "Cash due", "Payment", "NCM number"];
      const rows = inRange.map((o) => [o.id, new Date(o.createdAt).toISOString().slice(0, 16).replace("T", " "), STATUS[o.status] || o.status, o.name, o.phone, o.location.name, o.location.district, o.location.type === "home" ? "Home" : "Branch", o.items.map((i) => `${i.qty} x ${i.name}`).join("; "), o.subtotal, o.location.fee, o.total, o.payment.paidNow, o.payment.due, payWay(o), o.ncm ? o.ncm.id : ""]);
      const csv = [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
      a.download = `giftoyz-orders-last-${range}-days.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
    bindSampleBanner();
    bindOrderRows();
  };

  const orderTable = (list) => list.length ? `<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Order</th><th>Customer</th><th>Deliver to</th><th class="r">Total</th><th class="r">Paid now</th><th class="r">Cash due</th><th>Status</th><th>Placed</th></tr></thead><tbody>
    ${list.map((o) => `<tr class="click" data-order="${esc(o.id)}" tabindex="0"><td class="mono">${esc(o.id)}${o.sample ? '<span class="tag">Sample</span>' : ""}</td><td>${esc(o.name)}<div class="sub">${esc(o.phone)}</div></td><td>${esc(o.location.name)}<div class="sub">${o.location.type === "home" ? "Home" : "Branch"} · ${esc(o.location.district || "")}</div></td><td class="r">${rs(o.total)}</td><td class="r">${o.payment.paidNow ? rs(o.payment.paidNow) : "—"}</td><td class="r">${o.payment.due ? rs(o.payment.due) : "—"}</td><td>${pill(o.status)}</td><td class="sub">${fmtDate(o.createdAt)}</td></tr>`).join("")}
  </tbody></table></div>` : `<div class="empty" style="margin:16px"><h3>No orders here</h3><p>Orders placed on the shop show up here straight away.</p></div>`;

  const bindOrderRows = () => {
    document.querySelectorAll("tr[data-order]").forEach((tr) => {
      const open = () => openOrder(tr.dataset.order);
      tr.addEventListener("click", open);
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); });
    });
  };

  const renderOrders = () => {
    const f = store.get("gt_admin_filter", "action");
    const q = (document.getElementById("o-q")?.value || "").trim().toLowerCase();
    const all = db.orders();
    const groups = {
      action: { label: "Needs action", test: (o) => ["payment_pending", "received", "confirmed"].includes(o.status) },
      payment_pending: { label: "Check payment", test: (o) => o.status === "payment_pending" || o.status === "received" },
      confirmed: { label: "To send", test: (o) => o.status === "confirmed" },
      shipping: { label: "With NCM", test: (o) => o.status === "with_ncm" || o.status === "in_transit" },
      delivered: { label: "Delivered", test: (o) => o.status === "delivered" },
      cancelled: { label: "Cancelled", test: (o) => o.status === "cancelled" },
      all: { label: "All", test: () => true }
    };
    const list = all.filter(groups[f].test).filter((o) => !q || [o.id, o.name, o.phone, o.location.name, o.location.district].join(" ").toLowerCase().includes(q));
    shell("orders", `
<div class="main-head">
  <div><h1>Orders</h1><p>Check payments, send parcels to NCM and mark deliveries.</p></div>
  <div class="head-tools"><input class="input" id="o-q" type="search" placeholder="Search name, phone or order" style="width:260px;height:40px" value="${esc(q)}"></div>
</div>
${sampleBanner()}
<div class="tabs" role="tablist">${Object.entries(groups).map(([k, g]) => { const n = all.filter(g.test).length; return `<button type="button" role="tab" data-filter="${k}" aria-selected="${k === f}">${g.label}<span class="n ${k === "action" && n ? "hot" : ""}">${n}</span></button>`; }).join("")}</div>
<div class="tbl-wrap">${orderTable(list)}</div>`);
    document.querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", () => { store.set("gt_admin_filter", b.dataset.filter); renderOrders(); }));
    const input = document.getElementById("o-q");
    input.addEventListener("input", () => { const pos = input.selectionStart; renderOrders(); const again = document.getElementById("o-q"); again.focus(); again.setSelectionRange(pos, pos); });
    bindSampleBanner();
    bindOrderRows();
  };

  const drawer = (title, body, foot) => {
    closeDrawer();
    const wrap = document.createElement("div");
    wrap.id = "drawer";
    wrap.innerHTML = `<div class="drawer-back" data-close></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="drawer-head"><h2>${title}</h2><button class="icon-btn" type="button" data-close aria-label="Close">${icon("close")}</button></div><div class="drawer-body">${body}</div>${foot ? `<div class="drawer-foot">${foot}</div>` : ""}</aside>`;
    document.body.appendChild(wrap);
    wrap.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", closeDrawer));
    document.addEventListener("keydown", escClose);
    hydrate(wrap);
    return wrap;
  };
  const escClose = (e) => { if (e.key === "Escape") closeDrawer(); };
  const closeDrawer = () => { document.getElementById("drawer")?.remove(); document.removeEventListener("keydown", escClose); };

  const adjustStock = (order, sign) => {
    const prods = db.products();
    if (order.server) return;
    order.items.forEach((it) => { const p = prods.find((x) => x.id === it.id); if (p) p.stock = Math.max(0, p.stock + sign * it.qty); });
    db.saveProducts(prods);
  };

  const setStatus = (id, status, extra = {}) => {
    const orders = db.orders();
    const o = orders.find((x) => x.id === id);
    if (!o) return;
    const before = o.status;
    const counted = (s) => ["confirmed", "with_ncm", "in_transit", "delivered"].includes(s);
    if (!counted(before) && counted(status)) adjustStock(o, -1);
    if (counted(before) && status === "cancelled") adjustStock(o, 1);
    o.status = status;
    Object.assign(o, extra);
    if (status === "confirmed") o.payment.verified = true;
    (o.history ||= []).push({ at: new Date().toISOString(), status });
    db.saveOrders(orders);
  };

  const ncmText = (o) => [
    `Receiver: ${o.name}`, `Phone: ${o.phone}${o.phone2 ? ", " + o.phone2 : ""}`, `Destination: ${o.location.name}${o.location.district ? " (" + o.location.district + ")" : ""}`,
    `Delivery: ${o.location.type === "home" ? "Home delivery" : "Branch pickup"}`, `Address: ${o.address}`, `COD amount: ${o.payment.due}`,
    `Items: ${o.items.map((i) => `${i.qty} x ${i.name}`).join(", ")}`, `Reference: ${o.id}`
  ].join("\n");

  const openOrder = async (id) => {
    const o = db.orders().find((x) => x.id === id);
    if (!o) return;
    const shot = o.payment.screenshot ? await idb.get(o.payment.screenshot) : null;
    const actions = [];
    if (o.status === "payment_pending") actions.push(`<button class="btn btn-primary" data-act="confirmed">Payment received</button>`);
    if (o.status === "received") actions.push(`<button class="btn btn-primary" data-act="confirmed">Confirm order</button>`);
    if (o.status === "confirmed") actions.push(`<button class="btn btn-primary" data-act="with_ncm">Create NCM shipment</button>`);
    if (o.status === "with_ncm") actions.push(`<button class="btn btn-secondary" data-act="in_transit">Mark on the way</button><button class="btn btn-primary" data-act="delivered">Mark delivered</button>`);
    if (o.status === "in_transit") actions.push(`<button class="btn btn-primary" data-act="delivered">Mark delivered</button>`);
    const canCancel = !["delivered", "cancelled"].includes(o.status);
    const custWa = `https://wa.me/977${o.phone}?text=${encodeURIComponent(`Hi ${o.name.split(" ")[0]}, this is GifToyz about your order ${o.id}.`)}`;
    const wrap = drawer(`<span class="mono">${esc(o.id)}</span>`, `
<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">${pill(o.status)}<span class="muted small">Placed ${fmtTime(o.createdAt)}</span>${o.sample ? '<span class="tag">Sample</span>' : ""}</div>
${o.status === "payment_pending" ? `<div class="note accent">${icon("info")}<span>Open your ${WALLET[o.payment.wallet] || "wallet"} statement and look for <strong>${rs(o.payment.paidNow)}</strong> with remark <strong>${esc(o.id)}</strong>${o.payment.txn ? ` or transaction ID <strong>${esc(o.payment.txn)}</strong>` : ""}.</span></div>` : ""}
<div class="sect"><h3>Customer</h3><dl class="dl"><dt>Name</dt><dd>${esc(o.name)}</dd><dt>Phone</dt><dd>${esc(o.phone)}${o.phone2 ? `, ${esc(o.phone2)}` : ""}</dd><dt>Delivery</dt><dd>${esc(o.location.name)}${o.location.district ? `, ${esc(o.location.district)}` : ""} · ${o.location.type === "home" ? "Home delivery" : "Branch pickup"} (${rs(o.location.fee)})</dd><dt>Address</dt><dd>${esc(o.address)}</dd></dl></div>
<div class="sect"><h3>Items</h3><div class="totals" style="border:0;padding:0">${o.items.map((i) => `<div><span>${i.qty} x ${esc(i.name)} <span class="muted">· ${esc(SEED.swatch[i.color]?.en || i.color)}</span></span><span>${rs(i.price * i.qty)}</span></div>`).join("")}<div><span>Delivery</span><span>${rs(o.location.fee)}</span></div><div class="grand"><span>Total</span><span>${rs(o.total)}</span></div></div></div>
<div class="sect"><h3>Payment</h3><dl class="dl"><dt>Method</dt><dd>${o.payment.mode === "full" ? "Paid in full online" : "Cash on delivery"}</dd><dt>Paid now</dt><dd>${o.payment.paidNow ? `${rs(o.payment.paidNow)} by ${WALLET[o.payment.wallet] || "-"}` : "Nothing"}${o.payment.verified ? ' <span class="pill-s s-delivered">Verified</span>' : ""}</dd><dt>Transaction ID</dt><dd class="mono">${esc(o.payment.txn || "-")}</dd><dt>Cash to collect</dt><dd><strong>${rs(o.payment.due)}</strong></dd>${shot ? `<dt>Screenshot</dt><dd><img src="${URL.createObjectURL(shot)}" alt="Payment screenshot" style="max-width:220px;border-radius:10px;border:1px solid var(--border)"></dd>` : ""}</dl></div>
${o.gift ? `<div class="sect"><h3>Gift</h3><dl class="dl"><dt>Note</dt><dd>${esc(o.gift.note || "(no message)")}</dd><dt>Price slip</dt><dd>${o.gift.hideSlip ? "Leave it out" : "Include"}</dd></dl></div>` : ""}
<div class="sect"><h3>NCM</h3>${o.ncm ? `<dl class="dl"><dt>Shipment ID</dt><dd class="mono">${esc(o.ncm.id)}${o.ncm.placeholder ? ' <span class="tag">Placeholder</span>' : ""}</dd><dt>Created</dt><dd>${fmtTime(o.ncm.at)}</dd></dl>` : `<p class="muted small">${ncmLive() ? "Not sent yet. Create NCM shipment sends it to NCM straight away." : "Not sent yet. Connect NCM in Setup to send shipments from here. Until then, copy the details below into the NCM portal."}</p>`}<div id="ncm-live">${ncmTimeline(o.ncm)}</div><div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-secondary btn-sm" type="button" id="copy-ncm">Copy details for NCM</button>${o.ncm && !o.ncm.placeholder && ncmLive() ? `<button class="btn btn-secondary btn-sm" type="button" id="ncm-refresh">Check NCM status</button>` : ""}</div></div>
<div class="sect"><h3>History</h3><ol class="timeline">${(o.history || []).map((h) => `<li class="done"><span class="t-dot">${icon("check")}</span><div><div class="t-title">${STATUS[h.status] || h.status}</div><div class="t-sub">${fmtTime(h.at)}</div></div></li>`).join("")}</ol></div>
<div id="cancel-zone"></div>`,
      `<a class="btn btn-secondary" href="${custWa}" target="_blank" rel="noopener">${icon("chat")}<span>Message customer</span></a>${canCancel ? `<button class="btn btn-danger" type="button" id="cancel">Cancel</button>` : ""}${actions.join("")}`);
    wrap.querySelector("#copy-ncm").addEventListener("click", (e) => GT.copyText(ncmText(o), e.currentTarget));
    wrap.querySelector("#ncm-refresh")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const box = wrap.querySelector("#ncm-live");
      btn.disabled = true;
      try {
        const r = await GT.api(`/ncm/shipments/${encodeURIComponent(o.id)}`, { key: ncmKey() });
        const list = (Array.isArray(r.statuses) ? r.statuses : []).slice().sort((a, b) => String(b.added_time || "").localeCompare(String(a.added_time || "")));
        const d = r.details || {};
        const comments = Array.isArray(r.comments) ? r.comments : [];
        const extra = `<dl class="dl" style="margin-top:12px">${d.trackid ? `<dt>NCM tracking ID</dt><dd class="mono">${esc(d.trackid)}</dd>` : ""}${d.destination_branch_name ? `<dt>Branch</dt><dd>${esc(d.destination_branch_name)}${d.destination_branch_phone ? ` · <a href="tel:${esc(String(d.destination_branch_phone).replace(/[^0-9+]/g, ""))}">${esc(d.destination_branch_phone)}</a>` : ""}</dd>` : ""}${d.delivery_charge ? `<dt>NCM delivery charge</dt><dd>${rs(Math.round(Number(d.delivery_charge)))}</dd>` : ""}${d.payment_status ? `<dt>Payment</dt><dd>${esc(d.payment_status)}</dd>` : ""}</dl>`;
        const notes = comments.length ? `<h4 style="margin:16px 0 8px;font-size:14px">Comments</h4><ul class="ncm-comments">${comments.map((c) => `<li><span>${esc(c.comments || c.comment || "")}</span><span class="sub">${esc(c.addedBy || c.added_by || "")}${c.added_time ? ` · ${esc(c.added_time)}` : ""}</span></li>`).join("")}</ul>` : "";
        box.innerHTML = extra + notes + (list.length
          ? `<ol class="timeline" style="margin-top:12px">${list.map((x) => `<li class="done"><span class="t-dot">${icon("truck")}</span><div><div class="t-title">${esc(x.status || "")}</div><div class="t-sub">${esc(x.added_time || x.created_at || x.date || "")}</div></div></li>`).join("")}</ol>`
          : `<p class="muted small" style="margin-top:12px">NCM has no status updates yet.</p>`);
      } catch (err) {
        toast(err.message);
      } finally {
        btn.disabled = false;
      }
    });
    wrap.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", async () => {
      const s = b.dataset.act;
      let extra = {};
      if (o.server) {
        if (!ncmLive()) { toast("Connect to the shop server in Setup first"); return; }
        const label = b.textContent;
        wrap.querySelectorAll("[data-act]").forEach((x) => (x.disabled = true));
        if (s === "with_ncm") b.textContent = "Sending to NCM…";
        try {
          await serverAction(o, s === "with_ncm" ? "ship" : "status", s === "with_ncm" ? undefined : { status: s });
        } catch (err) {
          toast(err.message);
          wrap.querySelectorAll("[data-act]").forEach((x) => (x.disabled = false));
          b.textContent = label;
          return;
        }
        toast(`${o.id}: ${STATUS[s]}`);
        render();
        openOrder(o.id);
        return;
      }
      if (s === "with_ncm") {
        if (o.sample) {
          extra = { ncm: { id: String(4000000 + Math.floor(Math.random() * 999999)), at: new Date().toISOString(), placeholder: true } };
        } else {
          if (!ncmLive()) { toast("Connect NCM in Setup first"); return; }
          const label = b.textContent;
          wrap.querySelectorAll("[data-act]").forEach((x) => (x.disabled = true));
          b.textContent = "Sending to NCM…";
          try {
            const r = await GT.api("/ncm/shipments", { method: "POST", key: ncmKey(), body: shipmentBody(o) });
            extra = { ncm: { id: String(r.ncm_id), at: new Date().toISOString() } };
          } catch (err) {
            if (err.status === 401) { try { sessionStorage.removeItem("gt_ncm_key"); } catch {} }
            toast(err.message);
            wrap.querySelectorAll("[data-act]").forEach((x) => (x.disabled = false));
            b.textContent = label;
            return;
          }
        }
      }
      setStatus(o.id, s, extra);
      toast(`${o.id}: ${STATUS[s]}`);
      render();
      openOrder(o.id);
    }));
    wrap.querySelector("#cancel")?.addEventListener("click", () => {
      wrap.querySelector("#cancel-zone").innerHTML = `<div class="confirm-strip"><span>Cancel ${esc(o.id)}? Stock goes back if it was already counted.</span><span style="display:flex;gap:8px"><button class="btn btn-secondary btn-sm" type="button" id="keep">Keep order</button><button class="btn btn-sm" style="background:var(--danger);color:#fff" type="button" id="really">Cancel order</button></span></div>`;
      wrap.querySelector("#cancel-zone").scrollIntoView({ behavior: "smooth", block: "nearest" });
      wrap.querySelector("#keep").addEventListener("click", () => (wrap.querySelector("#cancel-zone").innerHTML = ""));
      wrap.querySelector("#really").addEventListener("click", async () => {
        if (o.server) {
          if (!ncmLive()) { toast("Connect to the shop server in Setup first"); return; }
          try { await serverAction(o, "status", { status: "cancelled" }); } catch (err) { toast(err.message); return; }
        } else setStatus(o.id, "cancelled");
        toast(`${o.id} cancelled`); render(); openOrder(o.id);
      });
    });
  };

  const renderProducts = () => {
    const q = (document.getElementById("p-q")?.value || "").trim().toLowerCase();
    const cat = store.get("gt_admin_pcat", "all");
    const list = db.products().filter((p) => (cat === "all" || p.cat === cat) && (!q || `${p.name} ${p.ne_name || ""} ${p.id}`.toLowerCase().includes(q)));
    const low = db.settings().lowStock;
    shell("products", `
<div class="main-head">
  <div><h1>Products</h1><p>${ncmLive() ? `${db.products().length} products. Changes show on the shop straight away.` : `Showing sample products saved in this browser only. <a href="#setup" style="text-decoration:underline">Connect to the shop server</a> to see and edit your real products.`}</p></div>
  <div class="head-tools">
    <input class="input" id="p-q" type="search" placeholder="Search products" style="width:220px;height:40px" value="${esc(q)}">
    <select class="select" id="p-cat" aria-label="Category"><option value="all">All categories</option>${SEED.categories.map((c) => `<option value="${c.id}" ${c.id === cat ? "selected" : ""}>${c.en}</option>`).join("")}</select>
    <button class="btn btn-primary" type="button" id="p-new">${icon("plus")}<span>Add product</span></button>
  </div>
</div>
<div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th>Product</th><th>Category</th><th class="r">Price</th><th class="r">Stock</th><th>Photos</th><th>On shop</th><th></th></tr></thead><tbody>
${list.map((p) => `<tr data-pid="${p.id}"><td class="thumb-sm">${media(p, { cls: "square" })}</td><td class="wrap-cell"><strong>${esc(p.name)}</strong><div class="sub">#${p.id}${p.ne_name ? ` · ${esc(p.ne_name)}` : ""}</div></td><td>${esc(GT.categoryById(p.cat).en)}</td><td class="r">${rs(p.price)}${p.compare > p.price ? `<div class="sub" style="text-decoration:line-through">${rs(p.compare)}</div>` : ""}</td><td class="r"><input class="cell" type="number" min="0" step="1" value="${p.stock}" data-stock="${p.id}" aria-label="Stock for ${esc(p.name)}" style="${p.stock <= low ? `border-color:${p.stock ? "var(--warn)" : "var(--danger)"}` : ""}"></td><td class="sub">${(p.images || []).length || "None"}</td><td><label class="switch" title="Show on shop"><input type="checkbox" data-visible="${p.id}" ${p.visible !== false ? "checked" : ""} aria-label="Show ${esc(p.name)} on shop"><span></span></label></td><td class="r"><button class="btn btn-secondary btn-sm" type="button" data-edit="${p.id}">Edit</button></td></tr>`).join("")}
</tbody></table></div>`);
    const qIn = document.getElementById("p-q");
    qIn.addEventListener("input", () => { const pos = qIn.selectionStart; renderProducts(); const a = document.getElementById("p-q"); a.focus(); a.setSelectionRange(pos, pos); });
    document.getElementById("p-cat").addEventListener("change", (e) => { store.set("gt_admin_pcat", e.target.value); renderProducts(); });
    document.getElementById("p-new").addEventListener("click", () => editProduct(null));
    document.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => editProduct(Number(b.dataset.edit))));
    document.querySelectorAll("[data-stock]").forEach((inp) => inp.addEventListener("change", () => {
      const prods = db.products();
      const p = prods.find((x) => x.id === Number(inp.dataset.stock));
      p.stock = Math.max(0, Math.round(Number(inp.value) || 0));
      saveProducts(prods, [p]);
      toast(`Stock updated: ${p.name}, ${p.stock}`);
    }));
    document.querySelectorAll("[data-visible]").forEach((inp) => inp.addEventListener("change", () => {
      const prods = db.products();
      const p = prods.find((x) => x.id === Number(inp.dataset.visible));
      p.visible = inp.checked;
      if (p.itemId && p.visible && !(p.price > 0)) { p.visible = false; inp.checked = false; toast(`Add a price to ${p.name} before showing it`); return; }
      saveProducts(prods, [p]);
      toast(p.visible ? `${p.name} is on the shop` : `${p.name} is hidden`);
    }));
  };

  const processPhoto = async (file) => {
    let bitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      bitmap = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("unreadable"));
        img.src = URL.createObjectURL(file);
      });
    }
    const MAX = 1600;
    const w = bitmap.width, h = bitmap.height;
    const scale = Math.min(1, MAX / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.86));
    const id = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await idb.put(id, blob);
    const ratio = canvas.width / canvas.height;
    return { id, focal: { x: 50, y: ratio < 0.8 ? 45 : 50 }, fit: "cover", color: "", w: canvas.width, h: canvas.height };
  };

  const editProduct = (id) => {
    const existing = id ? db.products().find((p) => p.id === id) : null;
    const p = existing ? JSON.parse(JSON.stringify(existing)) : { id: Math.max(0, ...db.products().map((x) => x.id)) + 1, name: "", ne_name: "", cat: "tumblers", art: "tumbler", price: 0, compare: 0, stock: 0, colors: [], badge: "", occasions: [], blurb: "", ne_blurb: "", specs: [], ne_specs: [], visible: true, images: [] };
    const field = (id2, label, value, type = "text", extra = "") => `<div class="field" data-f="${id2}"><label for="e-${id2}">${label}</label><input class="input" id="e-${id2}" type="${type}" value="${esc(value)}" ${extra}><span class="error" hidden></span></div>`;
    const area = (id2, label, value, hint = "") => `<div class="field full"><label for="e-${id2}">${label}</label><textarea class="textarea" id="e-${id2}">${esc(value)}</textarea>${hint ? `<span class="hint">${hint}</span>` : ""}</div>`;
    const wrap = drawer(existing ? `Edit #${p.id}` : "New product", `
<div class="sect"><h3>Photos</h3>
  <label class="drop" id="drop" for="e-files">${icon("camera")}<span><strong>Add photos</strong> or drop them here</span><span>iPhone photos are resized and framed automatically. Click a photo to choose what stays in view.</span></label>
  <input id="e-files" type="file" accept="image/*" multiple hidden>
  <p class="small muted" id="photo-status" hidden></p>
  <p class="small" id="photo-err" style="color:var(--danger)" hidden></p>
  <div class="photos" id="photos" style="margin-top:14px"></div>
</div>
<div class="sect"><h3>Basics</h3><div class="form-grid">
  ${field("name", "Name", p.name, "text", 'maxlength="80"')}
  <div class="field"><label for="e-cat">Category</label><select class="input select" id="e-cat" style="border-radius:12px">${SEED.categories.map((c) => `<option value="${c.id}" ${c.id === p.cat ? "selected" : ""}>${c.en}</option>`).join("")}</select></div>
  <div class="field"><label for="e-badge">Label on card</label><select class="input select" id="e-badge" style="border-radius:12px">${Object.entries(BADGES).map(([k, v]) => `<option value="${k}" ${k === (p.badge || "") ? "selected" : ""}>${v}</option>`).join("")}</select></div>
  ${field("price", "Price (Rs)", p.price || "", "number", 'min="0" step="10"')}
  ${field("compare", "Old price for offers (optional)", p.compare || "", "number", 'min="0" step="10"')}
  ${field("stock", "Stock", p.stock, "number", 'min="0" step="1"')}
  <div class="field" data-f="weight"><label for="e-weight">Packed weight (kg)</label><input class="input" id="e-weight" type="number" min="0.05" max="30" step="0.05" value="${esc(p.weight_kg || 0.5)}"><span class="hint">With box and wrapping. Orders over 2 kg cost more delivery, as NCM charges.</span><span class="error" hidden></span></div>
  <div class="field"><span class="label">Show on shop</span><label class="switch-row"><span class="switch"><input type="checkbox" id="e-visible" ${p.visible !== false ? "checked" : ""}><span></span></span><span class="small muted">Hidden products stay saved</span></label></div>
</div></div>
<div class="sect" data-f="colors"><h3>Colours</h3><div class="chips-select" id="e-colors">${Object.entries(SEED.swatch).map(([k, s]) => `<label><input type="checkbox" value="${k}" ${p.colors.includes(k) ? "checked" : ""}><span class="dot" style="background:${s.hex}"></span>${s.en}</label>`).join("")}</div><span class="error small" style="color:var(--danger)" hidden></span></div>
<div class="sect"${SEED.occasions.length ? "" : " hidden"}><h3>Collections</h3><div class="chips-select" id="e-occ">${SEED.occasions.map((o) => `<label><input type="checkbox" value="${o.id}" ${p.occasions.includes(o.id) ? "checked" : ""}>${o.en}</label>`).join("")}</div></div>
<div class="sect"><h3>Description</h3><div class="form-grid">
  ${area("blurb", "Short description", p.blurb)}
  ${area("specs", "Details", (p.specs || []).join("\n"), "One detail per line")}
</div></div>
${existing ? `<div class="sect"><h3>Remove</h3><div id="del-zone"><button class="btn btn-danger btn-sm" type="button" id="del">Delete this product</button></div></div>` : ""}`,
      `<button class="btn btn-secondary" type="button" data-close>Cancel</button><button class="btn btn-primary" type="button" id="save">${existing ? "Save changes" : "Add product"}</button>`);
    wrap.querySelectorAll(".drawer-foot [data-close]").forEach((el) => el.addEventListener("click", closeDrawer));

    const photoBox = wrap.querySelector("#photos");
    const paintPhotos = () => {
      const colors = [...wrap.querySelectorAll("#e-colors input:checked")].map((i) => i.value);
      photoBox.innerHTML = p.images.map((img, i) => `
<div class="photo-row" data-i="${i}">
  <div class="frames">
    <div class="focal" data-focal="${i}" title="Click to set the focus point">${media(p, { image: img })}<span class="cross" style="left:${img.focal.x}%;top:${img.focal.y}%"></span></div>
    <div class="mini">${media(p, { image: img, cls: "square" })}</div>
  </div>
  <div class="p-tools">
    <div class="row">${i === 0 ? '<span class="cover-tag">Cover photo</span>' : `<button class="btn btn-secondary btn-sm" type="button" data-cover="${i}">Make cover</button>`}<span class="muted">${img.w && img.h ? `${img.w} x ${img.h}` : ""}</span></div>
    <div class="row"><span>Framing</span><div class="seg"><button type="button" data-fit="${i}:cover" aria-pressed="${img.fit !== "contain"}">Fill frame</button><button type="button" data-fit="${i}:contain" aria-pressed="${img.fit === "contain"}">Whole photo</button></div></div>
    <div class="row"><label for="pc-${i}">Colour in photo</label><select id="pc-${i}" data-pcolor="${i}"><option value="">Any</option>${colors.map((k) => `<option value="${k}" ${img.color === k ? "selected" : ""}>${SEED.swatch[k].en}</option>`).join("")}</select></div>
    <div class="row"><button class="text-btn" type="button" data-rm="${i}">Remove photo</button></div>
  </div>
</div>`).join("") || `<p class="muted small">No photos yet. The shop shows a drawing until you add one.</p>`;
      hydrate(photoBox);
    };
    paintPhotos();

    const addFiles = async (files) => {
      const err = wrap.querySelector("#photo-err");
      const status = wrap.querySelector("#photo-status");
      err.hidden = true;
      const photos = files.filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
      for (const [i, file] of photos.entries()) {
        const heic = /\.(heic|heif)$/i.test(file.name) || /image\/hei[cf]/.test(file.type);
        try {
          if (ncmLive()) {
            status.hidden = false;
            status.textContent = `Uploading ${i + 1} of ${photos.length}…`;
            p.images.push(await uploadPhoto(file, wrap.querySelector("#e-name").value.trim() || p.name || "Product photo"));
          } else if (heic) {
            throw new Error("Connect to the shop server in Setup to add iPhone HEIC photos. The server converts them.");
          } else {
            p.images.push(await processPhoto(file));
          }
          paintPhotos();
        } catch (e) {
          err.hidden = false;
          err.textContent = `${file.name}: ${e.message === "unreadable" ? "this file couldn't be read." : e.message}`;
        }
      }
      status.hidden = true;
    };
    const drop = wrap.querySelector("#drop");
    wrap.querySelector("#e-files").addEventListener("change", (e) => { addFiles([...e.target.files]); e.target.value = ""; });
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); addFiles([...e.dataTransfer.files]); });
    wrap.querySelector("#e-colors").addEventListener("change", paintPhotos);
    photoBox.addEventListener("click", (e) => {
      const focal = e.target.closest("[data-focal]");
      if (focal) {
        const r = focal.getBoundingClientRect();
        const img = p.images[Number(focal.dataset.focal)];
        img.focal = { x: Math.round(((e.clientX - r.left) / r.width) * 100), y: Math.round(((e.clientY - r.top) / r.height) * 100) };
        paintPhotos();
        return;
      }
      const cover = e.target.closest("[data-cover]");
      if (cover) { const i = Number(cover.dataset.cover); p.images.unshift(...p.images.splice(i, 1)); paintPhotos(); }
      const fit = e.target.closest("[data-fit]");
      if (fit) { const [i, mode] = fit.dataset.fit.split(":"); p.images[Number(i)].fit = mode; paintPhotos(); }
      const rm = e.target.closest("[data-rm]");
      if (rm) { p.images.splice(Number(rm.dataset.rm), 1); paintPhotos(); }
    });
    photoBox.addEventListener("change", (e) => { const s = e.target.closest("[data-pcolor]"); if (s) p.images[Number(s.dataset.pcolor)].color = s.value; });

    wrap.querySelector("#del")?.addEventListener("click", () => {
      wrap.querySelector("#del-zone").innerHTML = `<div class="confirm-strip"><span>Delete ${esc(p.name)} for good? Past orders keep their details.</span><span style="display:flex;gap:8px"><button class="btn btn-secondary btn-sm" type="button" id="del-no">Keep it</button><button class="btn btn-sm" style="background:var(--danger);color:#fff" type="button" id="del-yes">Delete</button></span></div>`;
      wrap.querySelector("#del-no").addEventListener("click", () => { closeDrawer(); editProduct(id); });
      wrap.querySelector("#del-yes").addEventListener("click", () => {
        (existing.images || []).forEach((img) => idb.del(img.id));
        db.saveProducts(db.products().filter((x) => x.id !== id));
        if (existing.itemId && ncmLive()) GT.api(`/api/admin/products/${encodeURIComponent(existing.itemId)}`, { method: "DELETE", key: ncmKey() }).catch((e) => toast(e.message));
        closeDrawer();
        toast("Product deleted");
        renderProducts();
      });
    });

    wrap.querySelector("#save").addEventListener("click", async () => {
      const v = (k) => wrap.querySelector(`#e-${k}`).value.trim();
      const setErr = (k, m) => { const f = wrap.querySelector(`[data-f="${k}"]`); f.classList.toggle("invalid", !!m); const e = f.querySelector(".error"); e.hidden = !m; e.textContent = m; };
      const colors = [...wrap.querySelectorAll("#e-colors input:checked")].map((i) => i.value);
      const errs = { name: v("name").length < 2 ? "Give the product a name." : "", price: Number(v("price")) > 0 ? "" : "Enter a price above 0.", colors: colors.length ? "" : "Pick at least one colour." };
      Object.entries(errs).forEach(([k, m]) => setErr(k, m));
      if (Object.values(errs).some(Boolean)) { wrap.querySelector(".drawer-body").scrollTo({ top: 0, behavior: "smooth" }); return; }
      const cat = v("cat");
      const lines = (k) => v(k).split("\n").map((s) => s.trim()).filter(Boolean);
      const specs = lines("specs");
      Object.assign(p, {
        ne_name: v("name") === p.name ? p.ne_name || "" : "",
        ne_blurb: v("blurb") === (p.blurb || "") ? p.ne_blurb || "" : "",
        ne_specs: specs.join("\n") === (p.specs || []).join("\n") ? p.ne_specs || [] : [],
      });
      Object.assign(p, {
        name: v("name"), cat, art: SEED.categories.find((c) => c.id === cat).art,
        badge: v("badge"), price: Math.round(Number(v("price"))), compare: Math.round(Number(v("compare")) || 0), stock: Math.max(0, Math.round(Number(v("stock")) || 0)), weight_kg: Math.min(30, Math.max(0.05, Math.round((Number(v("weight")) || 0.5) * 100) / 100)),
        visible: wrap.querySelector("#e-visible").checked, colors, occasions: [...wrap.querySelectorAll("#e-occ input:checked")].map((i) => i.value),
        blurb: v("blurb"), specs
      });
      p.images.forEach((img) => { if (img.color && !colors.includes(img.color)) img.color = ""; });
      const prods = db.products();
      if (ncmLive()) {
        if (p.itemId && p.itemId.slice(4, 7) !== catCode(p.cat)) { toast("Item numbers are tied to the category. Add it as a new product instead."); return; }
        if (!p.itemId) assignServerIds(p, prods.filter((x) => x !== existing));
        const btn = wrap.querySelector("#save");
        btn.disabled = true;
        try {
          await GT.api(`/api/admin/products/${encodeURIComponent(p.itemId)}`, { method: "PUT", key: ncmKey(), body: toServer(p) });
        } catch (e) {
          btn.disabled = false;
          toast(`Not saved: ${e.message}`);
          return;
        }
      }
      if (existing) (existing.images || []).filter((img) => img.id && !p.images.some((x) => x.id === img.id)).forEach((img) => idb.del(img.id));
      const at = prods.findIndex((x) => x.id === (existing ? existing.id : p.id));
      if (at >= 0) prods[at] = p; else prods.push(p);
      db.saveProducts(prods);
      closeDrawer();
      toast(existing ? "Product saved" : "Product added");
      renderProducts();
    });
  };

  const renderServerRates = async () => {
    shell("rates", `<div class="main-head"><div><h1>Delivery rates</h1><p>Loading NCM prices…</p></div></div>`);
    let data;
    try { data = await GT.api("/api/admin/rates", { key: ncmKey() }); }
    catch (e) { document.getElementById("view").innerHTML = `<div class="banner"><span>${esc(e.message)}</span></div>`; return; }
    const names = Object.fromEntries(SEED.ncm.map((r) => [r.key, r]));
    const q = (store.get("gt_admin_rq", "") || "").toLowerCase();
    const rows = data.rates.filter((r) => !q || r.key.toLowerCase().includes(q) || ((names[r.key] || {}).district || "").toLowerCase().includes(q));
    const last = data.last_sync;
    const changed = last ? last.changed || [] : [];
    const when = (ts) => fmtTime(new Date(ts * 1000).toISOString());
    shell("rates", `
<div class="main-head">
  <div><h1>Delivery rates</h1><p>${data.rates.length} places. Prices come from NCM for parcels sent from <strong>${esc(last ? last.origin : "your pickup branch")}</strong> and refresh by themselves once a day.</p></div>
  <div class="head-tools"><input class="input" id="r-q" type="search" placeholder="Search place or district" style="width:240px;height:40px" value="${esc(q)}"><button class="btn btn-primary" type="button" id="r-sync" ${data.running ? "disabled" : ""}>${data.running ? "Refreshing…" : "Refresh from NCM"}</button></div>
</div>
<section class="panel"><div class="panel-head"><h2>Last refresh</h2>${data.running ? '<span class="pill-s s-payment_pending">Running now</span>' : ""}</div>
  ${last ? `<dl class="stat-list" style="max-width:520px"><dt>When</dt><dd>${when(last.at)}</dd><dt>Places updated</dt><dd>${last.updated} of ${last.checked}</dd><dt>Prices that changed</dt><dd>${changed.length}</dd><dt>NCM didn't answer for</dt><dd>${last.failed_count ? `${last.failed_count} (kept old price)` : "none"}</dd></dl>
  ${changed.length ? `<details class="acc"><summary>See the ${changed.length} changed prices${icon("plus")}</summary><div class="acc-body"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Place</th><th class="r">Home before</th><th class="r">Home now</th><th class="r">Branch before</th><th class="r">Branch now</th></tr></thead><tbody>${changed.map((c) => `<tr><td>${esc((names[c.key] || {}).name || c.key)}</td><td class="r sub">${rs(c.old[0])}</td><td class="r"><strong>${rs(c.new[0])}</strong></td><td class="r sub">${rs(c.old[1])}</td><td class="r"><strong>${rs(c.new[1])}</strong></td></tr>`).join("")}</tbody></table></div></div></details>` : ""}
  ${last.failed_count ? `<p class="muted small">No answer for: ${esc(last.failed.join(", "))}${last.failed_count > last.failed.length ? "…" : ""}</p>` : ""}` : `<p class="muted small">Not refreshed from NCM yet. Click Refresh from NCM, it takes about two minutes.</p>`}
</section>
<div class="tbl-wrap" style="max-height:70vh;overflow:auto"><table class="tbl"><thead><tr><th>Place</th><th>District</th><th class="r">Home delivery</th><th class="r">Branch pickup</th><th>Source</th></tr></thead><tbody>
${rows.map((r) => `<tr><td>${esc((names[r.key] || {}).name || r.key)}</td><td class="sub">${esc((names[r.key] || {}).district || "")}</td><td class="r">${rs(r.home)}</td><td class="r">${rs(r.branch)}</td><td class="sub">${r.source === "ncm" ? `NCM, ${when(r.updated_ts)}` : "Old rate card"}</td></tr>`).join("")}
</tbody></table></div>`);
    document.getElementById("r-q").addEventListener("change", (e) => { store.set("gt_admin_rq", e.target.value.trim()); renderServerRates(); });
    document.getElementById("r-sync").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = "Refreshing…";
      try {
        await GT.api("/api/admin/rates/sync", { method: "POST", key: ncmKey() });
        toast("Asking NCM for every price. This takes about two minutes.");
        const poll = async () => {
          if (location.hash !== "#rates") return;
          const r = await GT.api("/api/admin/rates", { key: ncmKey() }).catch(() => null);
          if (r && !r.running) { toast(`Done. ${(r.last_sync.changed || []).length} prices changed.`); renderServerRates(); return; }
          setTimeout(poll, 4000);
        };
        setTimeout(poll, 4000);
      } catch (err) {
        toast(err.message);
        btn.disabled = false;
        btn.textContent = "Refresh from NCM";
      }
    });
  };

  const renderRates = () => {
    if (GT.server) return renderServerRates();
    const q = (document.getElementById("r-q")?.value || "").trim().toLowerCase();
    const rates = db.rates();
    const list = rates.map((r, i) => ({ r, i })).filter(({ r }) => !q || r.name.toLowerCase().includes(q) || (r.district || "").toLowerCase().includes(q)).sort((a, b) => a.r.name.localeCompare(b.r.name));
    const missing = rates.filter((r) => !r.district).length;
    shell("rates", `
<div class="main-head">
  <div><h1>Delivery rates</h1><p>${rates.length} NCM places. Customers see these prices at checkout.</p></div>
  <div class="head-tools"><input class="input" id="r-q" type="search" placeholder="Search place or district" style="width:240px;height:40px" value="${esc(q)}"><button class="btn btn-secondary" type="button" id="r-add">${icon("plus")}<span>Add place</span></button></div>
</div>
${missing ? `<div class="banner"><span><strong>${missing} places have no district.</strong> Customers can still find them by name. Add a district so searches like "Kathmandu" or "Jhapa" show them too.</span></div>` : ""}
<div id="r-new"></div>
<div class="tbl-wrap" style="max-height:70vh;overflow:auto"><table class="tbl"><thead><tr><th>Place</th><th>District</th><th class="r">Home delivery</th><th class="r">Branch pickup</th></tr></thead><tbody>
${list.map(({ r, i }) => `<tr><td><strong>${esc(r.name)}</strong></td><td><input class="cell wide" data-ri="${i}" data-k="district" value="${esc(r.district || "")}" placeholder="Add district" aria-label="District for ${esc(r.name)}"></td><td class="r"><input class="cell" type="number" min="0" step="5" data-ri="${i}" data-k="home" value="${r.home}" aria-label="Home price for ${esc(r.name)}"></td><td class="r"><input class="cell" type="number" min="0" step="5" data-ri="${i}" data-k="branch" value="${r.branch}" aria-label="Branch price for ${esc(r.name)}"></td></tr>`).join("")}
</tbody></table></div>
<div><div id="reset-zone"><button class="text-btn" type="button" id="r-reset">Reset all rates to the NCM sheet</button></div></div>`);
    const qIn = document.getElementById("r-q");
    qIn.addEventListener("input", () => { const pos = qIn.selectionStart; renderRates(); const a = document.getElementById("r-q"); a.focus(); a.setSelectionRange(pos, pos); });
    document.querySelectorAll("[data-ri]").forEach((inp) => inp.addEventListener("change", () => {
      const all = db.rates();
      const row = all[Number(inp.dataset.ri)];
      row[inp.dataset.k] = inp.dataset.k === "district" ? inp.value.trim() : Math.max(0, Math.round(Number(inp.value) || 0));
      db.saveRates(all);
      toast(`Saved ${row.name}`);
    }));
    document.getElementById("r-add").addEventListener("click", () => {
      document.getElementById("r-new").innerHTML = `<div class="panel"><div class="panel-head"><h2>New place</h2></div><div class="form-grid" style="grid-template-columns:repeat(4,minmax(0,1fr))"><div class="field"><label for="n-name">Place</label><input class="input" id="n-name"></div><div class="field"><label for="n-dist">District</label><input class="input" id="n-dist"></div><div class="field"><label for="n-home">Home (Rs)</label><input class="input" id="n-home" type="number" min="0"></div><div class="field"><label for="n-branch">Branch (Rs)</label><input class="input" id="n-branch" type="number" min="0"></div></div><div style="display:flex;gap:10px"><button class="btn btn-primary btn-sm" type="button" id="n-save">Add place</button><button class="btn btn-secondary btn-sm" type="button" id="n-cancel">Cancel</button></div></div>`;
      document.getElementById("n-name").focus();
      document.getElementById("n-cancel").addEventListener("click", () => (document.getElementById("r-new").innerHTML = ""));
      document.getElementById("n-save").addEventListener("click", () => {
        const name = document.getElementById("n-name").value.trim();
        const home = Number(document.getElementById("n-home").value), branch = Number(document.getElementById("n-branch").value);
        if (!name || !home || !branch) { toast("Fill in the place and both prices"); return; }
        const all = db.rates();
        all.push({ sn: all.length + 1, key: name.toUpperCase(), name, district: document.getElementById("n-dist").value.trim(), home, branch });
        db.saveRates(all);
        toast(`Added ${name}`);
        renderRates();
      });
    });
    document.getElementById("r-reset").addEventListener("click", () => {
      document.getElementById("reset-zone").innerHTML = `<div class="confirm-strip"><span>Replace every rate and district with the original NCM sheet? Your edits will be lost.</span><span style="display:flex;gap:8px"><button class="btn btn-secondary btn-sm" type="button" id="rz-no">Keep my rates</button><button class="btn btn-sm" style="background:var(--danger);color:#fff" type="button" id="rz-yes">Reset rates</button></span></div>`;
      document.getElementById("rz-no").addEventListener("click", renderRates);
      document.getElementById("rz-yes").addEventListener("click", () => { store.remove("gt_rates"); toast("Rates reset"); renderRates(); });
    });
  };

  const renderBanners = () => {
    const s = db.settings();
    const banners = (s.banners || []).map((b) => ({ ...b }));
    const todayStr = new Date(Date.now() + 5.75 * 3600000).toISOString().slice(0, 10);
    const state = (b) => !b.active ? ["Off", "s-cancelled"] : s.banners_enabled === false ? ["Hidden, banner area off", "s-cancelled"] : b.starts && b.starts > todayStr ? [`Starts ${b.starts}`, "s-payment_pending"] : b.ends && b.ends < todayStr ? ["Ended", "s-cancelled"] : ["Showing now", "s-delivered"];
    const thumb = (img) => img ? `<img src="${esc(img.src)}-800.jpg" alt="" style="width:100%;aspect-ratio:${Number(img.w)}/${Number(img.h)};object-fit:cover;border-radius:10px;display:block">` : "";
    const save = async (list, message) => {
      if (!GT.server || !ncmLive()) { toast("Connect to the shop server in Setup first"); return false; }
      try { await pushSettings({ ...db.settings(), banners: list }); toast(message); return true; }
      catch (e) { toast(`Not saved: ${e.message}`); return false; }
    };
    const upload = async (file) => {
      const res = await fetch("/api/admin/media?kind=banner", { method: "POST", body: file, headers: { Authorization: `Bearer ${ncmKey()}`, "Content-Type": "application/octet-stream" }, credentials: "same-origin" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : `Upload failed (${res.status})`);
      return data.image;
    };
    const edit = (index) => {
      const b = index === null ? { id: [...crypto.getRandomValues(new Uint8Array(4))].map((x) => x.toString(16).padStart(2, "0")).join(""), image: null, mobile: null, alt: "", title_en: "", title_ne: "", text_en: "", text_ne: "", cta_en: "", cta_ne: "", link: "", starts: "", ends: "", active: true } : { ...banners[index] };
      const f = (id, label, value, extra = "", hint = "") => `<div class="field"><label for="b-${id}">${label}</label><input class="input" id="b-${id}" value="${esc(value || "")}" ${extra}>${hint ? `<span class="hint">${hint}</span>` : ""}</div>`;
      const slot = (key, label, hint) => `<div class="field full"><span class="label">${label}</span><div class="banner-slot" id="slot-${key}">${b[key] ? thumb(b[key]) : `<p class="muted small">${hint}</p>`}</div><div style="display:flex;gap:8px;flex-wrap:wrap"><label class="btn btn-secondary btn-sm" for="file-${key}">${b[key] ? "Replace" : "Upload"}</label><input type="file" id="file-${key}" accept="image/*,.heic,.heif" hidden>${key === "mobile" && b.mobile ? '<button class="text-btn" type="button" id="rm-mobile">Remove</button>' : ""}<span class="small muted" id="st-${key}"></span></div></div>`;
      const wrap = drawer(index === null ? "New banner" : "Edit banner", `
<div class="sect"><h3>Pictures</h3><div class="form-grid">
  ${slot("image", "Banner (computer and tablet)", "Wide picture. Best size 2400 x 800 pixels (3:1).")}
  ${slot("mobile", "Phone version (optional)", "Taller picture for phones, e.g. 1080 x 1080. Without it, phones show the wide one.")}
  ${f("alt", "Describe the picture", b.alt, 'maxlength="160"', "Read out by screen readers and used if the picture fails to load.")}
</div></div>
<div class="sect"><h3>Text under the picture (optional)</h3><p class="muted small">Leave empty if the poster already has its text on it.</p><div class="form-grid">
  ${f("title_en", "Heading (English)", b.title_en, 'maxlength="80"')}${f("title_ne", "Heading (Nepali)", b.title_ne, 'maxlength="120"')}
  ${f("text_en", "Line (English)", b.text_en, 'maxlength="160"')}${f("text_ne", "Line (Nepali)", b.text_ne, 'maxlength="220"')}
</div></div>
<div class="sect"><h3>Link (optional)</h3><div class="form-grid">
  <div class="field full"><label for="b-link">Where it goes when tapped</label><input class="input" id="b-link" value="${esc(b.link || "")}" maxlength="300" placeholder="/products?cat=plush"><span class="hint">A shop page such as <code>/products?cat=plush</code> or <code>/product?item=GFT-TUM-001</code>, or a full https:// link.</span><span class="error" hidden></span></div>
  ${f("cta_en", "Button text (English)", b.cta_en, 'maxlength="30" placeholder="Shop now"')}${f("cta_ne", "Button text (Nepali)", b.cta_ne, 'maxlength="40" placeholder="किनमेल गर्नुहोस्"')}
</div></div>
<div class="sect"><h3>When to show</h3><div class="form-grid">
  ${f("starts", "Start date (optional)", b.starts, 'type="date"')}${f("ends", "End date (optional)", b.ends, 'type="date"', "Shows until the end of this day, Nepal time.")}
  <div class="field full"><label class="switch-row"><span class="switch"><input type="checkbox" id="b-active" ${b.active ? "checked" : ""}><span></span></span><span>Show this banner</span></label></div>
</div></div>`,
        `<button class="btn btn-secondary" type="button" data-close>Cancel</button><button class="btn btn-primary" type="button" id="b-save">${index === null ? "Add banner" : "Save banner"}</button>`);
      wrap.querySelectorAll(".drawer-foot [data-close]").forEach((el) => el.addEventListener("click", closeDrawer));
      ["image", "mobile"].forEach((key) => wrap.querySelector(`#file-${key}`).addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const st = wrap.querySelector(`#st-${key}`);
        if (!ncmLive()) { st.textContent = "Connect to the shop server first."; return; }
        st.textContent = "Uploading…";
        try {
          b[key] = await upload(file);
          wrap.querySelector(`#slot-${key}`).innerHTML = thumb(b[key]);
          st.textContent = `${b[key].w} x ${b[key].h}`;
        } catch (err) { st.textContent = err.message; }
        e.target.value = "";
      }));
      wrap.querySelector("#rm-mobile")?.addEventListener("click", () => { b.mobile = null; wrap.querySelector("#slot-mobile").innerHTML = '<p class="muted small">Removed.</p>'; });
      wrap.querySelector("#b-save").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        const v = (id) => wrap.querySelector(`#b-${id}`).value.trim();
        if (!b.image) { toast("Upload the banner picture first"); return; }
        const link = v("link");
        const linkOk = !link || /^https:\/\/\S+$/.test(link) || /^(\/|[a-z0-9-]+(\.html)?(?=$|[?#]))\S*$/.test(link);
        const lf = wrap.querySelector("#b-link").closest(".field");
        lf.classList.toggle("invalid", !linkOk);
        lf.querySelector(".error").hidden = linkOk;
        lf.querySelector(".error").textContent = linkOk ? "" : "Use a shop page like /products?cat=plush or a full https:// link.";
        if (!linkOk) return;
        if (v("starts") && v("ends") && v("ends") < v("starts")) { toast("The end date is before the start date"); return; }
        Object.assign(b, { alt: v("alt"), title_en: v("title_en"), title_ne: v("title_ne"), text_en: v("text_en"), text_ne: v("text_ne"), cta_en: v("cta_en"), cta_ne: v("cta_ne"), link, starts: v("starts"), ends: v("ends"), active: wrap.querySelector("#b-active").checked });
        const list = [...banners];
        if (index === null) list.push(b); else list[index] = b;
        btn.disabled = true;
        if (await save(list, index === null ? "Banner added" : "Banner saved")) { closeDrawer(); renderBanners(); } else btn.disabled = false;
      });
    };

    shell("banners", `
<div class="main-head"><div><h1>Banners</h1><p>Posters at the top of the home page, below the menu. Use them for sales, new arrivals and festival wishes.</p></div><button class="btn btn-primary" type="button" id="b-new" ${banners.length >= 8 ? "disabled" : ""}>${icon("plus")}<span>Add banner</span></button></div>
${GT.server && ncmLive() ? "" : '<div class="banner"><span>Connect to the shop server in Setup to manage banners.</span></div>'}
<section class="panel"><div class="panel-head"><h2>Show banners on the home page</h2>${s.banners_enabled === false ? '<span class="pill-s s-cancelled">Hidden</span>' : '<span class="pill-s s-delivered">Visible</span>'}</div>
  <label class="switch-row"><span class="switch"><input type="checkbox" id="b-enabled" ${s.banners_enabled === false ? "" : "checked"}><span></span></span><span>Show the banner area</span></label>
  <p class="muted small">Turn this off to hide every banner at once. Your banners and their settings stay saved, and each one still has its own switch below.</p>
</section>
${banners.length ? `<div class="banner-list">${banners.map((b, i) => { const [label, cls] = state(b); return `<article class="panel banner-card">
  <div class="bc-img">${thumb(b.image)}</div>
  <div class="bc-body">
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="pill-s ${cls}">${esc(label)}</span>${b.mobile ? '<span class="tag">Phone version</span>' : ""}</div>
    <strong>${esc(b.title_en || b.alt || "Untitled banner")}</strong>
    <span class="muted small">${b.starts || b.ends ? `${esc(b.starts || "Now")} to ${esc(b.ends || "no end date")}` : "No dates, shows while switched on"}${b.link ? ` · Links to ${esc(b.link)}` : ""}</span>
    <div class="bc-actions">
      <button class="btn btn-secondary btn-sm" type="button" data-edit="${i}">Edit</button>
      <button class="btn btn-secondary btn-sm" type="button" data-toggle="${i}">${b.active ? "Switch off" : "Switch on"}</button>
      ${i > 0 ? `<button class="text-btn" type="button" data-up="${i}">Move up</button>` : ""}${i < banners.length - 1 ? `<button class="text-btn" type="button" data-down="${i}">Move down</button>` : ""}
      <button class="text-btn" type="button" data-del="${i}" style="color:var(--danger)">Delete</button>
    </div>
  </div>
</article>`; }).join("")}</div>` : `<section class="panel"><div class="empty"><h3>No banners yet</h3><p>Add a poster to show it at the top of the home page.</p></div></section>`}
<section class="panel"><div class="panel-head"><h2>Slide speed</h2></div><div class="field" style="max-width:260px"><label for="b-seconds">Seconds per banner</label><input class="input" id="b-seconds" type="number" min="3" max="20" value="${Number(s.banner_seconds) || 6}"><span class="hint">Used when more than one banner is showing. It stops while a visitor's pointer is on it.</span></div><button class="btn btn-secondary btn-sm" type="button" id="b-speed">Save speed</button></section>
<section class="panel"><div class="panel-head"><h2>Home page showcase</h2><span class="muted small">The three product pictures beside the heading on the home page</span></div>
<div class="form-grid">${[0, 1, 2].map((i) => { const h = (s.hero || [])[i] || {}; return `<div class="field"><label for="h-id-${i}">${["Big picture (left)", "Top right", "Bottom right"][i]}</label><select class="input select" id="h-id-${i}" style="border-radius:12px"><option value="">Automatic</option>${db.products().filter((p) => p.visible !== false).map((p) => `<option value="${p.id}" ${p.id === h.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div><div class="field"><label for="h-label-${i}">Label</label><select class="input select" id="h-label-${i}" style="border-radius:12px">${[["", "No label"], ["best", "Best seller"], ["hot", "Hot item"], ["new", "New"]].map(([v, l]) => `<option value="${v}" ${v === (h.label || "") ? "selected" : ""}>${l}</option>`).join("")}</select></div>`; }).join("")}</div>
<p class="muted small">Slots left on Automatic are filled with best sellers that are in stock.</p>
<button class="btn btn-secondary btn-sm" type="button" id="h-save">Save showcase</button></section>`);
    document.getElementById("h-save").addEventListener("click", async () => {
      const hero = [0, 1, 2].map((i) => ({ id: Number(document.getElementById(`h-id-${i}`).value), label: document.getElementById(`h-label-${i}`).value })).filter((h) => h.id);
      if (new Set(hero.map((h) => h.id)).size < hero.length) { toast("Pick a different product for each picture"); return; }
      if (!GT.server || !ncmLive()) { toast("Connect to the shop server in Setup first"); return; }
      try { await pushSettings({ ...db.settings(), hero }); toast("Showcase saved"); renderBanners(); } catch (e) { toast(`Not saved: ${e.message}`); }
    });
    document.getElementById("b-new").addEventListener("click", () => edit(null));
    document.getElementById("b-enabled").addEventListener("change", async (e) => {
      const on = e.target.checked;
      if (!GT.server || !ncmLive()) { e.target.checked = !on; toast("Connect to the shop server in Setup first"); return; }
      try { await pushSettings({ ...db.settings(), banners_enabled: on }); toast(on ? "Banners are showing on the home page" : "Banners are hidden from the home page"); renderBanners(); }
      catch (err) { e.target.checked = !on; toast(`Not saved: ${err.message}`); }
    });
    document.querySelectorAll("[data-edit]").forEach((el) => el.addEventListener("click", () => edit(Number(el.dataset.edit))));
    const mutate = async (fn, message) => { const list = banners.map((b) => ({ ...b })); fn(list); if (await save(list, message)) renderBanners(); };
    document.querySelectorAll("[data-toggle]").forEach((el) => el.addEventListener("click", () => mutate((l) => { const b = l[Number(el.dataset.toggle)]; b.active = !b.active; }, "Banner updated")));
    document.querySelectorAll("[data-up]").forEach((el) => el.addEventListener("click", () => mutate((l) => { const i = Number(el.dataset.up); [l[i - 1], l[i]] = [l[i], l[i - 1]]; }, "Order saved")));
    document.querySelectorAll("[data-down]").forEach((el) => el.addEventListener("click", () => mutate((l) => { const i = Number(el.dataset.down); [l[i + 1], l[i]] = [l[i], l[i + 1]]; }, "Order saved")));
    document.querySelectorAll("[data-del]").forEach((el) => el.addEventListener("click", () => {
      const i = Number(el.dataset.del);
      if (el.dataset.sure !== "1") { el.dataset.sure = "1"; el.textContent = "Click again to delete"; return; }
      mutate((l) => l.splice(i, 1), "Banner deleted");
    }));
    document.getElementById("b-speed").addEventListener("click", async () => {
      const n = Math.min(20, Math.max(3, Math.round(Number(document.getElementById("b-seconds").value) || 6)));
      if (!GT.server || !ncmLive()) { toast("Connect to the shop server in Setup first"); return; }
      try { await pushSettings({ ...db.settings(), banner_seconds: n }); toast("Speed saved"); } catch (e) { toast(`Not saved: ${e.message}`); }
    });
  };

  const COLOUR_NAMES = [
    ["Black", "कालो", "#1E1E1E"], ["Charcoal", "गाढा खरानी", "#3F4246"], ["Grey", "खरानी", "#8E8E93"], ["Silver", "चाँदी", "#C8CACD"], ["Light grey", "हल्का खरानी", "#E6E6EA"], ["White", "सेतो", "#FFFFFF"],
    ["Cream", "क्रिम", "#F1E4CF"], ["Beige", "बेज", "#D9C3A5"], ["Brown", "खैरो", "#7A4A2A"], ["Honey brown", "मह खैरो", "#C47A3D"], ["Maroon", "कलेजी", "#7B1E2B"],
    ["Red", "रातो", "#D0202E"], ["Coral", "कोरल", "#FF6F61"], ["Orange", "सुन्तला", "#F86808"], ["Peach", "पिच", "#FFCBA4"], ["Gold", "सुनौलो", "#D4A017"],
    ["Yellow", "पहेँलो", "#F5D53B"], ["Lime", "कागती हरियो", "#A8D440"], ["Green", "हरियो", "#2E9E4F"], ["Dark green", "गाढा हरियो", "#1F5F3A"], ["Olive", "ओलिभ", "#7A7A2E"],
    ["Mint", "मिन्ट", "#A9DEC9"], ["Teal", "टिल", "#1F8A8A"], ["Turquoise", "फिरोजी", "#3CC8C8"], ["Sky blue", "आकाशे निलो", "#A9CDEB"], ["Blue", "निलो", "#3B6FBF"],
    ["Navy", "गाढा निलो", "#1B2A55"], ["Purple", "बैजनी", "#7B3FA0"], ["Lilac", "हल्का बैजनी", "#CDBDF0"], ["Lavender", "ल्याभेन्डर", "#B79FDC"], ["Magenta", "म्याजेन्टा", "#C2268A"],
    ["Hot pink", "गाढा गुलाबी", "#F0468C"], ["Pink", "गुलाबी", "#F5B8C8"]
  ];
  const nearestColour = (hex) => {
    const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const [r, g, b] = rgb(hex);
    let best = COLOUR_NAMES[0], bestD = Infinity;
    for (const c of COLOUR_NAMES) {
      const [r2, g2, b2] = rgb(c[2]);
      const m = (r + r2) / 2, d = (2 + m / 256) * (r - r2) ** 2 + 4 * (g - g2) ** 2 + (2 + (255 - m) / 256) * (b - b2) ** 2;
      if (d < bestD) { best = c; bestD = d; }
    }
    return { en: best[0], ne: best[1] };
  };

  const renderCatalog = () => {
    const draft = {
      categories: SEED.categories.map((c) => ({ id: c.id, en: c.en, ne: c.ne || "", code: c.code || c.id.slice(0, 3).toUpperCase(), art: c.art || "giftbox", color: c.color || "#F86808" })),
      colors: Object.entries(SEED.swatch).map(([id, c]) => ({ id, en: c.en, ne: c.ne || "", hex: c.hex })),
      occasions: SEED.occasions.map((o) => ({ id: o.id, en: o.en, ne: o.ne || "" }))
    };
    const saved = new Set([...draft.categories.map((c) => "categories:" + c.id), ...draft.colors.map((c) => "colors:" + c.id), ...draft.occasions.map((c) => "occasions:" + c.id)]);
    const uses = (kind, id) => db.products().filter((p) => (kind === "categories" ? p.cat === id : kind === "colors" ? (p.colors || []).includes(id) : (p.occasions || []).includes(id))).length;
    const cell = (kind, i, key, value, extra = "") => `<input class="cell" data-k="${kind}.${i}.${key}" value="${esc(value)}" ${extra}>`;
    const row = (kind, item, i) => {
      const n = uses(kind, item.id);
      const isNew = !saved.has(kind + ":" + item.id);
      const remove = n ? `<span class="sub" title="Used by ${n} product(s)">${n} in use</span>` : `<button class="text-btn" type="button" data-rm="${kind}.${i}">Remove</button>`;
      if (kind === "categories") return `<tr><td>${cell(kind, i, "en", item.en, 'maxlength="40" aria-label="English name"')}<div class="sub mono">${esc(item.id)}</div></td><td>${cell(kind, i, "code", item.code, `maxlength="3" style="width:64px;text-transform:uppercase" aria-label="Item code" ${n && !isNew ? "readonly title=\"Fixed while products use it\"" : ""}`)}</td><td class="r">${remove}</td></tr>`;
      if (kind === "colors") return `<tr><td>${cell(kind, i, "en", item.en, 'maxlength="40" aria-label="English name"')}<div class="sub mono">${esc(item.id)}</div></td><td><input type="color" data-k="${kind}.${i}.hex" value="${esc(item.hex)}" aria-label="Colour" style="width:44px;height:36px;border:0;background:none;padding:0"></td><td class="r">${remove}</td></tr>`;
      return `<tr><td>${cell(kind, i, "en", item.en, 'maxlength="40" aria-label="English name"')}<div class="sub mono">${esc(item.id)}</div></td><td class="r">${remove}</td></tr>`;
    };
    const table = (kind, heads) => `<div class="tbl-wrap"><table class="tbl"><thead><tr>${heads.map((h, i) => `<th${i === heads.length - 1 ? ' class="r"' : ""}>${h}</th>`).join("")}</tr></thead><tbody>${draft[kind].map((item, i) => row(kind, item, i)).join("")}</tbody></table></div>
      <form class="add-row" data-add="${kind}"><input class="input" name="name" maxlength="40" placeholder="New ${kind === "categories" ? "category" : kind === "colors" ? "colour" : "collection"} name (English)" aria-label="New name">${kind === "colors" ? '<input type="color" name="hex" value="#F86808" aria-label="Colour" title="Pick a colour and a name is suggested" style="width:48px;height:44px;border:0;background:none">' : ""}<button class="btn btn-secondary btn-sm" type="submit">Add</button></form>`;
    const paint = () => {
      shell("catalog", `
<div class="main-head"><div><h1>Catalog setup</h1><p>Product categories, colour options and collections. Products and the shop menus use these lists.</p></div><button class="btn btn-primary" type="button" id="c-save">Save changes</button></div>
${GT.server ? "" : '<div class="banner"><span>Connect to the shop server to change these lists.</span></div>'}
<section class="panel"><div class="panel-head"><h2>Categories</h2><span class="muted small">The item code starts each product number, e.g. GFT-<strong>TUM</strong>-001</span></div>${table("categories", ["Name", "Item code", ""])}</section>
<section class="panel"><div class="panel-head"><h2>Colour options</h2></div>${table("colors", ["Name", "Colour", ""])}</section>
<section class="panel"><div class="panel-head"><h2>Collections</h2><span class="muted small">Optional, for a festival or event, e.g. Gifts for Tihar. Add one, then tick it on the products. The shop shows a Collections filter while this list has anything in it.</span></div>${table("occasions", ["Name", ""])}</section>
<p class="muted small">Something in use can't be removed. Move those products to another category or colour, or untick the collection on them, first.</p>`);
      const view = document.getElementById("view");
      view.addEventListener("input", (e) => {
        const k = e.target.dataset.k;
        if (!k) return;
        const [kind, i, key] = k.split(".");
        draft[kind][Number(i)][key] = key === "code" ? e.target.value.toUpperCase().replace(/[^A-Z]/g, "") : e.target.value;
        if (key === "en") draft[kind][Number(i)].ne = "";
      });
      view.addEventListener("change", (e) => {
        const k = e.target.dataset.k;
        if (k && e.target.tagName === "SELECT") { const [kind, i, key] = k.split("."); draft[kind][Number(i)][key] = e.target.value; }
      });
      const hexIn = view.querySelector('[data-add="colors"] [name="hex"]');
      const nameIn = view.querySelector('[data-add="colors"] [name="name"]');
      let suggested = "";
      hexIn.addEventListener("input", () => {
        if (nameIn.value.trim() && nameIn.value !== suggested) return;
        suggested = nearestColour(hexIn.value).en;
        nameIn.value = suggested;
      });
      view.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => { const [kind, i] = b.dataset.rm.split("."); draft[kind].splice(Number(i), 1); paint(); }));
      view.querySelectorAll("[data-add]").forEach((f) => f.addEventListener("submit", (e) => {
        e.preventDefault();
        const kind = f.dataset.add;
        const name = f.elements.name.value.trim();
        if (!name) return;
        if (draft[kind].some((x) => x.en.trim().toLowerCase() === name.toLowerCase())) { toast(`"${name}" is already in the list`); return; }
        let id = slugify(name), n = 2;
        while (draft[kind].some((x) => x.id === id)) id = `${slugify(name)}-${n++}`;
        const item = { id, en: name, ne: "" };
        if (kind === "colors") {
          item.hex = f.elements.hex.value;
          const guess = nearestColour(item.hex);
          if (guess.en === name) item.ne = guess.ne;
        }
        if (kind === "categories") {
          let code = name.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase().padEnd(3, "X");
          const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
          for (let j = 0; draft.categories.some((c) => c.code === code) && j < 26; j++) code = code.slice(0, 2) + letters[j];
          Object.assign(item, { code, art: "giftbox", color: "#F86808" });
        }
        draft[kind].push(item);
        paint();
      }));
      document.getElementById("c-save").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        if (!GT.server || !ncmLive()) { toast("Connect to the shop server in Setup first"); return; }
        const bad = draft.categories.find((c) => !/^[A-Z]{3}$/.test(c.code));
        if (bad) { toast(`Item code for ${bad.en} must be 3 letters`); return; }
        btn.disabled = true;
        try {
          await GT.api("/api/admin/taxonomy", { method: "PUT", key: ncmKey(), body: draft });
          toast("Saved. Reloading…");
          setTimeout(() => location.reload(), 500);
        } catch (err) {
          btn.disabled = false;
          toast(err.message);
        }
      });
    };
    paint();
  };

  const renderSetup = async () => {
    const s = db.settings();
    const qrImgs = {};
    for (const k of Object.keys(WALLET)) {
      if (typeof s.qr[k] === "string" && s.qr[k].startsWith("/media/")) { qrImgs[k] = s.qr[k]; continue; }
      const b = s.qr[k] ? await idb.get(s.qr[k]) : null;
      qrImgs[k] = b ? URL.createObjectURL(b) : null;
    }
    shell("setup", `
<div class="main-head"><div><h1>Setup</h1><p>Shop details, payments and admin access.</p></div><button class="btn btn-primary" type="button" id="s-save">Save changes</button></div>
<div class="settings-grid">
  <section class="panel"><div class="panel-head"><h2>Shop details</h2></div><div class="form-grid">
    <div class="field"><label for="s-phone">Phone shown on the site</label><input class="input" id="s-phone" value="${esc(s.phone)}" inputmode="numeric"></div>
    <div class="field"><label for="s-wa">WhatsApp number for orders</label><input class="input" id="s-wa" value="${esc(s.whatsapp)}" inputmode="numeric"><span class="hint">With country code, e.g. 9779709119177</span></div>
    <div class="field"><label for="s-ig">Instagram username</label><input class="input" id="s-ig" value="${esc(s.instagram)}" placeholder="giftoyz.np"></div>
    <div class="field"><label for="s-tt">TikTok username</label><input class="input" id="s-tt" value="${esc(s.tiktok || "")}" placeholder="giftoyz.np"><span class="hint">Leave empty to hide TikTok</span></div>
    <div class="field"><label for="s-fb">Facebook page username</label><input class="input" id="s-fb" value="${esc(s.facebook || "")}" placeholder="giftoyznepal"><span class="hint">The part after facebook.com/</span></div>
    <div class="field"><label for="s-email">Email for customers</label><input class="input" id="s-email" type="email" value="${esc(s.email || "")}" placeholder="hello@giftoyz.com.np"></div>
    <div class="field"><label for="s-hours-en">Reply hours (English)</label><input class="input" id="s-hours-en" value="${esc(s.hours_en || "")}"></div>
    <div class="field"><label for="s-hours-ne">Reply hours (Nepali)</label><input class="input" id="s-hours-ne" value="${esc(s.hours_ne || "")}"></div>
    <div class="field full"><label for="s-an-en">Top bar message (English)</label><input class="input" id="s-an-en" value="${esc(s.announce_en)}"><span class="hint">Leave both empty to hide the bar</span></div>
    <div class="field full"><label for="s-an-ne">Top bar message (Nepali)</label><input class="input" id="s-an-ne" value="${esc(s.announce_ne)}"></div>
  </div></section>
  <section class="panel"><div class="panel-head"><h2>Shop status</h2>${s.orders_paused ? '<span class="pill-s s-cancelled">Orders paused</span>' : '<span class="pill-s s-delivered">Taking orders</span>'}</div>
    <label class="switch-row"><span class="switch"><input type="checkbox" id="s-pause" ${s.orders_paused ? "checked" : ""}><span></span></span><span>Pause new orders</span></label>
    <label class="switch-row"><span class="switch"><input type="checkbox" id="s-bills" ${s.bills_enabled ? "checked" : ""}><span></span></span><span>Customers can download a bill</span></label>
    <p class="muted small" style="margin-top:-6px">Turn on once the business has a PAN, so bills carry your registration details.</p>
    <p class="muted small">Customers can still browse and track orders. Checkout shows the message below and a WhatsApp button instead.</p>
    <div class="form-grid">
      <div class="field full"><label for="s-pause-en">Message while paused (English)</label><input class="input" id="s-pause-en" maxlength="160" value="${esc(s.pause_en || "We're taking a short break. Orders open again soon.")}"></div>
      <div class="field full"><label for="s-pause-ne">Message while paused (Nepali)</label><input class="input" id="s-pause-ne" maxlength="200" value="${esc(s.pause_ne || "हामी केही दिनको बिदामा छौं। छिट्टै फेरि अर्डर खुल्छ।")}"></div>
    </div>
  </section>
  <section class="panel"><div class="panel-head"><h2>Payments</h2></div>
    <label class="switch-row"><span class="switch"><input type="checkbox" id="s-cod" ${s.codAdvance ? "checked" : ""}><span></span></span><span>Cash on delivery needs the delivery fee paid first</span></label>
    <p class="muted small">When this is on, customers who pick cash on delivery pay the delivery fee by QR to confirm. They pay the rest to the NCM rider.</p>
    ${Object.entries(WALLET).map(([k, name]) => `<div class="qr-slot"><div class="qr-prev">${qrImgs[k] ? `<img src="${qrImgs[k]}" alt="${name} QR">` : icon("qr")}</div><div style="display:grid;gap:8px"><strong>${name} QR</strong><div style="display:flex;gap:8px;flex-wrap:wrap"><label class="btn btn-secondary btn-sm" for="qr-${k}">${qrImgs[k] ? "Replace" : "Upload"}</label><input type="file" accept="image/*,.heic,.heif" id="qr-${k}" data-qr="${k}" hidden>${qrImgs[k] ? `<button class="text-btn" type="button" data-qr-rm="${k}">Remove</button>` : ""}</div>
      ${GT.server ? `<div class="form-grid" style="gap:10px">${k === "bank" ? `<div class="field full"><label for="qa-${k}-bank">Bank name</label><input class="input" id="qa-${k}-bank" value="${esc(((s.qr_info || {})[k] || {}).bank || "")}" maxlength="60"></div>` : ""}<div class="field"><label for="qa-${k}-name">Account name</label><input class="input" id="qa-${k}-name" value="${esc(((s.qr_info || {})[k] || {}).name || "")}" maxlength="60"></div><div class="field"><label for="qa-${k}-number">${k === "bank" ? "Account number" : "Mobile number"}</label><input class="input" id="qa-${k}-number" inputmode="numeric" value="${esc(((s.qr_info || {})[k] || {}).number || "")}" maxlength="40"></div></div><span class="hint">Shown under the QR at checkout with a copy button. ${qrImgs[k] ? "" : "Upload a QR to offer this option to customers."}</span>` : ""}</div></div>`).join("")}
  </section>
  <section class="panel"><div class="panel-head"><h2>Stock</h2></div>
    <div class="field"><label for="s-low">Warn customers when stock is at or below</label><input class="input" id="s-low" type="number" min="0" value="${s.lowStock}" style="max-width:140px"><span class="hint">Shows "Only 3 left" on the product</span></div>
    <div class="field"><label for="s-happy">Happy customers on the home page</label><input class="input" id="s-happy" type="number" min="0" step="10" value="${Number(s.happy_customers ?? 100)}" style="max-width:140px"><span class="hint">Shows "100+ happy customers". 0 hides it. Once 5 reviews are approved, the real star rating shows instead.</span></div>
  </section>
  ${GT.server ? "" : `<section class="panel"><div class="panel-head"><h2>Admin access</h2></div>
    <div class="field"><label for="s-pin">Admin PIN</label><input class="input" id="s-pin" value="${esc(s.pin)}" inputmode="numeric" maxlength="8" style="max-width:180px;font-family:var(--mono)"><span class="hint">4 to 8 digits. In the live shop this becomes a password plus a code on your phone.</span></div>
  </section>`}
  ${ncmLive() ? `<section class="panel"><div class="panel-head"><h2>Order alerts</h2><span class="muted small">Telegram message for every new order</span></div><div id="alerts-box"><p class="muted small">Loading…</p></div></section>` : ""}
  <section class="panel"><div class="panel-head"><h2>NCM connection</h2></div>
    <p class="muted small">${GT.apiReady() ? (ncmKey() ? "Connected for this browser session. The key is forgotten when you lock the admin or close the browser." : "Enter ADMIN_API_KEY from server/.env to send shipments to NCM.") : "Open the admin over HTTPS, or on this computer at localhost, to connect NCM."}</p>
    ${GT.apiReady() ? `<div class="field"><label for="s-ncm-key">Admin key</label><input class="input" id="s-ncm-key" type="password" autocomplete="off" spellcheck="false" placeholder="${ncmKey() ? "Saved for this session" : "Paste the ADMIN_API_KEY value"}" style="max-width:420px;font-family:var(--mono)"><span class="hint">Never saved to this device. The NCM token itself stays on the server.</span></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-secondary btn-sm" type="button" id="s-ncm-save">Use this key</button>${ncmKey() ? `<button class="text-btn" type="button" id="s-ncm-forget">Forget key</button>` : ""}</div>` : ""}
    ${ncmLive() ? `<h3 style="margin-top:20px;font-size:15px">Recent NCM errors</h3><div id="ncm-log" class="tbl-wrap"><p class="muted small">Loading…</p></div>` : ""}
  </section>
  <section class="panel"><div class="panel-head"><h2>Data</h2></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap" id="data-zone">
      <button class="btn btn-secondary btn-sm" type="button" data-wipe="sample">Remove sample orders</button>
      <button class="btn btn-secondary btn-sm" type="button" data-wipe="products">Reset products to samples</button>
      <button class="btn btn-danger btn-sm" type="button" data-wipe="orders">Delete all orders</button>
    </div>
    <div id="wipe-confirm"></div>
  </section>
</div>`);
    document.querySelectorAll("[data-qr]").forEach((inp) => inp.addEventListener("change", async () => {
      const file = inp.files[0];
      if (!file) return;
      const cur = db.settings();
      const k = inp.dataset.qr;
      if (GT.server) {
        try {
          const res = await fetch("/api/admin/media?kind=qr", { method: "POST", body: file, headers: { Authorization: `Bearer ${ncmKey()}`, "Content-Type": "application/octet-stream" }, credentials: "same-origin" });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : `Upload failed (${res.status})`);
          await pushSettings({ ...cur, qr: { ...cur.qr, [k]: data.src } });
        } catch (e) { toast(`QR not saved: ${e.message}`); return; }
      } else {
        const id = `qr-${k}-${Date.now()}`;
        await idb.put(id, file);
        if (cur.qr[k]) idb.del(cur.qr[k]);
        cur.qr[k] = id;
        db.saveSettings(cur);
      }
      toast(`${WALLET[k]} QR saved`);
      renderSetup();
    }));
    document.querySelectorAll("[data-qr-rm]").forEach((b) => b.addEventListener("click", async () => {
      const cur = db.settings();
      const k = b.dataset.qrRm;
      if (GT.server) {
        try { await pushSettings({ ...cur, qr: { ...cur.qr, [k]: null } }); } catch (e) { toast(`Not removed: ${e.message}`); return; }
      } else {
        idb.del(cur.qr[k]);
        cur.qr[k] = null;
        db.saveSettings(cur);
      }
      toast("QR removed");
      renderSetup();
    }));
    const alertsBox = document.getElementById("alerts-box");
    const paintAlerts = (a) => {
      alertsBox.innerHTML = !a.token
        ? `<p class="muted small">Not set up yet. Create a bot with @BotFather in Telegram, then run <code>npx wrangler secret put TELEGRAM_BOT_TOKEN</code> in the <code>cloudflare</code> folder and paste the token there.</p>`
        : a.connected
          ? `<p class="small"><span class="pill-s s-delivered">Connected</span> Alerts go to <strong>${esc(a.name)}</strong> on Telegram.</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-secondary btn-sm" type="button" id="al-test">Send test alert</button><button class="text-btn" type="button" id="al-off">Turn off</button></div>`
          : `<p class="muted small">Open your bot in Telegram and send it <code>/start</code>, then press Connect.</p><button class="btn btn-secondary btn-sm" type="button" id="al-connect">Connect Telegram</button>`;
      const act = (id, path, method, done) => alertsBox.querySelector(id)?.addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try { const r = await GT.api(path, { method, key: ncmKey(), body: {} }); toast(done(r)); loadAlerts(); }
        catch (err) { toast(err.message); btn.disabled = false; }
      });
      act("#al-connect", "/api/admin/alerts/connect", "POST", (r) => `Connected to ${r.name}`);
      act("#al-test", "/api/admin/alerts/test", "POST", () => "Test alert sent");
      act("#al-off", "/api/admin/alerts", "DELETE", () => "Order alerts turned off");
    };
    const loadAlerts = () => GT.api("/api/admin/alerts", { key: ncmKey() }).then(paintAlerts).catch((err) => { alertsBox.innerHTML = `<p class="muted small">${esc(err.message)}</p>`; });
    if (alertsBox) loadAlerts();
    const log = document.getElementById("ncm-log");
    if (log && ncmLive()) {
      GT.api("/api/admin/ncm/events?limit=20", { key: ncmKey() }).then(({ events }) => {
        log.innerHTML = events.length
          ? `<table class="tbl"><thead><tr><th>When</th><th>Order</th><th>Step</th><th>Code</th><th>Detail</th></tr></thead><tbody>${events.map((e) => `<tr><td class="sub">${fmtTime(new Date(e.ts * 1000).toISOString())}</td><td class="mono">${esc(e.ref)}</td><td>${esc(e.op)}</td><td class="mono">${esc(e.code)}${e.http_status ? ` · ${e.http_status}` : ""}</td><td class="wrap-cell">${esc(e.message)}</td></tr>`).join("")}</tbody></table>`
          : `<p class="muted small">No NCM errors recorded.</p>`;
      }).catch(() => (log.innerHTML = `<p class="muted small">Couldn't load the NCM log.</p>`));
    }
    document.getElementById("s-ncm-save")?.addEventListener("click", () => {
      const key = document.getElementById("s-ncm-key").value.trim();
      if (key.length < 32) { toast("The admin key is at least 32 characters"); return; }
      try { sessionStorage.setItem("gt_ncm_key", key); } catch { toast("This browser blocked session storage"); return; }
      toast("Connected to the shop server for this session");
      synced = false;
      syncServer();
      renderSetup();
    });
    document.getElementById("s-ncm-forget")?.addEventListener("click", () => {
      try { sessionStorage.removeItem("gt_ncm_key"); } catch {}
      toast("Key forgotten");
      render();
    });
    document.getElementById("s-save").addEventListener("click", async () => {
      const v = (id) => document.getElementById(id).value.trim();
      const pin = document.getElementById("s-pin") ? v("s-pin") : db.settings().pin;
      if (!/^\d{4,8}$/.test(pin)) { toast("PIN must be 4 to 8 digits"); return; }
      const wa = v("s-wa").replace(/\D/g, "");
      if (!/^977\d{10}$/.test(wa)) { toast("WhatsApp number should look like 9779709119177"); return; }
      const cur = db.settings();
      const qrInfo = Object.fromEntries(Object.keys(WALLET).map((k) => [k, { name: document.getElementById(`qa-${k}-name`)?.value.trim() || "", number: (document.getElementById(`qa-${k}-number`)?.value || "").replace(/[^0-9 +-]/g, "").trim(), bank: document.getElementById(`qa-${k}-bank`)?.value.trim() || "" }]));
      const next = { ...cur, qr_info: qrInfo, phone: v("s-phone").replace(/\D/g, ""), whatsapp: wa, instagram: v("s-ig").replace(/^@/, ""), tiktok: v("s-tt").replace(/^@/, ""), facebook: v("s-fb").replace(/^(https?:\/\/)?(www\.)?facebook\.com\//, "").replace(/\/$/, ""), email: v("s-email"), hours_en: v("s-hours-en"), hours_ne: v("s-hours-ne"), orders_paused: document.getElementById("s-pause").checked, bills_enabled: document.getElementById("s-bills").checked, pause_en: v("s-pause-en"), pause_ne: v("s-pause-ne"), announce_en: v("s-an-en"), announce_ne: v("s-an-ne"), codAdvance: document.getElementById("s-cod").checked, lowStock: Math.max(0, Number(v("s-low")) || 0), happy_customers: Math.max(0, Math.round(Number(v("s-happy")) || 0)), pin };
      if (GT.server) {
        const btn = document.getElementById("s-save");
        btn.disabled = true;
        try { await pushSettings(next); } catch (e) { btn.disabled = false; toast(`Not saved: ${e.message}`); return; }
        btn.disabled = false;
        toast("Saved. Customers see the changes on their next page load.");
        renderSetup();
        return;
      }
      db.saveSettings(next);
      toast("Settings saved");
    });
    const wipes = {
      sample: ["Remove all sample orders?", "Remove", () => db.saveOrders(db.orders().filter((o) => !o.sample))],
      products: ["Replace your products with the 14 samples? Your own products and photos are removed.", "Reset products", () => { db.saveProducts(SEED.products); }],
      orders: ["Delete every order, including real ones? This can't be undone.", "Delete all orders", () => db.saveOrders([])]
    };
    document.querySelectorAll("[data-wipe]").forEach((b) => b.addEventListener("click", () => {
      const [msg, label, fn] = wipes[b.dataset.wipe];
      const zone = document.getElementById("wipe-confirm");
      zone.innerHTML = `<div class="confirm-strip"><span>${msg}</span><span style="display:flex;gap:8px"><button class="btn btn-secondary btn-sm" type="button" id="w-no">Cancel</button><button class="btn btn-sm" style="background:var(--danger);color:#fff" type="button" id="w-yes">${label}</button></span></div>`;
      document.getElementById("w-no").addEventListener("click", () => (zone.innerHTML = ""));
      document.getElementById("w-yes").addEventListener("click", () => { fn(); toast("Done"); renderSetup(); });
    }));
  };

  const renderReviews = async () => {
    shell("reviews", `<div class="main-head"><div><h1>Reviews</h1><p>Loading…</p></div></div>`);
    if (!GT.server) { shell("reviews", `<div class="main-head"><div><h1>Reviews</h1><p>Reviews need the shop server.</p></div></div>`); return; }
    let data;
    try { data = await GT.api("/api/admin/reviews", { key: ncmKey() }); }
    catch (err) { toast(err.message); return; }
    if (route() !== "reviews") return;
    const names = new Map(db.products().map((p) => [p.itemId, p.name]));
    const label = { pending: "Waiting", approved: "Showing", hidden: "Hidden" };
    const stars = (n) => "★".repeat(n) + "☆".repeat(5 - n);
    const waiting = data.reviews.filter((r) => r.status === "pending").length;
    shell("reviews", `
<div class="main-head"><div><h1>Reviews</h1><p>Customers can review items after delivery. A review shows on the shop only after you approve it.${waiting ? ` <strong>${waiting} waiting.</strong>` : ""}</p></div></div>
${data.reviews.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Item</th><th>Review</th><th>Status</th><th class="r"></th></tr></thead><tbody>
${data.reviews.map((r) => `<tr><td class="wrap-cell"><strong>${esc(names.get(r.item_id) || r.item_id)}</strong><div class="sub mono">${esc(r.order_id)}</div></td>
<td class="wrap-cell"><span aria-label="${r.stars} stars" style="color:var(--accent-text)">${stars(r.stars)}</span><div>${esc(r.body)}</div><div class="sub">${esc(r.name)} · ${fmtTime(r.at)}</div></td>
<td><span class="pill-s ${r.status === "approved" ? "s-delivered" : r.status === "pending" ? "s-payment_pending" : "s-cancelled"}">${label[r.status]}</span></td>
<td class="r" style="white-space:nowrap">${r.status !== "approved" ? `<button class="btn btn-primary btn-sm" type="button" data-rv="${r.id}" data-to="approved">Approve</button>` : ""} ${r.status !== "hidden" ? `<button class="btn btn-secondary btn-sm" type="button" data-rv="${r.id}" data-to="hidden">Hide</button>` : ""} <button class="text-btn" type="button" data-rv="${r.id}" data-to="delete">Delete</button></td></tr>`).join("")}
</tbody></table></div>` : `<section class="panel"><p class="muted">No reviews yet. Customers see a review form on the tracking page once their order is delivered.</p></section>`}`);
    document.querySelectorAll("[data-rv]").forEach((b) => b.addEventListener("click", async () => {
      b.disabled = true;
      try {
        if (b.dataset.to === "delete") await GT.api(`/api/admin/reviews/${b.dataset.rv}`, { method: "DELETE", key: ncmKey() });
        else await GT.api(`/api/admin/reviews/${b.dataset.rv}`, { method: "POST", key: ncmKey(), body: { status: b.dataset.to } });
        toast(b.dataset.to === "approved" ? "Review is now on the shop" : b.dataset.to === "hidden" ? "Review hidden" : "Review deleted");
        renderReviews();
      } catch (err) { toast(err.message); b.disabled = false; }
    }));
  };

  const render = () => {
    closeDrawer();
    if (!unlocked()) return renderLock();
    if (!GT.server) seedSampleOrders();
    syncServer();
    ({ overview: renderOverview, orders: renderOrders, products: renderProducts, catalog: renderCatalog, banners: renderBanners, rates: renderRates, reviews: renderReviews, setup: renderSetup })[route()]();
    scrollTo(0, 0);
  };
  addEventListener("hashchange", () => {
    if (Date.now() - syncedAt > 30000) synced = false;
    render();
  });
  render();
})();
