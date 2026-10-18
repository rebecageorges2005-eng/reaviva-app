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
router.post("/paypal/create-subscription", async (req, res) => {
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

    db.prepare(
      `INSERT INTO paypal_subscriptions (email, subscription_id, plan, status)
       VALUES (?, ?, ?, 'PENDING')
       ON CONFLICT(email) DO UPDATE SET
         subscription_id = excluded.subscription_id,
         plan = excluded.plan,
         status = 'PENDING',
         updated_at = datetime('now')`
    ).run(email, sub.id, plan);

    res.json({ id: sub.id, approveUrl: approve.href });
  } catch (e) {
    console.error("[paypal] create error:", e.message);
    res.status(500).json({ error: "No se pudo crear la suscripción" });
  }
});

/* GET /api/paypal/status?email=… → { subscribed, planType } */
router.get("/paypal/status", (req, res) => {
  const email = String(req.query.email || "").trim().toLowerCase();
  if (!email) return res.status(400).json({ error: "Email requerido" });
  const row = db
    .prepare("SELECT status FROM paypal_subscriptions WHERE email = ?")
    .get(email);
  const subscribed = row?.status === "ACTIVE";
  let planType = "free";
  if (subscribed) {
    const u = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (u) {
      try {
        planType = require("../plan").getPlanType(u);
      } catch (e) { planType = "monthly"; }
    }
  }
  res.json({ subscribed, planType });
});

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
      db.prepare(
        `INSERT INTO paypal_subscriptions (email, subscription_id, plan, status, next_billing_date, reminder_sent)
         VALUES (?, ?, ?, 'ACTIVE', ?, 0)
         ON CONFLICT(email) DO UPDATE SET
           subscription_id = excluded.subscription_id,
           status = 'ACTIVE',
           next_billing_date = excluded.next_billing_date,
           reminder_sent = 0,
           updated_at = datetime('now')`
      ).run(email, subId, resource.plan_id || null, nextBilling);
      // also flip the users row if the buyer has an account
      const yearly = resource.plan_id === PAYPAL_PLAN_YEARLY;
      db.prepare(
        "UPDATE users SET subscribed = 1, paypal_subscription_id = ?, plan_type = ? WHERE email = ?"
      ).run(subId, yearly ? "yearly" : "monthly", email);
      /* Bono de bienvenida RV 💰: se SUMA al saldo existente (no lo reemplaza).
       * Mensual: +50 RV. Anual: +200 RV. Idempotente: solo una vez por
       * suscripción (rv_bonus_for guarda el subscription_id que ya lo recibió). */
      try {
        const u = db
          .prepare("SELECT id, credits, rv_bonus_for FROM users WHERE email = ?")
          .get(email);
        if (u && u.rv_bonus_for !== subId) {
          const bonus = yearly ? 200 : 50;
          db.prepare(
            "UPDATE users SET credits = credits + ?, rv_bonus_for = ? WHERE id = ?"
          ).run(bonus, subId, u.id);
          db.prepare(
            `INSERT INTO credit_purchases (user_id, pack_credits, amount_usd, paypal_order_id, status, created_at)
             VALUES (?, ?, 0, ?, 'welcome_bonus', datetime('now'))`
          ).run(u.id, bonus, "BONO-" + subId);
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
        ? db
            .prepare("SELECT email FROM paypal_subscriptions WHERE subscription_id = ?")
            .get(subId)
        : null;
      const targetEmail = email || row?.email;
      if (targetEmail) {
        const status = type === "BILLING.SUBSCRIPTION.PAYMENT.FAILED" ? "PAST_DUE" : "CANCELLED";
        db.prepare("UPDATE paypal_subscriptions SET status = ?, updated_at = datetime('now') WHERE email = ?")
          .run(status, targetEmail);
        if (status === "CANCELLED")
          db.prepare("UPDATE users SET subscribed = 0, plan_type = NULL WHERE email = ?").run(targetEmail);
        console.log(`[paypal] ${targetEmail} → ${type}`);
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
