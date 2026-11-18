from pages import PAGES

PAGES["checkout.html"] = dict(
    title="Checkout | GifToyz Nepal",
    desc="Review your cart, choose delivery and pay.",
    extra_head='<meta name="robots" content="noindex">\n', body_class="",
    body="""<div id="site-header"></div>
<main id="root"></main>
<div id="site-footer"></div>""",
    script="""(() => {
  const { SEED, t, esc, rs, icon, art, media, productById, colorName, cart, waLink, db, idb, store, mountLocationPicker, copyText, hydrate } = GT;
  GT.init("");
  const root = document.getElementById("root");
  const settings = { ...db.settings(), ...(GT.server ? { codAdvance: !!GT.server.codAdvance } : {}) };
  const khaltiGateway = !!(GT.server && GT.server.khalti);
  const viaKhalti = () => khaltiGateway && state.wallet === "khalti";
  const tokenKey = (id) => `gt_tok_${id}`;
  const allWallets = [["esewa", "eSewa"], ["khalti", "Khalti"], ["bank", t("wallet_bank")]];
  const offered = allWallets.filter(([k]) => (k === "khalti" && khaltiGateway) || (settings.qr && settings.qr[k]));
  const wallets = offered.length ? offered : allWallets;
  const acct = (k) => (settings.qr_info && settings.qr_info[k]) || {};
  const newId = () => {
    const d = new Date();
    return `GT-${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${Math.floor(1000 + Math.random() * 9000)}`;
  };
  let orderId;
  try { orderId = sessionStorage.getItem("gt_pending_id") || newId(); sessionStorage.setItem("gt_pending_id", orderId); } catch { orderId = newId(); }
  const state = { loc: null, delivery: "home", mode: "cod", wallet: wallets[0][0], gift: false };
  const fee = () => (state.loc ? GT.weightedFee(state.delivery === "home" ? state.loc.home : state.loc.branch, cart.weight()) : 0);
  const payNow = () => {
    const total = cart.subtotal() + fee();
    if (state.mode === "full") return total;
    return settings.codAdvance ? fee() : 0;
  };

  const renderEmpty = () => {
    root.innerHTML = `<div class="wrap section"><div class="empty"><div class="empty-art">${art("teddy", "#C47A3D")}</div><h3>${t("cart_empty_t")}</h3><p>${t("cart_empty_d")}</p><a class="btn btn-primary" href="/products">${t("hero_cta")}</a></div></div>`;
  };

  const lines = cart.linesHtml;

  const paintSummary = () => {
    const sub = cart.subtotal();
    const total = sub + fee();
    const now = payNow();
    document.getElementById("lines").innerHTML = lines();
    document.getElementById("totals").innerHTML = `
      <div><span>${t("subtotal")}</span><span>${rs(sub)}</span></div>
      <div><span>${t("delivery")}</span><span>${state.loc ? rs(fee()) : `<span class="muted">${t("add_location")}</span>`}</span></div>
      ${cart.weight() > GT.FREE_KG ? `<div class="muted-row"><span>${t("heavy_parcel", { kg: cart.weight() })}</span><span></span></div>` : ""}
      <div class="grand"><span>${t("total")}</span><span>${rs(total)}</span></div>
      ${state.loc && now > 0 ? `<div class="now"><span>${t("pay_now_line")}</span><span>${rs(now)}</span></div>` : ""}
      ${state.loc && total - now > 0 ? `<div class="muted-row"><span>${t("pay_later_line")}</span><span>${rs(total - now)}</span></div>` : ""}`;
    const rule = document.getElementById("pay-rule");
    if (rule) {
      rule.textContent = !state.loc ? t("pick_loc_first") : state.mode === "full" ? t("full_rule", { total: rs(total) }) : t("cod_rule", { fee: rs(fee()), rest: rs(total - fee()) });
    }
    const amt = document.getElementById("amt-now");
    if (amt) amt.textContent = state.loc ? rs(now) : "—";
    document.getElementById("qr-block").hidden = now <= 0 && !!state.loc;
    hydrate(document.getElementById("lines"));
  };

  const paintQr = async () => {
    const manual = document.getElementById("qr-manual");
    const gateway = document.getElementById("khalti-note");
    if (manual) manual.hidden = viaKhalti();
    if (gateway) gateway.hidden = !viaKhalti();
    if (viaKhalti()) return;
    const info = acct(state.wallet);
    const box = document.getElementById("qr-acct");
    if (box) {
      box.hidden = !(info.name || info.number);
      box.innerHTML = `${info.bank ? `<div class="small muted">${esc(info.bank)}</div>` : ""}${info.name ? `<div class="label">${t("pay_acct_name")}</div><strong>${esc(info.name)}</strong>` : ""}${info.number ? `<div class="label" style="margin-top:6px">${t(state.wallet === "bank" ? "pay_acct_no" : "pay_acct_mobile")}</div><div class="copy-row"><code>${esc(info.number)}</code><button class="text-btn" type="button" data-copy="acct">${t("copy")}</button></div>` : ""}`;
    }
    const frame = document.getElementById("qr-frame");
    const label = wallets.find((w) => w[0] === state.wallet)[1];
    const imgId = settings.qr[state.wallet];
    const src = typeof imgId === "string" && imgId.startsWith("/media/") ? imgId : imgId ? await idb.get(imgId).then((b) => (b ? URL.createObjectURL(b) : null)) : null;
    frame.innerHTML = src ? `<img src="${esc(src)}" alt="${esc(t("qr_placeholder", { w: label }))}">` : `<div class="qr-empty">${icon("qr")}<span>${esc(t("qr_placeholder", { w: label }))}</span></div>`;
  };

  const renderForm = () => {
    if (!cart.items().length) return renderEmpty();
    if (settings.orders_paused) {
      root.innerHTML = `<div class="wrap section"><div class="empty"><div class="empty-art">${art("giftbox", "#F86808")}</div><h3>${t("paused_t")}</h3><p>${esc(GT.L(settings.pause_en, settings.pause_ne))}</p><a class="btn btn-wa" href="${waLink("Hi GifToyz, I'd like to order when you're back.")}" target="_blank" rel="noopener">${icon("chat")}<span>${t("c_open_wa")}</span></a></div></div>`;
      return;
    }
    root.innerHTML = `
<div class="wrap">
  <section class="page-head" style="padding-bottom:32px"><h1>${t("checkout")}</h1></section>
  <form class="checkout" id="form" novalidate>
    <div class="co-main">
      <section class="co-section">
        <h2><span class="step-n">1</span>${t("s_details")}</h2>
        <div class="form-grid">
          <div class="field full" data-f="name"><label for="f-name">${t("f_name")}</label><input class="input" id="f-name" autocomplete="name" maxlength="60"><span class="error" hidden></span></div>
          <div class="field" data-f="phone"><label for="f-phone">${t("f_phone")}</label><input class="input" id="f-phone" inputmode="numeric" autocomplete="tel" placeholder="98XXXXXXXX" maxlength="10"><span class="hint">${t("f_phone_hint")}</span><span class="error" hidden></span></div>
          <div class="field" data-f="phone2"><label for="f-phone2">${t("f_phone2")}</label><input class="input" id="f-phone2" inputmode="numeric" placeholder="97XXXXXXXX" maxlength="10"><span class="error" hidden></span></div>
        </div>
      </section>
      <section class="co-section">
        <h2><span class="step-n">2</span>${t("s_where")}</h2>
        <div class="field loc" data-f="loc">
          <label for="f-loc">${t("f_location")}</label>
          <input class="input" id="f-loc" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="f-loc-list" placeholder="${esc(t("loc_ph"))}">
          <div class="loc-list" id="f-loc-list" role="listbox" hidden></div>
          <span class="hint">${t("f_loc_hint")}</span><span class="error" hidden></span>
        </div>
        <div class="choice-grid" id="dchoice" hidden></div>
        <div class="field" data-f="address"><label for="f-address">${t("f_address")}</label><textarea class="textarea" id="f-address" maxlength="200" placeholder="${esc(t("f_address_ph"))}"></textarea><span class="error" hidden></span></div>
      </section>
      <section class="co-section">
        <h2><span class="step-n">3</span>${t("s_payment")}</h2>
        <div class="choice-grid">
          <label class="choice"><input type="radio" name="mode" value="cod" checked><span class="c-title">${t("pay_cod")}</span><span class="c-sub">${settings.codAdvance ? t("pay_cod_d") : ""}</span></label>
          <label class="choice"><input type="radio" name="mode" value="full"><span class="c-title">${t("pay_full")}</span><span class="c-sub">${t("pay_full_d")}</span></label>
        </div>
        <div class="note accent">${icon("info")}<span id="pay-rule"></span></div>
        <div id="qr-block" style="display:grid;gap:20px">
          <div class="seg" role="group" aria-label="Wallet">${wallets.map(([k, n]) => `<button type="button" data-wallet="${k}" aria-pressed="${k === state.wallet}">${n}</button>`).join("")}</div>
          <div class="note accent" id="khalti-note" hidden>${icon("shield")}<span>${t("khalti_gateway_note")}</span></div>
          <div id="qr-manual" style="display:grid;gap:20px">
          <div class="pay-qr">
            <div class="qr-frame" id="qr-frame"></div>
            <div style="display:grid;gap:14px;min-width:0">
              <div class="pay-acct" id="qr-acct" hidden></div>
              <div class="field"><span class="label">${t("amount_now")}</span><div class="copy-row"><code id="amt-now">—</code><button class="text-btn" type="button" data-copy="amt">${t("copy")}</button></div></div>
              <div class="field"><span class="label">${t("remark")}</span><div class="copy-row"><code>${orderId}</code><button class="text-btn" type="button" data-copy="ref">${t("copy")}</button></div></div>
              <p class="muted small">${t("scan_hint")}</p>
            </div>
          </div>
          <div class="form-grid">
            <div class="field full" data-f="txn"><label for="f-txn">${t("f_txn_opt")}</label><input class="input" id="f-txn" autocomplete="off" maxlength="40" placeholder="${esc(t("f_txn_ph"))}"><span class="hint">${t("shot_on_wa")}</span><span class="error" hidden></span></div>
          </div>
          <div class="note">${icon("shield")}<span>${t("verify_note")}</span></div>
          </div>
        </div>
      </section>
    </div>
    <aside class="summary">
      <h2>${t("your_order")}</h2>
      <div class="lines" id="lines"></div>
      <div class="totals" id="totals"></div>
      <div class="note danger" id="form-error" role="alert" hidden></div>
      <button class="btn btn-primary btn-block" type="submit" id="place">${t("place_order")}</button>
      <p class="muted small" style="text-align:center">${t("next_wa")}</p>
    </aside>
  </form>
</div>`;
    bind();
    paintSummary();
    paintQr();
  };

  const err = (k, m) => {
    const f = root.querySelector(`[data-f="${k}"]`);
    if (!f) return;
    f.classList.toggle("invalid", !!m);
    const e = f.querySelector(".error");
    e.hidden = !m;
    e.textContent = m || "";
  };

  const paintDelivery = () => {
    const box = document.getElementById("dchoice");
    box.hidden = !state.loc;
    if (state.loc) {
      box.innerHTML = `<label class="choice"><input type="radio" name="delivery" value="home" ${state.delivery === "home" ? "checked" : ""}><span class="c-title">${t("home_delivery")}<span class="c-price">${rs(GT.weightedFee(state.loc.home, cart.weight()))}</span></span><span class="c-sub">${t("rider_brings")}</span></label>
      <label class="choice"><input type="radio" name="delivery" value="branch" ${state.delivery === "branch" ? "checked" : ""}><span class="c-title">${t("branch_pickup")}<span class="c-price">${rs(GT.weightedFee(state.loc.branch, cart.weight()))}</span></span><span class="c-sub">${esc(t("collect_from", { p: state.loc.name }))}, ${t("save_n", { n: rs(GT.weightedFee(state.loc.home, cart.weight()) - GT.weightedFee(state.loc.branch, cart.weight())) })}</span></label>`;
    }
    paintSummary();
  };

  const bind = () => {
    const form = document.getElementById("form");
    mountLocationPicker({ input: document.getElementById("f-loc"), list: document.getElementById("f-loc-list"), onPick(row) { state.loc = row; if (row) err("loc", ""); paintDelivery(); } });
    form.addEventListener("change", (e) => {
      if (e.target.name === "delivery") { state.delivery = e.target.value; paintSummary(); }
      if (e.target.name === "mode") { state.mode = e.target.value; paintSummary(); }
    });
    ["f-phone", "f-phone2"].forEach((id) => document.getElementById(id).addEventListener("input", (e) => (e.target.value = e.target.value.replace(/\\D/g, "").slice(0, 10))));
    form.addEventListener("click", (e) => {
      const w = e.target.closest("[data-wallet]");
      if (w) { state.wallet = w.dataset.wallet; form.querySelectorAll("[data-wallet]").forEach((b) => b.setAttribute("aria-pressed", String(b === w))); paintQr(); }
      const c = e.target.closest("[data-copy]");
      if (c) copyText(c.dataset.copy === "ref" ? orderId : c.dataset.copy === "acct" ? (acct(state.wallet).number || "") : String(payNow()), c);
      const btn = e.target.closest("[data-dec],[data-inc],[data-remove]");
      if (btn) {
        const items = cart.change(btn);
        if (!items.length) return renderEmpty();
        paintDelivery();
        paintSummary();
      }
    });
    form.addEventListener("submit", (e) => { e.preventDefault(); submit(); });
  };

  const submit = async () => {
    const v = (id) => document.getElementById(id).value.trim();
    const needsPay = state.loc && payNow() > 0;
    const errors = {
      name: v("f-name").length < 2 ? t("e_name") : "",
      phone: /^9[678]\\d{8}$/.test(v("f-phone")) ? "" : t("e_phone"),
      phone2: !v("f-phone2") || /^9[678]\\d{8}$/.test(v("f-phone2")) ? "" : t("e_phone2"),
      loc: state.loc ? "" : t("e_loc"),
      address: v("f-address").length < 6 ? t("e_address") : "",
      txn: ""
    };
    Object.entries(errors).forEach(([k, m]) => err(k, m));
    const first = Object.entries(errors).find(([, m]) => m);
    if (first) {
      const f = root.querySelector(`[data-f="${first[0]}"]`);
      f.scrollIntoView({ behavior: "smooth", block: "center" });
      f.querySelector(".input,.textarea")?.focus({ preventScroll: true });
      return;
    }
    const formError = document.getElementById("form-error");
    formError.hidden = true;
    if (GT.server) {
      const place = document.getElementById("place");
      const label = place.textContent;
      place.disabled = true;
      place.textContent = t(viaKhalti() ? "khalti_starting" : "placing");
      try {
        const res = await GT.api("/api/orders", { method: "POST", body: {
          ref: orderId,
          items: cart.items().map((l) => ({ id: l.id, color: l.color, qty: l.qty })),
          name: v("f-name"), phone: v("f-phone"), phone2: v("f-phone2"),
          location_key: state.loc.key, district: state.loc.district || "", delivery: state.delivery,
          address: v("f-address"),
          gift: null,
          mode: state.mode, wallet: state.wallet, txn: viaKhalti() ? "" : v("f-txn"), lang: GT.lang()
        } });
        const o = { ...res.order, name: v("f-name"), phone: v("f-phone"), phone2: v("f-phone2"), address: v("f-address"),
          gift: null,
          payment: { ...res.order.payment, txn: viaKhalti() ? "" : v("f-txn") } };
        try { sessionStorage.setItem(tokenKey(o.id), res.token); localStorage.setItem(tokenKey(o.id), res.token); } catch {}
        const orders = db.orders().filter((x) => x.id !== o.id);
        orders.unshift(o);
        db.saveOrders(orders);
        cart.save([]);
        try { sessionStorage.removeItem("gt_pending_id"); } catch {}
        if (res.khalti && o.payment.paidNow > 0) {
          const pay = await GT.api("/api/payments/khalti/initiate", { method: "POST", body: { order_id: o.id, token: res.token } });
          location.href = pay.payment_url;
          return;
        }
        renderConfirm(o);
        scrollTo(0, 0);
      } catch (e) {
        formError.textContent = e.message;
        formError.hidden = false;
        place.disabled = false;
        place.textContent = label;
      }
      return;
    }
    let shotId = null;
    const file = document.getElementById("f-shot")?.files[0];
    if (file) { shotId = `shot-${orderId}`; try { await idb.put(shotId, file); } catch { shotId = null; } }
    const items = cart.items().map((l) => { const p = productById(l.id); return { id: p.id, name: p.name, color: l.color, qty: l.qty, price: p.price }; });
    const subtotal = cart.subtotal();
    const total = subtotal + fee();
    const now = payNow();
    const order = {
      id: orderId, createdAt: new Date().toISOString(), lang: GT.lang(),
      name: v("f-name"), phone: v("f-phone"), phone2: v("f-phone2"),
      location: { key: state.loc.key, name: state.loc.name, district: state.loc.district, type: state.delivery, fee: fee() },
      address: v("f-address"),
      gift: null,
      payment: { mode: state.mode, wallet: now > 0 ? state.wallet : null, txn: now > 0 ? v("f-txn") : "", paidNow: now, due: total - now, screenshot: shotId, verified: false },
      items, subtotal, total,
      status: now > 0 ? "payment_pending" : "received",
      history: [{ at: new Date().toISOString(), status: now > 0 ? "payment_pending" : "received" }]
    };
    const orders = db.orders();
    orders.unshift(order);
    db.saveOrders(orders);
    cart.save([]);
    try { sessionStorage.removeItem("gt_pending_id"); } catch {}
    renderConfirm(order);
    scrollTo(0, 0);
  };

  const walletName = (k) => (wallets.find((w) => w[0] === k) || [k, k])[1];
  const waMessage = (o) => [
    `New order ${o.id}`, "",
    `Name: ${o.name}`,
    `Phone: ${o.phone}${o.phone2 ? " / " + o.phone2 : ""}`,
    `Location: ${o.location.name}${o.location.district ? ", " + o.location.district : ""}`,
    `Delivery: ${o.location.type === "home" ? "Home delivery" : "NCM branch pickup"} (Rs ${o.location.fee})`,
    `Address: ${o.address}`, "",
    "Items:",
    ...o.items.map((i) => `- ${i.qty} x ${i.name} (${SEED.swatch[i.color]?.en || i.color}) Rs ${(i.price * i.qty).toLocaleString("en-IN")}`), "",
    `Total: Rs ${o.total.toLocaleString("en-IN")}`,
    o.payment.paidNow > 0 ? (o.payment.gateway === "khalti" ? `Paid now: Rs ${o.payment.paidNow.toLocaleString("en-IN")} by Khalti${o.payment.verified ? " (confirmed)" : " (not confirmed yet)"}` : `Paid now: Rs ${o.payment.paidNow.toLocaleString("en-IN")} by ${walletName(o.payment.wallet)}, transaction ID ${o.payment.txn}`) : "Paid now: nothing",
    o.payment.due > 0 ? `Cash on delivery: Rs ${o.payment.due.toLocaleString("en-IN")}` : "Cash on delivery: nothing, fully paid"
  ].filter((line, i, arr) => !(line === "" && arr[i - 1] === "")).join("\\n");

  const renderConfirm = (o, outcome = "") => {
    const manualPay = o.payment.paidNow > 0 && o.payment.gateway !== "khalti";
    const msg = waMessage(o) + (manualPay ? `\n\n${t("wa_paid_line", { amt: `Rs ${o.payment.paidNow.toLocaleString("en-IN")}`, w: walletName(o.payment.wallet) })}` : "");
    const banner = outcome === "success" ? `<div class="note success">${icon("check")}<span>${t("khalti_paid")}</span></div>`
      : outcome === "pending" ? `<div class="note accent">${icon("info")}<span>${t("khalti_pending")}</span></div>`
      : outcome === "failed" ? `<div class="note danger">${icon("info")}<span>${t("khalti_failed")}</span><button class="btn btn-secondary btn-sm" type="button" id="retry-pay">${t("khalti_retry")}</button></div>` : "";
    const n = o.items.reduce((s, i) => s + i.qty, 0);
    root.innerHTML = `
<div class="wrap narrow">
  <div class="confirm" style="padding-top:48px">
    <div>
      <p class="eyebrow">${t("almost_done")}</p>
      <h1 style="margin-top:10px">${t("order_saved")}</h1>
      <div class="order-id"><span>${o.id}</span><button class="text-btn" type="button" id="copy-id">${t("copy")}</button></div>
    </div>
    ${banner}
    <div class="wa-card">
      <h2>${t(manualPay ? "paid_step" : "last_step")}</h2>
      <p>${t(manualPay ? "paid_step_d" : "last_step_d")}</p>
      <div class="wa-preview">${esc(msg)}</div>
      <a class="btn btn-wa btn-block" href="${waLink(msg)}" target="_blank" rel="noopener">${icon("chat")}<span>${t(manualPay ? "i_paid" : "send_wa")}</span></a>
      <p class="muted small">${t("wa_fallback", { phone: settings.phone, id: o.id })}</p>
    </div>
    <div class="box">
      <h3>${t("next_title")}</h3>
      <ol class="timeline">
        <li class="done"><span class="t-dot">${icon("check")}</span><div><div class="t-title">${t("tl_saved")}</div><div class="t-sub">${t("tl_saved_d", { n, amt: rs(o.total) })}</div></div></li>
        <li class="now"><span class="t-dot">${icon("shield")}</span><div><div class="t-title">${t("tl_check")}</div><div class="t-sub">${o.payment.paidNow > 0 ? t("tl_check_d", { amt: rs(o.payment.paidNow), id: o.id }) : ""}</div></div></li>
        <li class="todo"><span class="t-dot">${icon("box")}</span><div><div class="t-title">${t("tl_ncm")}</div><div class="t-sub">${t("tl_ncm_d")}</div></div></li>
        <li class="todo"><span class="t-dot">${icon("truck")}</span><div><div class="t-title">${o.location.type === "home" ? t("tl_home") : esc(t("tl_branch", { p: o.location.name }))}</div><div class="t-sub">${o.payment.due > 0 ? t("tl_cash", { amt: rs(o.payment.due) }) : t("tl_paid")}</div></div></li>
      </ol>
    </div>
    <div style="display:flex;gap:12px;flex-wrap:wrap">${GT.server && readToken(o.id) && settings.bills_enabled ? `<a class="btn btn-secondary" href="/invoice/${encodeURIComponent(o.id)}?token=${encodeURIComponent(readToken(o.id))}" target="_blank" rel="noopener noreferrer">${icon("download")}<span>${t("dl_bill")}</span></a>` : ""}<a class="btn btn-primary" href="/track#${o.id}">${t("track_this")}</a><a class="btn btn-secondary" href="/products">${t("keep_shopping")}</a></div>
  </div>
</div>`;
    document.getElementById("copy-id").addEventListener("click", (e) => copyText(o.id, e.currentTarget));
    document.getElementById("retry-pay")?.addEventListener("click", async (e) => {
      e.currentTarget.disabled = true;
      try {
        const pay = await GT.api("/api/payments/khalti/initiate", { method: "POST", body: { order_id: o.id, token: readToken(o.id) } });
        location.href = pay.payment_url;
      } catch (err) { GT.toast(err.message); e.currentTarget.disabled = false; }
    });
  };

  const readToken = (id) => { try { return sessionStorage.getItem(tokenKey(id)) || localStorage.getItem(tokenKey(id)) || ""; } catch { return ""; } };
  const returned = new URLSearchParams(location.search);
  const returnedId = returned.get("order") || "";
  if (GT.server && /^GT-\d{6}-\d{4}$/.test(returnedId) && readToken(returnedId)) {
    root.innerHTML = `<div class="wrap narrow section"><div class="skeleton-stack"><div class="skeleton" style="height:40px;width:60%"></div><div class="skeleton" style="height:180px"></div></div></div>`;
    const local = db.orders().find((x) => x.id === returnedId) || {};
    const token = readToken(returnedId);
    const finish = (res, outcome) => {
      const o = { ...local, ...res.order, payment: { ...(local.payment || {}), ...res.order.payment } };
      const orders = db.orders().filter((x) => x.id !== o.id);
      orders.unshift(o);
      db.saveOrders(orders);
      renderConfirm(o, outcome);
      history.replaceState(null, "", "/checkout");
    };
    const outcome = returned.get("payment");
    (outcome === "success" ? GT.api(`/api/orders/${returnedId}?token=${encodeURIComponent(token)}`).then((r) => finish(r, "success"))
      : GT.api("/api/payments/khalti/verify", { method: "POST", body: { order_id: returnedId, token } }).then((r) => finish(r, r.payment)))
      .catch(() => { root.innerHTML = ""; renderForm(); GT.toast(t("khalti_check_failed")); });
  } else {
    renderForm();
  }
})();""",
)

