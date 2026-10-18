/* Reaviva API — mensajes privados (DM) entre usuarios.
 *
 *   POST /api/dm                 → enviar mensaje privado { to_user_id, text }
 *   GET  /api/dm/conversations   → lista de conversaciones
 *   GET  /api/dm/unread-count    → { count } mensajes sin leer
 *   GET  /api/dm/:uid            → mensajes con un usuario (marca leídos)
 *
 * Reglas:
 * - Usuarios con plan (mensual o anual, o admin) pueden enviar y leer DMs.
 *   Límite diario de CONVERSACIONES (usuarios únicos por día, UTC):
 *     plan anual → 90/día · plan mensual → 15/día.
 *   Al exceder el límite, el mensual recibe 403 "UPGRADE_ANNUAL" con el
 *   mensaje "Actualiza tu plan para conversar con más personas 💎"
 *   (el frontend abre el modal de actualización a anual); el anual
 *   recibe 429 (ya tiene el plan más alto).
 * - Usuarios gratuitos no pueden usar DMs.
 * - Cada mensaje se elimina automáticamente a las 48 horas.
 * - NUNCA se exponen nombres reales, emails, IPs ni user_ids crudos:
 *   solo iniciales + país + foto (mismas reglas que la comunidad).
 * - El admin NO ve los DMs (privacidad entre usuarios).
 */
"use strict";

const express = require("express");
const db = require("../db");
const { requireAuth } = require("./auth");
const { getPlanType, displayProfile } = require("../plan");
const { checkMessage } = require("../spam");

const router = express.Router();
const DM_MAX_CHARS = 1000;
/* Límite diario de conversaciones únicas (usuarios diferentes por día, UTC).
 * Anual: 90/día · mensual: 15/día. Se cuentan usuarios, no mensajes. */
const DM_CONV_PER_DAY = { annual: 90, monthly: 15 };
const utcDay = () => new Date().toISOString().slice(0, 10);

/* Limpieza de mensajes expirados (48h). Se ejecuta en cada lectura. */
function cleanupExpired() {
  try {
    db.prepare("DELETE FROM private_messages WHERE expires_at <= datetime('now')").run();
  } catch (e) {
    /* no bloquea la petición */
  }
}

/* ¿Puede usar DMs? Solo usuarios con plan pagado (mensual o anual).
 * El admin cuenta como annual. */
function canDm(user) {
  const p = getPlanType(user);
  return p === "annual" || p === "monthly";
}

/* Límite de conversaciones únicas por día según el plan. */
function dmConvLimit(user) {
  return DM_CONV_PER_DAY[getPlanType(user)] || 0;
}

/* ¿Ya conversó con este usuario hoy? Si es un contacto nuevo y hay
 * cupo, lo registra. Devuelve { ok: true } o { ok: false, code, message, status }. */
function checkDmDailyLimit(userId, partnerId, limit, isMonthly) {
  const day = utcDay();
  try {
    // Limpieza de filas viejas (más de 2 días) para no acumular.
    db.prepare("DELETE FROM dm_daily_partners WHERE day < date('now', '-2 days')").run();
    const ya = db
      .prepare("SELECT 1 FROM dm_daily_partners WHERE user_id = ? AND partner_id = ? AND day = ?")
      .get(userId, partnerId, day);
    if (ya) return { ok: true, nueva: false };
    const cuantos = db
      .prepare("SELECT COUNT(*) AS n FROM dm_daily_partners WHERE user_id = ? AND day = ?")
      .get(userId, day).n;
    if (cuantos >= limit) {
      if (isMonthly) {
        return {
          ok: false,
          code: "UPGRADE_ANNUAL",
          message: "Actualiza tu plan para conversar con más personas 💎",
          status: 403,
        };
      }
      return {
        ok: false,
        code: "LIMITE_DIARIO",
        message: `Llegaste al límite de conversaciones de hoy (${limit}). Intenta mañana 💛`,
        status: 429,
      };
    }
    db.prepare(
      "INSERT OR IGNORE INTO dm_daily_partners (user_id, partner_id, day) VALUES (?, ?, ?)"
    ).run(userId, partnerId, day);
    return { ok: true, nueva: true };
  } catch (e) {
    return { ok: true, nueva: false }; // ante error, no bloquea el envío
  }
}

