/* Reaviva API — RV: moneda para mensajes promocionales 💰
 *
 * Tasa: 10 RV = 5 publicaciones con enlaces, redes sociales o publicidad
 * en el chat grupal. Es decir: 1 mensaje promocional cuesta 2 RV.
 * Sin RV suficientes, el filtro anti-spam bloquea ese contenido.
 * Los RV nunca vencen, no son reembolsables ni transferibles.
 *
 * Paquetes de recarga (pagos únicos con PayPal Orders API v2,
 * NO suscripciones). Los pagos empiezan desde $12.
 *   120 RV = $12 USD (60 links o 96 imágenes)
 *   300 RV = $25 USD (150 links o 240 imágenes) · Más popular
 *   700 RV = $50 USD (350 links o 560 imágenes) · Mejor valor
 *
 * Flujo:
 *  1. POST /api/rv/create-order { pack: "50"|"150"|"500" }
 *     → { id, approveUrl } — el frontend redirige al comprador.
 *  2. PayPal redirige a return_url (?rv=ok&token=ORDER_ID).
 *  3. POST /api/rv/capture-order { orderID }
 *     → verifica el monto con PayPal, acredita los RV (idempotente).
 *
 * Seguridad: el monto SIEMPRE se verifica contra la respuesta de PayPal;
 * nunca se confía en lo que envía el cliente.
 */
"use strict";

const express = require("express");
const db = require("../db");
const { requireAuth } = require("./auth");
const {
  paypalOrdersConfigured,
  paypalFetch,
  APP_URL,
} = require("./billing");
const { getRV } = require("../spam");

const router = express.Router();

const PACKS = {
  120: { rv: 120, amount: "12.00", label: "120 RV", detalle: "60 links o 96 imágenes" },
  300: { rv: 300, amount: "25.00", label: "300 RV", detalle: "150 links o 240 imágenes", popular: true },
  700: { rv: 700, amount: "50.00", label: "700 RV", detalle: "350 links o 560 imágenes · Mejor valor" },
};

/* Solo usuarios con plan pagado (o admin) pueden comprar RV. */
function paidOnly(req, res, next) {
  const u = req.user;
  if (u && (u.is_admin === 1 || u.subscribed === 1)) return next();
  return res.status(403).json({
    error: "Los RV son para miembros con plan 💎",
  });
}

/* GET /api/rv/balance → { rv } */
router.get("/balance", requireAuth, (req, res) => {
  res.json({ rv: getRV(req.user.id) });
});

/* GET /api/rv/history → { purchases: [...], spending: [...], balance } */
router.get("/history", requireAuth, (req, res) => {
  const purchases = db
    .prepare(
      `SELECT pack_credits AS rv, amount_usd AS monto, paypal_order_id AS orden,
              status AS estado, created_at AS fecha
       FROM credit_purchases WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`
    )
    .all(req.user.id);
  const spending = db
    .prepare(
      `SELECT credits_used AS rv, reason AS motivo, created_at AS fecha
       FROM credit_spending WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`
    )
    .all(req.user.id);
  res.json({ purchases, spending, balance: getRV(req.user.id) });
});

/* GET /api/rv/packs → lista pública de paquetes (para el modal). */
router.get("/packs", (req, res) => {
  res.json({
    packs: Object.entries(PACKS).map(([key, p]) => ({
      pack: key,
      rv: p.rv,
      precio: p.amount,
      moneda: "USD",
      etiqueta: p.label,
      detalle: p.detalle,
      popular: !!p.popular,
    })),
    tasa: "10 RV = 5 links · 10 RV = 8 imágenes",
  });
});

/* POST /api/rv/create-order  { pack: "120"|"300"|"700" }
 * → { id, approveUrl } */