PAGES["track.html"] = dict(
    title="Track your order | GifToyz Nepal",
    desc="Track your GifToyz order with your order number or NCM tracking number and phone number. Live delivery updates from Nepal Can Move.",
    extra_head="", body_class="",
    body="""<div id="site-header"></div>
<main>
  <div class="wrap track-layout">
  <div class="track-main">
    <div class="track-head">
      <p class="eyebrow" data-i18n="t_eyebrow"></p>
      <h1 data-i18n="t_title"></h1>
      <p class="lead" data-i18n="t_sub"></p>
      <p class="delivered-by"><span data-i18n="delivered_by"></span><img src="ncm-logo-128.png" srcset="ncm-logo-128.png 1x, ncm-logo-256.png 2x" alt="" width="32" height="32"><strong>Nepal Can Move</strong></p>
    </div>
  <div class="track-body">
    <form class="box" id="form" novalidate>
      <div class="form-grid">
        <div class="field" data-f="id"><label for="t-id" data-i18n="t_q"></label><input class="input" id="t-id" autocomplete="off" autocapitalize="characters" spellcheck="false" data-i18n-ph="t_q_ph" style="text-transform:uppercase"><span class="hint" data-i18n="t_q_hint"></span><span class="error" hidden></span></div>
        <div class="field" data-f="phone"><label for="t-phone" data-i18n="f_phone"></label><input class="input" id="t-phone" inputmode="numeric" autocomplete="tel" maxlength="10" placeholder="98XXXXXXXX"><span class="error" hidden></span></div>
      </div>
      <div><button class="btn btn-primary" type="submit" id="t-btn" data-i18n="t_btn"></button></div>
    </form>
    <div id="result" aria-live="polite"></div>
  </div>
  </div>
  <aside class="partner-card" aria-labelledby="partner-title">
    <picture>
      <source type="image/avif" srcset="ncm-banner-480.avif 480w, ncm-banner-960.avif 960w" sizes="(max-width: 920px) 100vw, 360px">
      <source type="image/webp" srcset="ncm-banner-480.webp 480w, ncm-banner-960.webp 960w" sizes="(max-width: 920px) 100vw, 360px">
      <img src="ncm-banner-480.jpg" srcset="ncm-banner-480.jpg 480w, ncm-banner-960.jpg 960w" sizes="(max-width: 920px) 100vw, 360px" width="960" height="960" loading="lazy" decoding="async" alt="Nepal Can Move: the first courier to reach every municipality in all 7 provinces and 77 districts">
    </picture>
    <div class="partner-body">
      <div class="partner-head"><img src="ncm-logo-128.png" srcset="ncm-logo-128.png 1x, ncm-logo-256.png 2x" alt="Nepal Can Move logo" width="44" height="44"><div><p class="eyebrow" data-i18n="partner_eyebrow"></p><h2 id="partner-title">Nepal Can Move</h2></div></div>
      <p class="muted" data-i18n="partner_d"></p>
      <ul class="partner-points">
        <li data-i18n="partner_p1"></li>
        <li data-i18n="partner_p2"></li>
        <li data-i18n="partner_p3"></li>
      </ul>
    </div>
  </aside>
  </div>
</main>
<div id="site-footer"></div>""",
    script="""(() => {
  const { t, esc, rs, icon, db, waLink, colorName } = GT;
  GT.init("track");
  const form = document.getElementById("form");
  const result = document.getElementById("result");
  const btn = document.getElementById("t-btn");
  const FLOW = ["received", "confirmed", "with_ncm", "in_transit", "delivered"];
  const ICONS = { received: "check", confirmed: "shield", with_ncm: "box", in_transit: "truck", delivered: "gift" };
  const ORDER_RE = /^GT-\\d{6}-\\d{4}$/, AWB_RE = /^\\d{4,12}$/, PHONE_RE = /^9[678]\\d{8}$/;


  const fmt = (iso) => { const d = new Date(iso); return isNaN(d) ? esc(iso) : d.toLocaleString(GT.lang() === "ne" ? "ne-NP" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); };

  const stepper = (o) => {
    if (o.status === "cancelled") return `<ol class="stepper"><li class="done"><span class="s-dot">${icon("check")}</span><span class="s-label">${t("st_received")}</span></li><li class="bad"><span class="s-dot">${icon("x")}</span><span class="s-label">${t("st_cancelled")}</span></li></ol>`;
    const at = o.status === "payment_pending" ? 1 : FLOW.indexOf(o.status);
    const when = {};
    (o.history || []).forEach((h) => (when[h.status === "payment_pending" ? "received" : h.status] = h.at));
    return `<ol class="stepper">${FLOW.map((s, i) => {
      const cls = i < at ? "done" : i === at ? (s === "delivered" ? "done" : "now") : "todo";
      const key = o.status === "payment_pending" && s === "confirmed" ? "st_payment_pending" : "st_" + s;
      const label = t(key);
      return `<li class="${cls}"${i === at ? ' aria-current="step"' : ""}><span class="s-dot">${icon(cls === "todo" ? ICONS[s] : cls === "now" ? ICONS[s] : "check")}</span><span class="s-label">${label}</span>${when[s] ? `<span class="s-time">${fmt(when[s])}</span>` : `<span class="s-time">${t(key + "_d")}</span>`}</li>`;
    }).join("")}</ol>`;
  };

  const orderBox = (o, awb) => `
<div class="box track-card">
  <div class="track-card-head">
    <div><p class="eyebrow">${t("order_no")}</p><h2 class="mono">${esc(o.id)}</h2></div>
    ${awb ? `<div class="awb"><p class="eyebrow">${t("awb")}</p><span class="mono">${esc(awb)}</span></div>` : ""}
  </div>
  ${stepper(o)}
  ${o.items ? `<div class="totals">
    ${o.items.map((i) => `<div><span>${i.qty} x ${esc(i.name)} · ${esc(colorName(i.color))}</span><span>${rs(i.price * i.qty)}</span></div>`).join("")}
    <div><span>${esc(t("delivery_to", { p: o.location.name, t: t(o.location.type === "home" ? "type_home" : "type_branch") }))}</span><span>${rs(o.location.fee)}</span></div>
    <div class="grand"><span>${t("total")}</span><span>${rs(o.total)}</span></div>
    ${o.payment.paidNow > 0 ? `<div class="muted-row"><span>${t("paid_now")}</span><span>${rs(o.payment.paidNow)}</span></div>` : ""}
    ${o.payment.due > 0 ? `<div class="muted-row"><span>${t("due_on_delivery")}</span><span>${rs(o.payment.due)}</span></div>` : ""}
  </div>` : ""}
</div>`;

  const liveBox = (list, live, branch, checked) => `
<div class="box track-live">
  <div class="track-card-head"><h3>${t("ncm_live")}</h3>${live ? `<span class="live-dot">${t("live")}</span>` : checked ? `<span class="muted small">${esc(t("ncm_checked", { d: fmt(checked) }))}</span>` : ""}</div>
  ${branch && branch.name ? `<p class="ncm-branch">${icon("pin")}<span>${esc(t("ncm_branch", { b: branch.name }))}${branch.phone ? ` · <a href="tel:${esc(branch.phone.replace(/[^0-9+]/g, ""))}">${esc(branch.phone)}</a>` : ""}</span></p>` : ""}
  ${!live && !list.length ? `<p class="muted">${t("live_unavailable")}</p>` : list.length ? `<ol class="timeline">${list.map((x, i) => `<li class="${i === 0 ? "now" : "done"}"><span class="t-dot">${icon(i === 0 ? "truck" : "check")}</span><div><div class="t-title">${esc(x.status)}</div><div class="t-sub">${esc(x.at)}</div></div></li>`).join("")}</ol>` : `<p class="muted">${t("ncm_none")}</p>`}
</div>`;

  const help = (id) => `<div><a class="btn btn-secondary" href="${waLink(`Hi GifToyz, I have a question about order ${id}.`)}" target="_blank" rel="noopener">${icon("chat")}<span>${t("ask_order")}</span></a></div>`;
  const notFound = (id) => {
    result.innerHTML = `<div class="box"><h2 style="font-size:20px">${esc(t("not_found_order", { id }))}</h2><p class="muted">${t("not_found_order_d")}</p><div><a class="btn btn-secondary" href="${waLink(`Hi GifToyz, can you check my order ${id}?`)}" target="_blank" rel="noopener">${icon("chat")}<span>${t("msg_us")}</span></a></div></div>`;
  };
  const skeleton = () => {
    result.innerHTML = `<div class="box track-card" aria-busy="true"><div class="skeleton" style="height:22px;width:40%"></div><div class="skeleton-steps">${FLOW.map(() => '<span class="skeleton s-circle"></span>').join("")}</div><div class="skeleton" style="height:14px;width:80%"></div><div class="skeleton" style="height:14px;width:60%"></div></div>`;
  };
  const set = (k, m) => { const f = form.querySelector(`[data-f="${k}"]`); f.classList.toggle("invalid", !!m); const e = f.querySelector(".error"); e.hidden = !m; e.textContent = m; };

  const rateBox = (o) => {
    const items = [...new Map(o.items.filter((i) => i.itemId).map((i) => [i.itemId, i])).values()];
    if (!items.length) return "";
    return `<section class="panel rate-box"><h2>${esc(t("rate_t"))}</h2><p class="muted small">${esc(t("rate_d"))}</p>${items.map((i) => `<form class="rate-form" data-item="${esc(i.itemId)}" novalidate>
      <p><strong>${esc(i.name)}</strong></p>
      <div class="star-pick" role="radiogroup">${[5, 4, 3, 2, 1].map((n) => `<label><input type="radio" name="stars" value="${n}" ${n === 5 ? "checked" : ""}><span aria-label="${esc(t("rate_stars", { n }))}">${icon("star")}</span></label>`).join("")}</div>
      <div class="field"><label>${esc(t("rate_name"))}</label><input class="input" name="name" maxlength="40" required></div>
      <div class="field"><label>${esc(t("rate_body"))}</label><textarea class="input" name="body" rows="3" maxlength="600" required></textarea></div>
      <p class="error" hidden></p><button class="btn btn-primary" type="submit">${esc(t("rate_send"))}</button></form>`).join("")}</section>`;
  };
  const wireRate = (o, phone) => result.querySelectorAll(".rate-form").forEach((f) => f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = f.querySelector(".error");
    const btn = f.querySelector("button");
    btn.disabled = true;
    err.hidden = true;
    try {
      await GT.api("/api/reviews", { method: "POST", body: { item_id: f.dataset.item, order_id: o.id, phone, name: f.name.value.trim(), stars: Number(f.stars.value), body: f.body.value.trim() } });
      f.innerHTML = `<p class="note">${icon("check")}<span>${esc(t("rate_thanks"))}</span></p>`;
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      btn.disabled = false;
    }
  }));

  let seq = 0;
  const lookup = async (q, phone) => {
    const run = ++seq;
    const local = ORDER_RE.test(q) ? db.orders().find((x) => x.id === q && x.phone === phone) : null;
    if (!GT.server) {
      if (local) result.innerHTML = orderBox(local) + help(local.id); else notFound(q);
      return;
    }
    skeleton();
    btn.disabled = true;
    try {
      const data = await GT.api(`/api/track?${new URLSearchParams({ q, phone })}`);
      if (run !== seq) return;
      const o = data.order || local;
      result.innerHTML = (o ? orderBox(o, data.awb) : "") + (data.awb ? liveBox(data.statuses, data.live, data.branch, data.checked) : "") + (data.order && data.order.status === "delivered" ? rateBox(data.order) : "") + help(data.ref);
      if (data.order && data.order.status === "delivered") wireRate(data.order, phone);
    } catch (e) {
      if (run !== seq) return;
      if (e.status === 404) { if (local) result.innerHTML = orderBox(local) + help(local.id); else notFound(q); }
      else result.innerHTML = `<div class="note danger">${icon("info")}<span>${esc(e.message)}</span></div>` + (local ? orderBox(local) : "");
    } finally {
      if (run === seq) btn.disabled = false;
    }
  };

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = document.getElementById("t-id").value.trim().toUpperCase().replace(/\\s+/g, "");
    const phone = document.getElementById("t-phone").value.trim();
    const okQ = ORDER_RE.test(q) || AWB_RE.test(q), okPhone = PHONE_RE.test(phone);
    set("id", okQ ? "" : t("e_track_q"));
    set("phone", okPhone ? "" : t("e_track_phone"));
    if (okQ && okPhone) lookup(q, phone);
  });
  document.getElementById("t-phone").addEventListener("input", (e) => (e.target.value = e.target.value.replace(/\\D/g, "").slice(0, 10)));
  const h = decodeURIComponent(location.hash.slice(1)).toUpperCase();
  if (ORDER_RE.test(h)) {
    document.getElementById("t-id").value = h;
    const o = db.orders().find((x) => x.id === h);
    if (o) { document.getElementById("t-phone").value = o.phone; lookup(h, o.phone); }
  }
})();""",
)

