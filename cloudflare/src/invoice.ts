import { esc } from "./seo";

const NPT_MS = (5 * 60 + 45) * 60 * 1000;
const STATUS: Record<string, string> = {
  payment_pending: "Checking payment",
  received: "Received",
  confirmed: "Confirmed",
  with_ncm: "Handed to NCM",
  in_transit: "On the way",
  delivered: "Delivered",
  cancelled: "Cancelled",
};
const WALLETS: Record<string, string> = { esewa: "eSewa", khalti: "Khalti", bank: "Bank QR" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const e = (v: unknown) => esc(String(v ?? ""));
const rs = (v: unknown) => `Rs ${Math.trunc(Number(v) || 0).toLocaleString("en-US")}`;

export function billDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const d = new Date(t + NPT_MS);
  const h = d.getUTCHours();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(h % 12 || 12)}:${pad(d.getUTCMinutes())} ${h < 12 ? "AM" : "PM"}`;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function renderInvoice(order: any, shop: { phone?: string; email?: string }, colours: Map<string, string>): string {
  const pay = order.payment;
  const loc = order.location;
  let method =
    pay.paidNow <= 0 ? "Cash on delivery" : pay.gateway === "khalti" ? "Khalti (online)" : WALLETS[pay.wallet ?? ""] ?? "Online payment";
  if (pay.paidNow > 0 && pay.due > 0) method += " + cash on delivery";
  const rows = order.items
    .map(
      (i: any) =>
        `<tr><td>${e(i.name)}<div class='muted'>${e(colours.get(i.color) ?? i.color)}</div></td>` +
        `<td class='r'>${Math.trunc(i.qty)}</td><td class='r'>${rs(i.price)}</td><td class='r'>${rs(i.price * i.qty)}</td></tr>`,
    )
    .join("");
  const phones = e(order.phone) + (order.phone2 ? `, ${e(order.phone2)}` : "");
  const contact = [e(shop.phone), e(shop.email), "giftoyz.np on Instagram"].filter(Boolean).join(" · ");
  const paidLabel = pay.verified ? "Paid" : "Paid (being checked)";
  const paidRow = pay.paidNow > 0 ? `<div><span>${paidLabel} by ${e(method.split(" +")[0])}</span><span>${rs(pay.paidNow)}</span></div>` : "";
  const dueRow =
    pay.due > 0
      ? `<div class='due'><span>Pay on delivery</span><span>${rs(pay.due)}</span></div>`
      : "<div><span>Balance</span><span>Fully paid</span></div>";
  const district = loc.district ? `, ${e(loc.district)}` : "";
  const ncm = order.ncm ? ` · NCM no. ${e(order.ncm.id)}` : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer">
<title>Bill ${e(order.id)} | GifToyz Nepal</title>
<link rel="icon" href="/favicon.ico" sizes="any">
<style>
*{box-sizing:border-box}body{margin:0;background:#f5f5f7;color:#1d1d1f;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans Devanagari",sans-serif}
.page{max-width:780px;margin:32px auto;background:#fff;padding:40px;border-radius:16px;box-shadow:0 1px 2px rgba(0,0,0,.05),0 8px 24px rgba(0,0,0,.06)}
.top{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;flex-wrap:wrap}
.top img{height:40px}h1{font-size:24px;margin:0 0 4px}.muted{color:#6e6e73;font-size:13px}
.meta{text-align:right}.meta strong{font-family:ui-monospace,Menlo,monospace;font-size:16px}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin:28px 0;padding:20px 0;border-top:1px solid #e6e6ea;border-bottom:1px solid #e6e6ea}
h2{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#6e6e73;margin:0 0 6px}
table{width:100%;border-collapse:collapse}th{text-align:left;font-size:12px;color:#6e6e73;font-weight:600;border-bottom:1px solid #e6e6ea;padding:8px 0}
td{padding:10px 0;border-bottom:1px solid #f0f0f2;vertical-align:top}.r{text-align:right;white-space:nowrap;padding-left:16px}
.totals{margin:20px 0 0 auto;max-width:320px}.totals div{display:flex;justify-content:space-between;padding:4px 0}
.grand{font-size:18px;font-weight:700;border-top:2px solid #1d1d1f;margin-top:6px;padding-top:10px!important}
.due{color:#c24e00;font-weight:600}.foot{margin-top:32px;font-size:12px;color:#6e6e73;text-align:center}
.actions{max-width:780px;margin:24px auto 0;display:flex;gap:10px;justify-content:flex-end;padding:0 16px}
button{font:inherit;font-weight:600;border:0;border-radius:999px;padding:12px 22px;background:#1d1d1f;color:#fff;cursor:pointer;min-height:44px}
.tag{display:inline-block;padding:2px 10px;border-radius:999px;background:#fff2e8;color:#c24e00;font-size:12px;font-weight:600}
@media (max-width:600px){.page{margin:0;border-radius:0;padding:24px 18px}.cols{grid-template-columns:1fr}.meta{text-align:left}}
@media print{body{background:#fff}.page{box-shadow:none;margin:0;max-width:none;padding:0}.actions{display:none}@page{margin:16mm}}
</style></head><body>
<div class="actions"><button type="button" id="print">Save as PDF or print</button></div>
<main class="page">
  <div class="top">
    <div><img src="/logo.png" alt="GifToyz"><p class="muted" style="margin:8px 0 0">GifToyz Nepal · Kathmandu, Nepal<br>${contact}</p></div>
    <div class="meta"><h1>Bill</h1><div class="muted">Order number</div><strong>${e(order.id)}</strong><div class="muted" style="margin-top:6px">${e(billDate(order.createdAt))}</div><div style="margin-top:8px"><span class="tag">${e(STATUS[order.status] ?? order.status)}</span></div></div>
  </div>
  <div class="cols">
    <div><h2>Bill to</h2><strong>${e(order.name)}</strong><div>${phones}</div></div>
    <div><h2>Deliver to</h2><div>${e(order.address ?? "")}</div><div>${e(loc.name)}${district}</div><div class="muted">${loc.type === "home" ? "Home delivery" : "Pickup from NCM branch"} by Nepal Can Move${ncm}</div></div>
  </div>
  <table><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="totals">
    <div><span>Subtotal</span><span>${rs(order.subtotal)}</span></div>
    <div><span>Delivery</span><span>${rs(loc.fee)}</span></div>
    <div class="grand"><span>Total</span><span>${rs(order.total)}</span></div>
    ${paidRow}
    ${dueRow}
  </div>
  <p class="foot">Payment: ${e(method)}. Thank you for shopping with GifToyz.<br>This is a computer-generated bill and needs no signature.</p>
</main>
<script>document.getElementById("print").addEventListener("click", () => window.print());</script>
</body></html>`;
}