/* Fecha corta en español para la lista. */
function fechaCorta(iso) {
  const d = new Date(String(iso || "").replace(" ", "T") + "Z");
  if (isNaN(d)) return "";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/* POST /api/dm  { to_user_id, text } — enviar mensaje privado. */router.post("/", requireAuth, (req, res) => {
  const plan = getPlanType(req.user);
  const isMonthly = plan === "monthly";
  const isAnnual = plan === "annual"; // el admin cuenta como annual
  if (!isMonthly && !isAnnual) {
    return res.status(403).json({ error: "Los mensajes privados son para miembros con plan 💎" });
  }
  const toId = Number(req.body?.to_user_id);
  const text = String(req.body?.text || "").trim();
  if (!toId || toId === req.user.id) {
    return res.status(400).json({ error: "Destinatario inválido" });
  }
  if (!text) return res.status(400).json({ error: "Escribe un mensaje" });
  if (text.length > DM_MAX_CHARS) {
    return res.status(400).json({ error: "El mensaje es muy largo (máx 1000 caracteres)" });
  }
  const dest = db.prepare("SELECT id FROM users WHERE id = ?").get(toId);
  if (!dest) return res.status(404).json({ error: "Usuario no encontrado" });
  /* Límite diario de conversaciones únicas (usuarios diferentes por día).
   * Solo el primer mensaje a un usuario nuevo ese día consume cupo. */
  const limite = dmConvLimit(req.user);
  const chk = checkDmDailyLimit(req.user.id, toId, limite, isMonthly);
  if (!chk.ok) {
    return res.status(chk.status).json({ error: chk.code, message: chk.message });
  }
  cleanupExpired();
  /* Filtro anti-spam (mismo sistema de strikes que el chat grupal). */
  const spam = checkMessage(req.user.id, text);
  if (spam) return res.status(spam.status).json({ error: spam.code, message: spam.message });
  const info = db
    .prepare(
      `INSERT INTO private_messages (from_user_id, to_user_id, text, expires_at)
       VALUES (?, ?, ?, datetime('now', '+48 hours'))`
    )
    .run(req.user.id, toId, text);
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});

/* Límites de audio: máx 2 minutos ≈ 2MB en base64. */
const VOICE_MAX_BYTES = 2 * 1024 * 1024;

/* POST /api/dm/voice  { to_user_id, audio } — enviar mensaje de voz.
 * audio: data URL base64 (data:audio/...;base64,...).
 * Permitido: plan anual y mensual. Gratuitos → 403. */
router.post("/voice", requireAuth, (req, res) => {
  const plan = getPlanType(req.user);
  if (plan !== "annual" && plan !== "monthly") {
    return res.status(403).json({ error: "Los mensajes de voz son para miembros con plan 💎" });
  }
  const toId = Number(req.body?.to_user_id);
  const audio = String(req.body?.audio || "");
  if (!toId || toId === req.user.id) {
    return res.status(400).json({ error: "Destinatario inválido" });
  }
  if (!/^data:audio\/[a-z0-9.+-]+;base64,/i.test(audio)) {
    return res.status(400).json({ error: "Formato de audio inválido" });
  }
  if (audio.length > VOICE_MAX_BYTES * 1.4) {
    return res.status(400).json({ error: "El audio es muy largo (máx 2 minutos) 🎤" });
  }
  const dest = db.prepare("SELECT id FROM users WHERE id = ?").get(toId);
  if (!dest) return res.status(404).json({ error: "Usuario no encontrado" });
  /* Mismo límite diario de conversaciones únicas que los mensajes de texto. */
  const limite = dmConvLimit(req.user);
  const chk = checkDmDailyLimit(req.user.id, toId, limite, plan === "monthly");
  if (!chk.ok) {
    return res.status(chk.status).json({ error: chk.code, message: chk.message });
  }
  cleanupExpired();
  const info = db
    .prepare(
      `INSERT INTO private_messages (from_user_id, to_user_id, text, msg_type, audio_data, expires_at)
       VALUES (?, ?, '', 'voice', ?, datetime('now', '+48 hours'))`
    )
    .run(req.user.id, toId, audio);
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});

/* Límites de archivos: máx 10MB. Solo documentos (no ejecutables). */
const FILE_MAX_BYTES = 10 * 1024 * 1024;
const FILE_TIPOS_PERMITIDOS = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt",
};