PAGES["about.html"] = dict(
    title="About | GifToyz Nepal",
    desc="GifToyz Nepal is a small gift and toy shop that checks and packs every order by hand and delivers across Nepal.",
    extra_head="", body_class="",
    body="""<div id="site-header"></div>
<main>
  <section class="wrap about-hero">
    <div>
      <p class="eyebrow" data-i18n="about_eyebrow"></p>
      <h1 data-i18n="about_title"></h1>
      <p class="lead" data-i18n="about_lead"></p>
    </div>
    <figure class="about-cover"><picture>
      <source type="image/avif" srcset="about-cover-600.avif 600w, about-cover-1024.avif 1024w" sizes="(max-width: 880px) 100vw, 560px">
      <source type="image/webp" srcset="about-cover-600.webp 600w, about-cover-1024.webp 1024w" sizes="(max-width: 880px) 100vw, 560px">
      <img src="about-cover-1024.jpg" srcset="about-cover-600.jpg 600w, about-cover-1024.jpg 1024w" sizes="(max-width: 880px) 100vw, 560px" width="1024" height="1024" fetchpriority="high" decoding="async" alt="GifToyz gifts and lifestyle: teddies, Stitch and Hello Kitty plush toys, tumblers and gift boxes on a wooden table">
    </picture></figure>
  </section>
  <section class="section surface-band">
    <div class="wrap">
      <div class="section-head"><h2 data-i18n="values_title"></h2></div>
      <div class="values" id="values"></div>
    </div>
  </section>
  <section class="section">
    <div class="wrap">
      <div class="prose">
        <h2 data-i18n="journey_title"></h2>
        <p data-i18n="journey_1"></p>
        <p data-i18n="journey_2"></p>
        <p data-i18n="journey_3"></p>
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:36px">
        <a class="btn btn-primary" href="/products" data-i18n="hero_cta"></a>
        <a class="btn btn-secondary" href="/contact" data-i18n="nav_contact"></a>
      </div>
    </div>
  </section>
</main>
<div id="site-footer"></div>""",
    script="""(() => {
  const { t, icon, artGroup } = GT;
  GT.init("about");
  document.getElementById("values").innerHTML = [["gift", "v1"], ["shield", "v2"], ["chat", "v3"]].map(([i, k]) => `<div class="value"><span class="ti">${icon(i)}</span><h3>${t(k + "_t")}</h3><p>${t(k + "_d")}</p></div>`).join("");
})();""",
)

