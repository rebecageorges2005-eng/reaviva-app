/* Reaviva API — PayPal Subscriptions billing.
 *
 * Replaces the previous Stripe integration (removed Oct 2026: a US Stripe
 * account cannot be activated without a Social Security Number, which
 * Georges does not have — PayPal works for his case).
 *
 * Flow:
 *  1. Frontend: POST /api/paypal/create-subscription { plan, email }
 *     → { id, approveUrl } — redirect the buyer to approveUrl.
 *  2. Buyer approves on PayPal → PayPal redirects to return_url (?paypal=ok).
 *  3. PayPal:  POST /api/paypal/webhook  (BILLING.SUBSCRIPTION.ACTIVATED …)
 *     → we upsert paypal_subscriptions and flip the buyer's status.
 *  4. Frontend: GET /api/paypal/status?email=… → { subscribed }
 *
 * All credentials come from environment variables (see .env.example).
 * NOTHING is hardcoded here.
 */
"use strict";

const express = require("express");
const db = require("../db");
const { ah } = db;
const { sendPaymentFailedEmail } = require("../email");

const router = express.Router();

const {
  PAYPAL_CLIENT_ID,
  PAYPAL_CLIENT_SECRET,
  PAYPAL_MODE,
  PAYPAL_PLAN_MONTHLY,
  PAYPAL_PLAN_YEARLY,
  PAYPAL_WEBHOOK_ID,
  APP_URL,
} = process.env;

const PAYPAL_API =
  String(PAYPAL_MODE || "sandbox").toLowerCase() === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

const isPlaceholder = (v) => !v || String(v).includes("REPLACE_ME");

function paypalConfigured() {
  return (
    !isPlaceholder(PAYPAL_CLIENT_ID) &&
    !isPlaceholder(PAYPAL_CLIENT_SECRET) &&
    !isPlaceholder(PAYPAL_PLAN_MONTHLY) &&
    !isPlaceholder(PAYPAL_PLAN_YEARLY)
  );
}

const PLANS = {
  monthly: () => PAYPAL_PLAN_MONTHLY,
  yearly: () => PAYPAL_PLAN_YEARLY,
};

/* --- OAuth: client-credentials token, cached in memory until near expiry --- */
let tokenCache = { token: null, exp: 0 };
async function paypalToken() {
  if (tokenCache.token && Date.now() < tokenCache.exp - 60000) return tokenCache.token;
  const creds = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString("base64");
  const r = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${creds}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) throw new Error(`PayPal OAuth falló: HTTP ${r.status}`);
  const j = await r.json();
  tokenCache = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return tokenCache.token;
}

async function paypalFetch(path, opts = {}) {
  const token = await paypalToken();
  return fetch(`${PAYPAL_API}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
}

/* GET /api/paypal/plans → { mode, monthly, yearly } — 503 if not configured */
router.get("/paypal/plans", (req, res) => {
  if (!paypalConfigured())
    return res.status(503).json({ error: "Pagos no configurados todavía" });
  res.json({
    mode: String(PAYPAL_MODE || "sandbox").toLowerCase(),
    monthly: { id: PAYPAL_PLAN_MONTHLY, price: "4.99", currency: "USD", interval: "month" },
    yearly: { id: PAYPAL_PLAN_YEARLY, price: "39.99", currency: "USD", interval: "year" },
  });
});

/* POST /api/paypal/create-subscription  { plan: "monthly"|"yearly", email }
 * → { id, approveUrl }. MVP: no JWT required — the buyer's email travels in
 * custom_id so the webhook can match the subscription to the buyer. */
router.post("/paypal/create-subscription", ah(async (req, res) => {
  if (!paypalConfigured())
    return res.status(503).json({ error: "Pagos no configurados todavía" });

  const plan = req.body?.plan;
  const email = String(req.body?.email || "").trim().toLowerCase();
  const planId = PLANS[plan] && PLANS[plan]();
  if (!planId || isPlaceholder(planId))
    return res.status(400).json({ error: "Plan inválido" });
  if (!email || !email.includes("@"))
    return res.status(400).json({ error: "Email inválido" });

  try {
    const base = String(APP_URL || "").replace(/\/$/, "");
    const r = await paypalFetch("/v1/billing/subscriptions", {
      method: "POST",
      body: JSON.stringify({
        plan_id: planId,
        custom_id: email, // lets the webhook match the buyer
        application_context: {
          brand_name: "Reaviva",
          locale: "es-ES",
          user_action: "SUBSCRIBE_NOW",
          return_url: `${base}/?paypal=ok#app`,
          cancel_url: `${base}/?paypal=cancel#app`,
        },
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      console.error("[paypal] create subscription falló:", r.status, t.slice(0, 300));
      return res.status(502).json({ error: "No se pudo crear la suscripción" });
    }
    const sub = await r.json();
    const approve = (sub.links || []).find((l) => l.rel === "approve");
    if (!approve)
      return res.status(502).json({ error: "PayPal no devolvió enlace de aprobación" });

    await db.run(
      `INSERT INTO paypal_subscriptions (email, subscription_id, plan, status)
       VALUES (?, ?, ?, 'PENDING')
       ON CONFLICT(email) DO UPDATE SET
         subscription_id = excluded.subscription_id,
         plan = excluded.plan,
         status = 'PENDING',
         updated_at = datetime('now')`
    , email, sub.id, plan);

    res.json({ id: sub.id, approveUrl: approve.href });
  } catch (e) {
    console.error("[paypal] create error:", e.message);
    res.status(500).json({ error: "No se pudo crear la suscripción" });
  }
}));