/* POST /api/dm/file  { to_user_id, file, fileName } — enviar archivo adjunto.
 * file: data URL base64. Solo plan anual. Máx 10MB.
 * Permitidos: PDF, DOC, DOCX, TXT. */
router.post("/file", requireAuth, (req, res) => {
  const plan = getPlanType(req.user);
  if (plan !== "annual") {
    return res.status(403).json({
      error: "UPGRADE_ANNUAL",
      message: "Los archivos adjuntos son exclusivos del plan anual 💎",
    });
  }
  const toId = Number(req.body?.to_user_id);
  const file = String(req.body?.file || "");
  const fileName = String(req.body?.fileName || "archivo").slice(0, 120);
  if (!toId || toId === req.user.id) {
    return res.status(400).json({ error: "Destinatario inválido" });
  }
  const m = file.match(/^data:([^;]+);base64,/);
  if (!m) return res.status(400).json({ error: "Formato de archivo inválido" });
  const mime = m[1].toLowerCase();
  if (!FILE_TIPOS_PERMITIDOS[mime]) {
    return res.status(400).json({ error: "Solo se permiten PDF, DOC, DOCX y TXT 📎" });
  }
  /* Tamaño aproximado desde el base64 (×3/4). */
  const bytesAprox = Math.floor((file.length - m[0].length) * 0.75);
  if (bytesAprox > FILE_MAX_BYTES) {
    return res.status(400).json({ error: "El archivo es muy grande (máx 10MB) 📎" });
  }
  const dest = db.prepare("SELECT id FROM users WHERE id = ?").get(toId);
  if (!dest) return res.status(404).json({ error: "Usuario no encontrado" });
  const limite = dmConvLimit(req.user);
  const chk = checkDmDailyLimit(req.user.id, toId, limite, false);
  if (!chk.ok) {
    return res.status(chk.status).json({ error: chk.code, message: chk.message });
  }
  cleanupExpired();
  const info = db
    .prepare(
      `INSERT INTO private_messages (from_user_id, to_user_id, text, msg_type, file_data, file_name, file_size, expires_at)
       VALUES (?, ?, '', 'file', ?, ?, ?, datetime('now', '+48 hours'))`
    )
    .run(req.user.id, toId, file, fileName, bytesAprox);
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});

/* POST /api/dm/:uid/video-call — iniciar videollamada (Jitsi Meet).
 * Solo plan anual. Genera una sala aleatoria y envía la invitación por DM.
 * El mensual recibe 403 UPGRADE_ANNUAL. */
router.post("/:uid/video-call", requireAuth, (req, res) => {
  const plan = getPlanType(req.user);
  const other = Number(req.params.uid);
  if (!other || other === req.user.id) {
    return res.status(400).json({ error: "Conversación inválida" });
  }
  if (plan !== "annual") {
    return res.status(403).json({
      error: "UPGRADE_ANNUAL",
      message: "Las videollamadas son exclusivas del plan anual 💎",
    });
  }
  const dest = db.prepare("SELECT id FROM users WHERE id = ?").get(other);
  if (!dest) return res.status(404).json({ error: "Usuario no encontrado" });
  /* Sala aleatoria e imposible de adivinar (sin datos del usuario). */
  const crypto = require("crypto");
  const roomId = "reaviva-" + crypto.randomBytes(8).toString("hex");
  const roomUrl = "https://meet.jit.si/" + roomId;
  cleanupExpired();
  /* La invitación viaja como mensaje especial en el DM (expira en 48h igual). */
  db.prepare(
    `INSERT INTO private_messages (from_user_id, to_user_id, text, msg_type, expires_at)
     VALUES (?, ?, ?, 'video-invite', datetime('now', '+48 hours'))`
  ).run(req.user.id, other, roomUrl);
  res.json({ ok: true, roomUrl });
});