PAGES["contact.html"] = dict(
    title="Contact | GifToyz Nepal",
    desc="Contact GifToyz Nepal on WhatsApp, phone or Instagram. Based in Kathmandu, delivering across Nepal.",
    extra_head="", body_class="",
    body="""<div id="site-header"></div>
<main>
  <section class="page-head">
    <div class="wrap">
      <h1 data-i18n="contact_title"></h1>
      <p class="lead" data-i18n="contact_lead"></p>
    </div>
  </section>
  <div class="wrap contact">
    <div style="min-width:0">
      <div class="c-list" id="cards"></div>
      <form class="msg-form" id="msg" novalidate>
        <div><h2 data-i18n="c_form_t"></h2><p class="muted" style="margin-top:6px" data-i18n="c_form_d"></p></div>
        <div class="form-grid">
          <div class="field" data-f="name"><label for="m-name" data-i18n="c_name"></label><input class="input" id="m-name" autocomplete="name" maxlength="60"><span class="error" hidden></span></div>
          <div class="field"><label for="m-topic" data-i18n="c_topic"></label><select class="input select" id="m-topic" style="border-radius:12px;height:48px"></select></div>
          <div class="field full" data-f="msg"><label for="m-msg" data-i18n="c_msg"></label><textarea class="textarea" id="m-msg" maxlength="500" data-i18n-ph="c_msg_ph"></textarea><span class="error" hidden></span></div>
        </div>
        <div><a class="btn btn-wa" id="m-send" target="_blank" rel="noopener" href="#"><span data-i18n="c_send"></span></a></div>
      </form>
    </div>
    <div class="map-card">
      <svg viewBox="0 0 640 460" role="img" aria-label="Kathmandu" id="map"></svg>
      <div class="map-foot"><span><strong data-i18n="map_caption"></strong> <span class="muted" data-i18n="map_sub"></span></span><a class="text-link" href="/help#delivery" data-i18n="see_rates"></a></div>
    </div>
  </div>
</main>
<div id="site-footer"></div>""",
    script="""(() => {
  const { t, esc, icon, waLink, copyText, db } = GT;
  GT.init("contact");
  const s = db.settings();
  document.getElementById("cards").innerHTML = `
    <div class="c-item"><span class="ti">${icon("chat")}</span><div style="min-width:0"><h3>${t("c_wa")}</h3><div class="c-value">${esc(s.phone)}</div><div class="c-actions"><a class="btn btn-wa btn-sm" href="${waLink("Hi GifToyz")}" target="_blank" rel="noopener">${t("c_open_wa")}</a><button class="btn btn-secondary btn-sm" type="button" id="copy-phone">${t("c_copy_no")}</button></div></div></div>
    <div class="c-item"><span class="ti">${icon("camera")}</span><div><h3>${t("c_ig")}</h3><div class="c-value">@${esc(s.instagram)}</div><div class="c-actions"><a class="btn btn-ig btn-sm" href="https://www.instagram.com/${esc(s.instagram)}/" target="_blank" rel="noopener">${t("c_open_ig")}</a></div></div></div>
    ${s.tiktok ? `<div class="c-item"><span class="ti">${icon("music")}</span><div><h3>TikTok</h3><div class="c-value">@${esc(s.tiktok)}</div><div class="c-actions"><a class="btn btn-tt btn-sm" href="https://www.tiktok.com/@${esc(s.tiktok)}" target="_blank" rel="noopener">${t("c_open_tt")}</a></div></div></div>` : ""}
    ${s.facebook ? `<div class="c-item"><span class="ti">${icon("user")}</span><div><h3>Facebook</h3><div class="c-value">${esc(s.facebook)}</div><div class="c-actions"><a class="btn btn-fb btn-sm" href="https://www.facebook.com/${esc(s.facebook)}" target="_blank" rel="noopener">${t("c_open_fb")}</a></div></div></div>` : ""}
    ${s.email ? `<div class="c-item"><span class="ti">${icon("mail")}</span><div><h3>${t("c_email")}</h3><div class="c-value"><a href="mailto:${esc(s.email)}">${esc(s.email)}</a></div></div></div>` : ""}
    <div class="c-item"><span class="ti">${icon("pin")}</span><div><h3>${t("c_where")}</h3><p>${t("c_where_d")}</p></div></div>
    <div class="c-item"><span class="ti">${icon("clock")}</span><div><h3>${t("c_when")}</h3><p>${esc(GT.L(s.hours_en, s.hours_ne) || t("c_when_d"))}</p></div></div>`;
  document.getElementById("copy-phone").addEventListener("click", (e) => copyText(s.phone, e.currentTarget));
  document.getElementById("m-topic").innerHTML = ["c_t1", "c_t2", "c_t3", "c_t4"].map((k) => `<option>${t(k)}</option>`).join("");
  const send = document.getElementById("m-send");
  const update = () => { send.href = waLink(t("c_wa_msg", { n: document.getElementById("m-name").value.trim() || t("a_customer"), t: document.getElementById("m-topic").value, m: document.getElementById("m-msg").value.trim() })); };
  document.getElementById("msg").addEventListener("input", update);
  document.getElementById("msg").addEventListener("submit", (e) => e.preventDefault());
  send.addEventListener("click", (e) => {
    const set = (k, m) => { const f = document.querySelector(`[data-f="${k}"]`); f.classList.toggle("invalid", !!m); const er = f.querySelector(".error"); er.hidden = !m; er.textContent = m; };
    const okN = document.getElementById("m-name").value.trim().length >= 2, okM = document.getElementById("m-msg").value.trim().length >= 5;
    set("name", okN ? "" : t("c_e_name")); set("msg", okM ? "" : t("c_e_msg"));
    if (!okN || !okM) e.preventDefault();
  });
  update();
  const ne = GT.lang() === "ne";
  const areas = [["Balaju", "बालाजु", 214, 92], ["Swayambhu", "स्वयम्भू", 150, 176], ["Thamel", "ठमेल", 262, 160], ["Kalanki", "कलंकी", 104, 262], ["New Road", "न्युरोड", 268, 246], ["Chabahil", "चाबहिल", 452, 142], ["Boudha", "बौद्ध", 548, 128], ["Baneshwor", "बानेश्वर", 408, 276], ["Koteshwor", "कोटेश्वर", 486, 334], ["Patan", "पाटन", 300, 372], ["Kirtipur", "कीर्तिपुर", 150, 360]];
  const ring = "M150 112 C240 52 430 56 510 128 C576 190 574 304 500 356 C426 408 232 414 160 352 C92 294 84 168 150 112 Z";
  document.getElementById("map").innerHTML = `
    <rect width="640" height="460" fill="var(--surface)"/>
    <g stroke="var(--text)" stroke-opacity="0.07" stroke-width="1.5" fill="none">${Array.from({ length: 9 }, (_, i) => `<path d="M0 ${40 + i * 50} L640 ${20 + i * 52}"/>`).join("")}${Array.from({ length: 11 }, (_, i) => `<path d="M${30 + i * 60} 0 L${10 + i * 62} 460"/>`).join("")}</g>
    <rect x="300" y="200" width="54" height="34" rx="8" fill="#A8DCC6" opacity="0.55"/>
    <rect x="128" y="300" width="70" height="40" rx="10" fill="#A8DCC6" opacity="0.55"/>
    <path d="M232 0 C236 90 206 170 262 236 C300 282 336 290 360 300" fill="none" stroke="#A9CDEB" stroke-width="10" stroke-linecap="round"/>
    <path d="M560 40 C470 120 430 190 400 250 C372 304 350 330 330 460" fill="none" stroke="#A9CDEB" stroke-width="12" stroke-linecap="round"/>
    <path d="${ring}" fill="none" stroke="var(--text)" stroke-opacity="0.18" stroke-width="18"/>
    <path d="${ring}" fill="none" stroke="var(--bg)" stroke-width="13"/>
    <text x="520" y="214" font-family="Inter, Noto Sans Devanagari, sans-serif" font-size="11" font-weight="600" fill="var(--text-3)" transform="rotate(78 520 214)" letter-spacing="2">${esc(t("ring_road"))}</text>
    ${areas.map(([en, n, x, y]) => `<circle cx="${x}" cy="${y}" r="3.5" fill="var(--text-3)"/><text x="${x + 9}" y="${y + 4}" font-family="Inter, Noto Sans Devanagari, sans-serif" font-size="13" font-weight="500" fill="var(--text-2)">${ne ? n : en}</text>`).join("")}
    <g transform="translate(330 228)">
      <ellipse cx="0" cy="3" rx="14" ry="5" fill="#000" opacity="0.15"/>
      <path d="M0 0 C-10 -16 -24 -27 -24 -44 A24 24 0 0 1 24 -44 C24 -27 10 -16 0 0 Z" fill="#F86808"/>
      <circle cx="0" cy="-44" r="8" fill="#fff"/>
      <g transform="translate(-54 -106)"><rect width="108" height="34" rx="17" fill="var(--text)"/><text x="54" y="22" text-anchor="middle" font-family="Inter, sans-serif" font-size="15" font-weight="600" fill="var(--bg)">GifToyz</text></g>
    </g>
    <g transform="translate(596 46)"><circle r="20" fill="var(--bg)"/><path d="M0 -12 L6 4 L0 0 L-6 4 Z" fill="#F86808"/><text y="15" text-anchor="middle" font-family="Inter, sans-serif" font-size="9" font-weight="700" fill="var(--text-2)">N</text></g>
    <text x="20" y="440" font-family="Inter, Noto Sans Devanagari, sans-serif" font-size="12" fill="var(--text-3)">${esc(t("map_note"))}</text>`;
})();""",
)

