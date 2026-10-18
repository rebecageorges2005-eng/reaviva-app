/* Reaviva API — filtro anti-spam del chat grupal (y DMs).
 *
 * Bloquea: correos, teléfonos y cuentas de redes sociales en los mensajes.
 * Sistema de strikes (toques):
 *   - 1er intento → 🚩 "Te quedan 2 intentos" (mensaje bloqueado)
 *   - 2do intento → 🚩 "Te queda 1 intento" (mensaje bloqueado)
 *   - 3er intento → 🚩 chat deshabilitado (solo lectura) hasta que el
 *     administrador lo reactive.
 *
 * Política de reseteo (documentada): los strikes se reinician cada día
 * (por fecha UTC). El muteo (silenciado) es PERMANENTE hasta que el admin
 * lo reactive con POST /api/admin/users/:id/unmute. Se lleva la cuenta de
 * cuántas veces fue muteado el usuario (chat_mutes) para que el admin vea
 * reincidentes.
 *
 * Los intentos bloqueados se registran en chat_violations para revisión
 * del administrador. El mensaje bloqueado NUNCA se guarda ni se muestra.
 */
"use strict";

const db = require("./db");

const EMAIL_RE = /\S+@\S+\.\S+/;
const PHONE_RE = /(\d[\s\-\.\(\)]*){7,}/; // 7+ dígitos con separadores
const SOCIAL_URL_RE =
  /(tiktok\.com|instagram\.com|youtube\.com|youtu\.be|facebook\.com|fb\.com|twitter\.com|x\.com|whatsapp\.com|telegram\.me|t\.me)/i;