/* GET /api/dm/conversations — lista de conversaciones del usuario. */
router.get("/conversations", requireAuth, (req, res) => {
  if (!canDm(req.user)) return res.status(403).json({ error: "Los mensajes privados son para miembros con plan 💎" });
  cleanupExpired();
  const me = req.user.id;
  const rows = db
    .prepare(
      `SELECT m.id, m.from_user_id, m.to_user_id, m.text, m.msg_type, m.file_name, m.created_at, m.read_at,
              u.id AS uid, u.name, u.photo, u.country_code, u.subscribed, u.is_admin
       FROM private_messages m
       JOIN users u ON u.id = CASE WHEN m.from_user_id = ? THEN m.to_user_id ELSE m.from_user_id END
       WHERE m.from_user_id = ? OR m.to_user_id = ?
       ORDER BY m.created_at DESC`
    )
    .all(me, me, me);
  const map = new Map();
  for (const r of rows) {
    const otherId = r.from_user_id === me ? r.to_user_id : r.from_user_id;
    if (!map.has(otherId)) {
      const vistaPrevia =
        r.msg_type === "voice"
          ? "🎤 Mensaje de voz"
          : r.msg_type === "video-invite"
            ? "📹 Invitación a videollamada"
            : r.msg_type === "file"
              ? "📎 " + String(r.file_name || "Archivo")
              : r.text.length > 60
                ? r.text.slice(0, 60) + "…"
                : r.text;
      map.set(otherId, {
        ...displayProfile({ id: r.uid, name: r.name, photo: r.photo, country_code: r.country_code, subscribed: r.subscribed, is_admin: r.is_admin }),
        ultimo: vistaPrevia,
        fecha: fechaCorta(r.created_at),
        noLeidos: 0,
      });
    }
    if (r.to_user_id === me && !r.read_at) map.get(otherId).noLeidos++;
  }
  res.json({ conversaciones: [...map.values()] });
});

/* GET /api/dm/unread-count — { count } mensajes sin leer.
 * Todos los usuarios autenticados pueden ver su contador (los de plan
 * mensual/gratuito lo usan como aviso para actualizar a anual). */
router.get("/unread-count", requireAuth, (req, res) => {
  cleanupExpired();
  const r = db
    .prepare("SELECT COUNT(*) AS n FROM private_messages WHERE to_user_id = ? AND read_at IS NULL")
    .get(req.user.id);
  res.json({ count: (r && r.n) || 0 });
});

/* GET /api/dm/:uid — mensajes con un usuario (los marca como leídos). */
router.get("/:uid", requireAuth, (req, res) => {
  if (!canDm(req.user)) return res.status(403).json({ error: "Los mensajes privados son para miembros con plan 💎" });
  cleanupExpired();
  const me = req.user.id;
  const other = Number(req.params.uid);
  if (!other || other === me) return res.status(400).json({ error: "Conversación inválida" });
  const msgs = db
    .prepare(
      `SELECT id, from_user_id, text, msg_type, audio_data, file_data, file_name, file_size, created_at, expires_at
       FROM private_messages
       WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)
       ORDER BY created_at ASC`
    )
    .all(me, other, other, me);
  db.prepare(
    "UPDATE private_messages SET read_at = datetime('now') WHERE to_user_id = ? AND from_user_id = ? AND read_at IS NULL"
  ).run(me, other);
  res.json({
    mensajes: msgs.map((m) => ({
      id: m.id,
      mio: m.from_user_id === me,
      texto: m.text,
      tipo: m.msg_type || "text",
      audio: m.msg_type === "voice" ? m.audio_data : null,
      archivo: m.msg_type === "file" ? { data: m.file_data, nombre: m.file_name, tamano: m.file_size } : null,
      fecha: fechaCorta(m.created_at),
      expira: m.expires_at,
    })),
  });
});

module.exports = { router };
