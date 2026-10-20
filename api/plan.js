/* Reaviva API — helpers de plan y de visualización pública.
 *
 * getPlanType(user): 'annual' | 'monthly' | 'free'.
 *   - El admin siempre cuenta como 'annual'.
 *   - Fuente principal: users.plan_type (lo fija el webhook de PayPal).
 *   - Respaldo: paypal_subscriptions.plan (acepta "monthly"/"yearly" o el
 *     plan_id de PayPal).
 *   - Sin información: 'free' si no está suscrito; 'monthly' si está
 *     suscrito pero no sabemos el tipo (opción conservadora: el DM
 *     requiere plan anual explícito).
 *
 * displayProfile(row): { uid, nombre, foto, avatar } para mostrar a un
 * usuario en el chat/DMs SIN exponer su nombre real, email, user_id
 * crudo ni IP. Reglas: con plan → iniciales + país (ej. "MG · MX");
 * sin plan → "Guest".
 */
"use strict";

const db = require("./db");

const YEARLY_IDS = [process.env.PAYPAL_PLAN_YEARLY, "P-28J68146PE501741ENLJRIPA"].filter(Boolean);
const MONTHLY_IDS = [process.env.PAYPAL_PLAN_MONTHLY, "P-6PN06957M8413651NNLJRIOA"].filter(Boolean);

function normalizePlan(v) {
  const raw = String(v || "").trim();
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (s === "yearly" || s === "annual" || s === "anual") return "annual";
  if (s === "monthly" || s === "mensual") return "monthly";
  if (YEARLY_IDS.includes(raw)) return "annual";
  if (MONTHLY_IDS.includes(raw)) return "monthly";
  return null;
}

function getPlanType(user) {
  if (!user) return "free";
  if (user.is_admin === 1) return "annual";
  if (user.subscribed !== 1) return "free";
  const direct = normalizePlan(user.plan_type);
  if (direct) return direct;
  try {
    const row = db
      .prepare("SELECT plan, status FROM paypal_subscriptions WHERE email = ?")
      .get(String(user.email || "").toLowerCase());
    if (row && row.status === "ACTIVE") {
      const p = normalizePlan(row.plan);
      if (p) return p;
    }
  } catch (e) {
    /* sin acceso a PayPal: cae al valor conservador de abajo */
  }
  return "monthly";
}

/* Avatares deterministas por user_id (respaldo cuando no hay foto). */
const AVATARS = ["🌻", "🌙", "🦋", "🌿", "⭐", "🍀", "🌺", "🌊", "🔥", "💫", "🌷", "🍃"];
function avatarFor(userId) {
  return AVATARS[Math.abs(Number(userId) || 0) % AVATARS.length];
}

/* Iniciales en mayúsculas: "María González" → "MG", "Pedro" → "PE". */
function iniciales(nombre) {
  const partes = String(nombre || "").trim().split(/\s+/).filter(Boolean);
  if (partes.length >= 2) {
    return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
  }
  if (partes.length === 1) {
    return partes[0].slice(0, 2).toUpperCase();
  }
  return "??";
}

/* Perfil público para chat/DMs. NUNCA incluye nombre real, email, IP
 * ni el user_id crudo (se expone como uid solo donde hace falta para
 * abrir una conversación, y únicamente a usuarios autenticados). */
function displayProfile(u) {
  const paid = u.subscribed === 1 || u.is_admin === 1;
  const pais = String(u.country_code || "").toUpperCase();
  return {
    uid: u.id,
    nombre: paid ? (pais ? iniciales(u.name) + " · " + pais : iniciales(u.name)) : "Guest",
    foto: u.photo || null,
    avatar: avatarFor(u.id),
  };
}

/* trialEnded(user): la prueba gratuita dura 7 días desde el registro.
 * Al culminar, el usuario sin plan pasa a SOLO LECTURA (puede ver el chat
 * grupal pero no publicar ni usar opciones) hasta pagar un plan.
 * Admin y usuarios con plan: nunca les aplica. */
const TRIAL_MS = 7 * 24 * 60 * 60 * 1000;
function trialEnded(user) {
  if (!user || user.is_admin === 1 || user.subscribed === 1) return false;
  if (!user.created_at) return false;
  const t = new Date(String(user.created_at).replace(" ", "T") + "Z").getTime();
  if (isNaN(t)) return false;
  return Date.now() - t > TRIAL_MS;
}

/* billingAccess(user): reglas de cobro automático de PayPal.
 * - El pago es automático: PayPal cobra solo al vencimiento (suscripción recurrente).
 * - Al culminar el mes/anual sin pago: 48 HORAS DE GRACIA con acceso total.
 * - Tras la gracia: TODO deshabilitado (aunque tenga RV — el saldo solo se
 *   conserva, no se pierde). Debe actualizar su pago para volver.
 * Los usuarios SIN plan no tienen gracia: al culminar su prueba, todo se
 * deshabilita de inmediato (ver trialEnded).
 * Devuelve { blocked: bool, reason: 'failed'|null }. */
async function billingAccess(user) {
  if (!user || user.is_admin === 1 || user.subscribed !== 1)
    return { blocked: false, reason: null };
  let sub = null;
  try {
    sub = await db.get(
      "SELECT status, grace_until FROM paypal_subscriptions WHERE email = ?",
      String(user.email || "").toLowerCase());
  } catch (e) { return { blocked: false, reason: null }; }
  if (!sub || sub.status === "ACTIVE") return { blocked: false, reason: null };
  if (sub.status === "PAST_DUE") {
    const g = sub.grace_until
      ? new Date(String(sub.grace_until).replace(" ", "T") + "Z").getTime()
      : 0;
    if (!isNaN(g) && Date.now() < g)
      return { blocked: false, reason: "grace" }; // 48h de gracia: acceso total
    return { blocked: true, reason: "failed" }; // sin gracia: todo deshabilitado (el RV se conserva)
  }
  return { blocked: false, reason: null };
}

module.exports = { getPlanType, normalizePlan, avatarFor, iniciales, displayProfile, trialEnded, billingAccess };