const HANDLE_RE = /(^|[\s¿¡(,"'])@[A-Za-z0-9_.]{2,}/; // @usuario (2+ caracteres)
const PLATFORM_RE = /\b(tiktok|instagram|you\s?tube|facebook|twitter|whatsapp|telegram|snapchat)\b/i;
const INTENT_RE =
  /\b(mi|sigueme|sígueme|follow|cuenta|perfil|b[uú]scame|b[uú]scame como|agr[eé]game|agr[eé]game|agrega|encu[eé]ntrame|encuentra|contactame|cont[aá]ctame|escribeme|escr[ií]beme|hablame|h[aá]blame)\b/i;
// URL genérica (ej. "mitienda.com", "www.ejemplo.com/producto"). Se excluye
// el dominio propio de la plataforma para no penalizarlo.
const URL_RE =
  /\b((https?:\/\/)?(www\.)?[a-z0-9][a-z0-9\-]*\.(com|net|org|io|co|mx|es|app|store|shop|online|site|link|bio|ly|me|tv)(\/[^\s]*)?)/i;

const utcDate = () => new Date().toISOString().slice(0, 10);

/* detectSpam(text) → null | { tipo, detalle }
 * tipo: "correo" | "telefono" | "red social" | "link" */
function detectSpam(raw) {
  const text = String(raw || "");
  if (EMAIL_RE.test(text)) return { tipo: "correo", detalle: "dirección de correo" };
  if (PHONE_RE.test(text)) return { tipo: "telefono", detalle: "número de teléfono" };
  if (SOCIAL_URL_RE.test(text)) return { tipo: "red social", detalle: "enlace de red social" };
  if (HANDLE_RE.test(text)) return { tipo: "red social", detalle: "usuario de red social (@…)" };
  if (PLATFORM_RE.test(text) && INTENT_RE.test(text))
    return { tipo: "red social", detalle: "cuenta de red social" };
  // Link genérico (quitando el dominio propio de la plataforma).
  const sinPropio = text.replace(/reavivaapp\.com/gi, "");
  if (URL_RE.test(sinPropio)) return { tipo: "link", detalle: "enlace web" };
  return null;
}

/* Garantiza que las columnas de strikes existen en la fila del usuario
 * (por si la migración aún no corrió en alguna DB vieja). */
function userSpamCols(u) {
  return {
    chat_strikes: Number(u.chat_strikes || 0),
    chat_strikes_date: u.chat_strikes_date || null,
    chat_muted: Number(u.chat_muted || 0),
    chat_mutes: Number(u.chat_mutes || 0),
  };
}

/* Registra un intento bloqueado y aplica el strike.
 * Devuelve { strikes, muted, code, message } para responder al cliente. */
function registerStrike(userId, attemptedText, violation) {
  const today = utcDate();
  let u = db
    .prepare(
      "SELECT chat_strikes, chat_strikes_date, chat_muted, chat_mutes FROM users WHERE id = ?"
    )
    .get(userId);
  if (!u) return { strikes: 0, muted: false, code: "ERROR", message: "Error interno." };
  const s = userSpamCols(u);

  // Reinicio diario de strikes.
  let strikes = s.chat_strikes_date === today ? s.chat_strikes : 0;
  strikes += 1;

  // Registrar la infracción para revisión del admin.
  try {
    db.prepare(
      `INSERT INTO chat_violations (user_id, attempted_text, violation_type, detail, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
    ).run(userId, String(attemptedText || "").slice(0, 500), violation.tipo, violation.detalle || null);
  } catch (e) {
    /* no bloquea */
  }

  if (strikes >= 3) {
    db.prepare(
      `UPDATE users SET chat_strikes = 0, chat_strikes_date = ?,
              chat_muted = 1, chat_mutes = COALESCE(chat_mutes,0) + 1
       WHERE id = ?`
    ).run(today, userId);
    return {
      strikes: 0,
      muted: true,
      code: "MUTED",
      message:
        "🚩 Se deshabilitó tu capacidad de escribir en el chat. A partir de ahora solo puedes ver los mensajes. Si crees que es un error, contacta al administrador.",
    };
  }

  db.prepare("UPDATE users SET chat_strikes = ?, chat_strikes_date = ? WHERE id = ?").run(
    strikes,
    today,
    userId
  );
  const restantes = 3 - strikes;
  return {
    strikes,
    muted: false,
    code: strikes === 1 ? "STRIKE_1" : "STRIKE_2",
    message:
      "🚩 Contenido no permitido en el chat (" +
      violation.detalle +
      "). El mensaje no se envió. Te " +
      (restantes === 2 ? "quedan 2 intentos" : "queda 1 intento") +
      " antes de que se deshabilite tu capacidad de escribir.",
  };
}

/* Revisa si el usuario está muteado. Devuelve el payload de error o null. */
function mutedPayload(userId) {
  const row = db.prepare("SELECT chat_muted FROM users WHERE id = ?").get(userId);
  if (row && Number(row.chat_muted) === 1) {
    return {
      code: "MUTED",
      message:
        "🚩 Tu capacidad de escribir en el chat está deshabilitada. Solo puedes ver los mensajes. Contacta al administrador si crees que es un error.",
    };
  }
  return null;
}

/* Flujo completo para un mensaje: mute check + detección + strike.
 * Devuelve null si el mensaje puede publicarse, o { code, message, status }
 * para responder al cliente. */
function checkMessage(userId, text) {
  const muted = mutedPayload(userId);
  if (muted) return { ...muted, status: 403 };
  const violation = detectSpam(text);
  if (!violation) return null;
  const r = registerStrike(userId, text, violation);
  return { code: r.code, message: r.message, status: r.muted ? 403 : 400 };
}

module.exports = {
  detectSpam,
  registerStrike,
  mutedPayload,
  checkMessage,
  utcDate,
};

/* ============================================================
   RV — MONEDA PARA MENSAJES PROMOCIONALES \U0001f4b0
   Tasa: 10 RV = 5 publicaciones con enlaces/redes sociales.
   Es decir: 1 mensaje promocional cuesta 2 RV.
   Solo usuarios con plan pagado pueden tener y gastar RV.
   ============================================================ */

const RV_POR_MENSAJE = 2;

/* Saldo actual de RV del usuario. */
function getRV(userId) {
  try {
    const row = db.prepare("SELECT credits FROM users WHERE id = ?").get(userId);
    return Math.max(0, Number(row && row.credits) || 0);
  } catch (e) {
    return 0;
  }
}

/* Intenta gastar 2 RV por un mensaje promocional. Devuelve true si se
 * descontaron (y lo registra en credit_spending), false si no hay saldo
 * suficiente. Nunca deja saldo negativo. */
function trySpendRV(userId) {
  try {
    const row = db.prepare("SELECT credits FROM users WHERE id = ?").get(userId);
    const saldo = Math.max(0, Number(row && row.credits) || 0);
    if (saldo < RV_POR_MENSAJE) return false;
    db.prepare("UPDATE users SET credits = credits - ? WHERE id = ? AND credits >= ?").run(
      RV_POR_MENSAJE,
      userId,
      RV_POR_MENSAJE
    );
    db.prepare(
      `INSERT INTO credit_spending (user_id, credits_used, reason, created_at)
       VALUES (?, ?, 'promo_message', datetime('now'))`
    ).run(userId, RV_POR_MENSAJE);
    return true;
  } catch (e) {
    return false;
  }
}

module.exports.getRV = getRV;
module.exports.trySpendRV = trySpendRV;
module.exports.RV_POR_MENSAJE = RV_POR_MENSAJE;
// Alias (compatibilidad interna).
module.exports.getCredits = getRV;
module.exports.trySpendCredit = trySpendRV;

/* ============================================================
   BLOQUE DE IMÁGENES PROMOCIONALES 📷
   10 RV = 8 envíos de imágenes con contenido promocional.
   Las fotos normales del chat (sin enlaces/publicidad) siguen
   siendo gratis para el plan pagado; solo las imágenes con
   contenido detectado por el filtro usan este sistema.
   ============================================================ */

const RV_POR_BLOQUE_IMAGENES = 10;
const IMAGENES_POR_BLOQUE = 8;

/* Intenta usar un envío del bloque de imágenes. Si no hay bloque activo
 * y el usuario tiene >= 10 RV, compra un bloque nuevo automáticamente
 * (descuenta 10 RV, deja 7 envíos restantes tras este).
 * Devuelve { ok: true } o { ok: false, motivo: "sin_rv" }. */
function trySpendImageSend(userId) {
  try {
    const row = db.prepare("SELECT credits, img_block_remaining FROM users WHERE id = ?").get(userId);
    const bloque = Math.max(0, Number(row && row.img_block_remaining) || 0);
    if (bloque > 0) {
      db.prepare("UPDATE users SET img_block_remaining = img_block_remaining - 1 WHERE id = ?").run(userId);
      return { ok: true, via: "bloque" };
    }
    const saldo = Math.max(0, Number(row && row.credits) || 0);
    if (saldo < RV_POR_BLOQUE_IMAGENES) return { ok: false, motivo: "sin_rv" };
    db.prepare(
      "UPDATE users SET credits = credits - ?, img_block_remaining = ? WHERE id = ? AND credits >= ?"
    ).run(RV_POR_BLOQUE_IMAGENES, IMAGENES_POR_BLOQUE - 1, userId, RV_POR_BLOQUE_IMAGENES);
    db.prepare(
      `INSERT INTO credit_spending (user_id, credits_used, reason, created_at)
       VALUES (?, ?, 'promo_images_block', datetime('now'))`
    ).run(userId, RV_POR_BLOQUE_IMAGENES);
    return { ok: true, via: "bloque_nuevo" };
  } catch (e) {
    return { ok: false, motivo: "error" };
  }
}

module.exports.trySpendImageSend = trySpendImageSend;
module.exports.RV_POR_BLOQUE_IMAGENES = RV_POR_BLOQUE_IMAGENES;
module.exports.IMAGENES_POR_BLOQUE = IMAGENES_POR_BLOQUE;