/* GET /api/paypal/status?email=… → { subscribed, planType } */
router.get("/paypal/status", ah(async (req, res) => {
  const email = String(req.query.email || "").trim().toLowerCase();
  if (!email) return res.status(400).json({ error: "Email requerido" });
  const row = await db.get("SELECT status FROM paypal_subscriptions WHERE email = ?", email);
  const subscribed = row?.status === "ACTIVE";
  let planType = "free";
  if (subscribed) {
    const u = await db.get("SELECT * FROM users WHERE email = ?", email);
    if (u) {
      try {
        planType = require("../plan").getPlanType(u);
      } catch (e) { planType = "monthly"; }
    }
  }
  res.json({ subscribed, planType });
}));

/* GET /api/billing/upgrade-quote → cotización prorrateada mensual → anual.
 * Requiere sesión. El usuario mensual ya pagó $4.99 del mes en curso:
 * solo paga la diferencia ($35.00) para subir a anual.
 * Limitación documentada: PayPal no permite "actualizar" una suscripción
 * cambiando de plan con prorrateo automático desde nuestra integración;
 * el flujo es: el usuario se suscribe al plan anual (link de PayPal) y
 * puede cancelar el mensual. La cotización muestra el descuento aplicado. */
router.get("/billing/upgrade-quote", (req, res, next) => {
  const { requireAuth } = require("./auth");
  requireAuth(req, res, () => {
    const { getPlanType } = require("../plan");
    const plan = getPlanType(req.user);
    const ANNUAL = 39.99;
    const MONTHLY = 4.99;
    const yearlyPlanId = isPlaceholder(PAYPAL_PLAN_YEARLY) ? null : PAYPAL_PLAN_YEARLY;
    if (plan === "annual") {
      return res.json({ plan: "annual", mensaje: "Ya tienes el plan anual 🎉" });
    }
    if (plan === "monthly") {
      const quote = (ANNUAL - MONTHLY).toFixed(2); // 35.00
      return res.json({
        plan: "monthly",
        precioAnual: ANNUAL.toFixed(2),
        pagadoEsteMes: MONTHLY.toFixed(2),
        quote,
        moneda: "USD",
        mensaje: `Ya pagaste $${MONTHLY.toFixed(2)} este mes. Solo pagas $${quote} para subir a anual.`,
        yearlyPlanId,
      });
    }
    return res.json({
      plan: "free",
      precioAnual: ANNUAL.toFixed(2),
      moneda: "USD",
      mensaje: `El plan anual cuesta $${ANNUAL.toFixed(2)} al año.`,
      yearlyPlanId,
    });
  });
});

/* POST /api/paypal/webhook — PayPal event notifications.
 * NOTE: mounted with express.raw() in server.js so the signature can be verified. */