router.post("/create-order", requireAuth, paidOnly, async (req, res) => {
  if (!paypalOrdersConfigured())
    return res.status(503).json({ error: "Pagos no configurados todavía" });

  const packKey = String(req.body && req.body.pack);
  const pack = PACKS[packKey];
  if (!pack)
    return res.status(400).json({ error: "Paquete inválido. Elige 120, 300 o 700 RV." });

  const base = String(APP_URL || "").replace(/\/$/, "");
  if (!base)
    return res.status(503).json({ error: "URL de la app no configurada" });

  try {
    const r = await paypalFetch("/v2/checkout/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            amount: { currency_code: "USD", value: pack.amount },
            description: `Reaviva: recarga de ${pack.rv} RV`,
            custom_id: `${req.user.id}:${pack.rv}`,
          },
        ],
        application_context: {
          brand_name: "Reaviva",
          user_action: "PAY_NOW",
          return_url: `${base}/?rv=ok#comunidad`,
          cancel_url: `${base}/?rv=cancel#comunidad`,
        },
      }),
    });
    const j = await r.json();
    if (!r.ok)
      return res.status(502).json({ error: "PayPal no pudo crear la orden" });
    const approve = (j.links || []).find((l) => l.rel === "approve");
    if (!approve || !approve.href)
      return res.status(502).json({ error: "PayPal no devolvió link de aprobación" });
    // Guardamos la orden como pendiente para idempotencia en la captura.
    try {
      db.prepare(
        `INSERT OR IGNORE INTO credit_purchases
           (user_id, pack_credits, amount_usd, paypal_order_id, status, created_at)
         VALUES (?, ?, ?, ?, 'pending', datetime('now'))`
      ).run(req.user.id, pack.rv, pack.amount, j.id);
    } catch (e) {
      /* no bloquea */
    }
    res.json({ id: j.id, approveUrl: approve.href });
  } catch (e) {
    res.status(502).json({ error: "Error conectando con PayPal" });
  }
});

/* POST /api/rv/capture-order  { orderID }
 * Captura el pago, verifica el monto y acredita los RV.
 * Idempotente: si la orden ya fue acreditada, no duplica. */
router.post("/capture-order", requireAuth, paidOnly, async (req, res) => {
  if (!paypalOrdersConfigured())
    return res.status(503).json({ error: "Pagos no configurados todavía" });

  const orderID = String((req.body && req.body.orderID) || "").trim();
  if (!orderID) return res.status(400).json({ error: "Falta el ID de la orden" });

  // Idempotencia: ¿ya acreditada?
  const prev = db
    .prepare("SELECT id, status, pack_credits FROM credit_purchases WHERE paypal_order_id = ?")
    .get(orderID);
  if (prev && prev.status === "completed") {
    return res.json({
      ok: true,
      yaAcreditado: true,
      rvAgregados: Number(prev.pack_credits),
      rv: getRV(req.user.id),
    });
  }

  try {
    // 1) Verificar el estado de la orden en PayPal.
    const ord = await paypalFetch(`/v2/checkout/orders/${encodeURIComponent(orderID)}`);
    const oj = await ord.json();
    if (!ord.ok || oj.status !== "APPROVED")
      return res.status(400).json({ error: "La orden no está aprobada en PayPal" });

    const pu = (oj.purchase_units || [])[0] || {};
    const expectedAmount = String(pu.amount && pu.amount.value);
    const pack = Object.values(PACKS).find((p) => p.amount === expectedAmount);
    if (!pack)
      return res.status(400).json({ error: "El monto de la orden no coincide con ningún paquete" });

    // Seguridad: la orden debe pertenecer a este usuario (custom_id).
    const customId = String(pu.custom_id || "");
    const ownerId = Number(customId.split(":")[0]);
    if (ownerId !== Number(req.user.id))
      return res.status(403).json({ error: "Esta orden no te pertenece" });

    // 2) Capturar.
    const cap = await paypalFetch(
      `/v2/checkout/orders/${encodeURIComponent(orderID)}/capture`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
    );
    const cj = await cap.json();
    if (!cap.ok)
      return res.status(502).json({ error: "PayPal no pudo capturar el pago" });

    const capture = (((cj.purchase_units || [])[0] || {}).payments || {}).captures || [];
    const done = capture.find((c) => c.status === "COMPLETED");
    if (!done)
      return res.status(502).json({ error: "El pago no se completó en PayPal" });
    const paidAmount = String((done.amount || {}).value);
    if (paidAmount !== pack.amount)
      return res.status(400).json({ error: "El monto capturado no coincide" });

    // 3) Acreditar (idempotente por UNIQUE en paypal_order_id).
    db.prepare(
      `INSERT INTO credit_purchases
         (user_id, pack_credits, amount_usd, paypal_order_id, status, created_at)
       VALUES (?, ?, ?, ?, 'completed', datetime('now'))
       ON CONFLICT(paypal_order_id) DO UPDATE SET status = 'completed'`
    ).run(req.user.id, pack.rv, pack.amount, orderID);
    db.prepare("UPDATE users SET credits = credits + ? WHERE id = ?").run(pack.rv, req.user.id);

    res.json({
      ok: true,
      rvAgregados: pack.rv,
      rv: getRV(req.user.id),
      monto: pack.amount,
    });
  } catch (e) {
    res.status(502).json({ error: "Error procesando el pago con PayPal" });
  }
});

module.exports = { router, PACKS };