PAGES["help.html"] = dict(
    title="Help and delivery rates | GifToyz Nepal",
    desc="How to order from GifToyz, payment options, Nepal Can Move delivery rates for 300+ places, tracking, returns, privacy and terms.",
    extra_head="", body_class="",
    body="""<div id="site-header"></div>
<main>
  <section class="page-head">
    <div class="wrap">
      <h1 data-i18n="help_title"></h1>
      <p class="lead" data-i18n="help_lead"></p>
    </div>
  </section>
  <div class="wrap docs">
    <nav class="toc" id="toc" aria-label="On this page"></nav>
    <div class="doc-body">
      <section class="doc-section" id="how-to-order"><h2 data-i18n="toc_order"></h2><ol><li data-i18n="h_order_1"></li><li data-i18n="h_order_2"></li><li data-i18n="h_order_3"></li><li data-i18n="h_order_4"></li><li data-i18n="h_order_5"></li></ol><p data-i18n="h_order_chat"></p></section>
      <section class="doc-section" id="payment"><h2 data-i18n="toc_payment"></h2><h3 data-i18n="h_pay_full_t"></h3><p data-i18n="h_pay_full"></p><h3 data-i18n="h_pay_cod_t"></h3><p data-i18n="h_pay_cod"></p><p data-i18n="h_pay_check"></p><div class="note accent" id="pay-warn"></div></section>
      <section class="doc-section" id="delivery">
        <h2 data-i18n="toc_delivery"></h2><p data-i18n="h_rates"></p>
        <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap"><input class="input" id="rate-q" type="search" style="max-width:380px" data-i18n-ph="rate_search" aria-label="Search places"><span class="muted small num" id="rate-count" role="status"></span></div>
        <div class="table-wrap"><table class="data"><thead><tr><th data-i18n="rate_place"></th><th data-i18n="rate_district"></th><th class="r" data-i18n="rate_home"></th><th class="r" data-i18n="rate_branch"></th></tr></thead><tbody id="rate-body"></tbody></table></div>
        <p class="muted small" data-i18n="h_rates_note"></p>
      </section>
      <section class="doc-section" id="tracking"><h2 data-i18n="toc_tracking"></h2><p data-i18n="h_tracking"></p><div><a class="text-link" href="/track" data-i18n="track"></a></div></section>
      <section class="doc-section" id="returns"><h2 data-i18n="toc_returns"></h2><p data-i18n="h_returns_1"></p><p data-i18n="h_returns_2"></p></section>
      <section class="doc-section" id="faq"><h2 data-i18n="toc_faq"></h2><div id="faq-list"></div></section>
      <section class="doc-section" id="privacy"><h2 data-i18n="toc_privacy"></h2><p data-i18n="h_privacy_1"></p><p data-i18n="h_privacy_2"></p></section>
      <section class="doc-section" id="terms"><h2 data-i18n="toc_terms"></h2><ul><li data-i18n="h_terms_1"></li><li data-i18n="h_terms_2"></li><li data-i18n="h_terms_3"></li><li data-i18n="h_terms_4"></li></ul></section>
    </div>
  </div>
</main>
<div id="site-footer"></div>""",
    script="""(() => {
  const { t, esc, rs, icon, db } = GT;
  GT.init("help");
  const toc = [["how-to-order", "toc_order"], ["payment", "toc_payment"], ["delivery", "toc_delivery"], ["tracking", "toc_tracking"], ["returns", "toc_returns"], ["faq", "toc_faq"], ["privacy", "toc_privacy"], ["terms", "toc_terms"]];
  document.getElementById("toc").innerHTML = toc.map(([id, k]) => `<a href="#${id}">${t(k)}</a>`).join("");
  document.getElementById("pay-warn").innerHTML = `${icon("shield")}<span>${esc(t("h_pay_warn", { phone: db.settings().phone }))}</span>`;
  document.getElementById("faq-list").innerHTML = [1, 2, 3, 4].map((n) => `<details class="acc"><summary>${t(`faq${n}_q`)}${icon("plus")}</summary><div class="acc-body"><p>${t(`faq${n}_a`)}</p></div></details>`).join("");
  const rows = db.rates().slice().sort((a, b) => a.name.localeCompare(b.name));
  const body = document.getElementById("rate-body"), count = document.getElementById("rate-count");
  const render = (q) => {
    const query = q.trim().toLowerCase();
    const m = rows.filter((r) => !query || r.name.toLowerCase().includes(query) || (r.district || "").toLowerCase().includes(query));
    body.innerHTML = m.length ? m.map((r) => `<tr><td>${esc(r.name)}</td><td class="muted">${esc(r.district || "")}</td><td class="r">${rs(r.home)}</td><td class="r">${rs(r.branch)}</td></tr>`).join("") : `<tr><td colspan="4" class="muted">${esc(t("rate_none", { q }))}</td></tr>`;
    count.textContent = t("rate_count", { n: m.length, t: rows.length });
  };
  document.getElementById("rate-q").addEventListener("input", (e) => render(e.target.value));
  render("");
  const links = [...document.querySelectorAll("#toc a")];
  const secs = links.map((a) => document.querySelector(a.getAttribute("href")));
  const spy = () => { let c = 0; secs.forEach((s, i) => { if (s.getBoundingClientRect().top < 140) c = i; }); links.forEach((a, i) => a.classList.toggle("active", i === c)); };
  addEventListener("scroll", spy, { passive: true }); spy();
})();""",
)