async function webhookHandler(req, res) {
  let event;
  try {
    event = JSON.parse(req.body.toString("utf8"));
  } catch {
    return res.status(400).send("JSON inválido");
  }

  // Verify the signature when a webhook ID is configured.
  if (!isPlaceholder(PAYPAL_WEBHOOK_ID)) {
    try {
      const ok = await verifySignature(req, event);
      if (!ok) {
        console.error("[paypal] webhook: firma inválida");
        return res.status(400).send("Firma inválida");
      }
    } catch (e) {
      console.error("[paypal] webhook verify error:", e.message);
      return res.status(500).send("Error verificando firma");
    }
  } else {
    console.warn("[paypal] webhook sin PAYPAL_WEBHOOK_ID — firma NO verificada (solo desarrollo)");
  }

  try {
    const type = event.event_type;
    const resource = event.resource || {};
    const email = String(resource.custom_id || "").toLowerCase();
    const subId = resource.id;

    if (type === "BILLING.SUBSCRIPTION.ACTIVATED" && email) {
      // PayPal trae la próxima fecha de cobro en billing_info.next_billing_time.
      // Si no viene, la estimamos según el plan (mensual +1 mes, anual +1 año).
      let nextBilling = resource.billing_info?.next_billing_time || null;
      if (!nextBilling) {
        const d = new Date();
        const yearly = resource.plan_id === PAYPAL_PLAN_YEARLY;
        d.setFullYear(d.getFullYear() + (yearly ? 1 : 0));
        d.setMonth(d.getMonth() + (yearly ? 0 : 1));
        nextBilling = d.toISOString().slice(0, 10);
      } else {
        nextBilling = String(nextBilling).slice(0, 10);
      }
      await db.run(
        `INSERT INTO paypal_subscriptions (email, subscription_id, plan, status, next_billing_date, reminder_sent)
         VALUES (?, ?, ?, 'ACTIVE', ?, 0)
         ON CONFLICT(email) DO UPDATE SET
           subscription_id = excluded.subscription_id,
           status = 'ACTIVE',
           next_billing_date = excluded.next_billing_date,
           reminder_sent = 0,
           updated_at = datetime('now')`
      , email, subId, resource.plan_id || null, nextBilling);
      // also flip the users row if the buyer has an account
      const yearly = resource.plan_id === PAYPAL_PLAN_YEARLY;
      await db.run(
        "UPDATE users SET subscribed = 1, paypal_subscription_id = ?, plan_type = ? WHERE email = ?"
      , subId, yearly ? "yearly" : "monthly", email);
      /* Bono de bienvenida RV 💰: se SUMA al saldo existente (no lo reemplaza).
       * Mensual: +50 RV. Anual: +200 RV. Idempotente: solo una vez por
       * suscripción (rv_bonus_for guarda el subscription_id que ya lo recibió). */
      try {
        const u = await db.get("SELECT id, credits, rv_bonus_for FROM users WHERE email = ?", email);
        if (u && u.rv_bonus_for !== subId) {
          const bonus = yearly ? 200 : 50;
          await db.run(
            "UPDATE users SET credits = credits + ?, rv_bonus_for = ? WHERE id = ?"
          , bonus, subId, u.id);
          await db.run(
            `INSERT INTO credit_purchases (user_id, pack_credits, amount_usd, paypal_order_id, status, created_at)
             VALUES (?, ?, 0, ?, 'welcome_bonus', datetime('now'))`
          , u.id, bonus, "BONO-" + subId);
          console.log(`[paypal] bono bienvenida: +${bonus} RV para ${email}`);
        }
      } catch (e) {
        console.error("[paypal] error bono bienvenida:", e.message);
      }
      console.log(`[paypal] ${email} suscrito (${subId}), próximo cobro ${nextBilling}`);
    }

    if (
      [
        "BILLING.SUBSCRIPTION.CANCELLED",
        "BILLING.SUBSCRIPTION.SUSPENDED",
        "BILLING.SUBSCRIPTION.EXPIRED",
        "BILLING.SUBSCRIPTION.PAYMENT.FAILED",
      ].includes(type)
    ) {
      const row = subId
        ? await db.get("SELECT email FROM paypal_subscriptions WHERE subscription_id = ?", subId)
        : null;
      const targetEmail = email || row?.email;
      if (targetEmail) {
        const status = type === "BILLING.SUBSCRIPTION.PAYMENT.FAILED" ? "PAST_DUE" : "CANCELLED";
        // Estado previo: el aviso (correo + mensaje en la app) se envía
        // UNA sola vez, al pasar a PAST_DUE (PayPal reintenta el evento).
        const prev = await db.get("SELECT status FROM paypal_subscriptions WHERE email = ?", targetEmail);
        // Pago fallido → 48 HORAS DE GRACIA con acceso total (grace_until).
        const grace = type === "BILLING.SUBSCRIPTION.PAYMENT.FAILED"
          ? ", grace_until = datetime('now', '+48 hours')" : "";
        await db.run(`UPDATE paypal_subscriptions SET status = ?, updated_at = datetime('now')${grace} WHERE email = ?`, status, targetEmail);
        if (status === "CANCELLED")
          await db.run("UPDATE users SET subscribed = 0, plan_type = NULL WHERE email = ?", targetEmail);
        console.log(`[paypal] ${targetEmail} → ${type}${grace ? " (gracia 48h)" : ""}`);
        if (type === "BILLING.SUBSCRIPTION.PAYMENT.FAILED" && (!prev || prev.status !== "PAST_DUE")) {
          try {
            const u = await db.get("SELECT id, name FROM users WHERE email = ?", targetEmail);
            const sub2 = await db.get("SELECT grace_until FROM paypal_subscriptions WHERE email = ?", targetEmail);
            sendPaymentFailedEmail({ to: targetEmail, name: u?.name, graceUntil: sub2?.grace_until });
            if (u) {
              await db.run(
                "INSERT INTO admin_messages (user_id, email, title, body) VALUES (?, ?, ?, ?)",
                u.id, targetEmail,
                "⚠️ Tu pago de renovación no pudo procesarse",
                "Intentamos renovar tu plan, pero el pago falló. Tienes 48 horas de gracia con acceso total para actualizar tu método de pago en PayPal o renovar tu plan desde la app. Si no se completa el pago, tu acceso se pausará (tu progreso y tu saldo RV se conservan). 💛");
            }
            console.log(`[paypal] aviso de pago fallido enviado a ${targetEmail}`);
          } catch (e) { console.error("[paypal] aviso pago fallido:", e.message); }
        }
      }
    }

    /* Cobro recurrente exitoso (cada pago mensual/anual) 💰:
     * - Si estaba en PAST_DUE, el pago lo recupera: vuelve a ACTIVE.
     * - REGALÍA RV por cada pago: mensual +50 RV · anual +200 RV.
     *   Idempotente: una sola vez por transacción (BONO-<sale_id>). */
    if (type === "PAYMENT.SALE.COMPLETED") {
      const saleId = String(resource.id || "");
      const agreementId = String(resource.billing_agreement_id || "");
      let targetEmail = email || null;
      let planRow = null;
      if (!targetEmail && agreementId) {
        planRow = await db.get("SELECT email, plan FROM paypal_subscriptions WHERE subscription_id = ?", agreementId);
        if (planRow) targetEmail = planRow.email;
      } else if (targetEmail) {
        planRow = await db.get("SELECT plan FROM paypal_subscriptions WHERE email = ?", targetEmail);
      }
      if (targetEmail && saleId) {
        // Recuperación: si estaba vencido, vuelve a ACTIVE y se limpia la gracia.
        await db.run(
          "UPDATE paypal_subscriptions SET status = 'ACTIVE', grace_until = NULL, updated_at = datetime('now') WHERE email = ?",
          targetEmail);
        const marker = "BONO-" + saleId;
        const dup = await db.get("SELECT id FROM credit_purchases WHERE paypal_order_id = ? LIMIT 1", marker);
        if (!dup) {
          const yearly = (planRow && planRow.plan === PAYPAL_PLAN_YEARLY) ||
            await db.get("SELECT id FROM users WHERE email = ? AND plan_type IN ('yearly','annual','anual')", targetEmail);
          const bonus = yearly ? 200 : 50;
          const u = await db.get("SELECT id FROM users WHERE email = ?", targetEmail);
          if (u) {
            await db.run("UPDATE users SET credits = COALESCE(credits, 0) + ? WHERE id = ?", bonus, u.id);
            await db.run(
              `INSERT INTO credit_purchases (user_id, pack_credits, amount_usd, paypal_order_id, status, created_at)
               VALUES (?, ?, 0, ?, 'monthly_bonus', datetime('now'))`
            , u.id, bonus, marker);
            console.log(`[paypal] regalía por pago: +${bonus} RV para ${targetEmail} (${marker})`);
          }
        }
      }
    }
  } catch (e) {
    console.error("[paypal] webhook handler error:", e.message);
    return res.status(500).send("Error interno");
  }

  res.json({ received: true });
}

async function verifySignature(req, event) {
  const r = await paypalFetch("/v1/notifications/verify-webhook-signature", {
    method: "POST",
    body: JSON.stringify({
      transmission_id: req.headers["paypal-transmission-id"],
      transmission_time: req.headers["paypal-transmission-time"],
      cert_url: req.headers["paypal-cert-url"],
      auth_algo: req.headers["paypal-auth-algo"],
      transmission_sig: req.headers["paypal-transmission-sig"],
      webhook_id: PAYPAL_WEBHOOK_ID,
      webhook_event: event,
    }),
  });
  if (!r.ok) return false;
  const j = await r.json();
  return j.verification_status === "SUCCESS";
}

/* Helpers exportados para reutilizar la API de PayPal en otros módulos
 * (p. ej. pagos únicos de paquetes de créditos en routes/credits.js). */
function paypalOrdersConfigured() {
  return !isPlaceholder(PAYPAL_CLIENT_ID) && !isPlaceholder(PAYPAL_CLIENT_SECRET);
}

module.exports = {
  router,
  webhookHandler,
  paypalConfigured,
  paypalOrdersConfigured,
  paypalToken,
  paypalFetch,
  PAYPAL_API,
  APP_URL,
};
