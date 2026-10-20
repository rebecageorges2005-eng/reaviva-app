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
const { ah } = db;
const { requireAuth } = require("./auth");
const { getPlanType, displayProfile, billingAccess } = require("../plan");
const { checkMessage, detectSpam } = require("../spam");

const router = express.Router();
const DM_MAX_CHARS = 1000;
/* Límite diario de conversaciones únicas (usuarios diferentes por día, UTC).
 * Anual: 90/día · mensual: 15/día. Se cuentan usuarios, no mensajes. */
const DM_CONV_PER_DAY = { annual: 90, monthly: 15 };
const utcDay = () => new Date().toISOString().slice(0, 10);

/* Limpieza de mensajes expirados (48h). Se ejecuta en cada lectura. */
async function cleanupExpired() {
  try {
    await db.run("DELETE FROM private_messages WHERE expires_at <= datetime('now')");
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
async function checkDmDailyLimit(userId, partnerId, limit, isMonthly, isAdmin) {
  // El admin no tiene límite diario de conversaciones.
  if (isAdmin) return { ok: true, nueva: false };
  const day = utcDay();
  try {
    // Limpieza de filas viejas (más de 2 días) para no acumular.
    await db.run("DELETE FROM dm_daily_partners WHERE day < date('now', '-2 days')");
    const ya = await db.get("SELECT 1 FROM dm_daily_partners WHERE user_id = ? AND partner_id = ? AND day = ?", userId, partnerId, day);
    if (ya) return { ok: true, nueva: false };
    const cuantos = (await db.get("SELECT COUNT(*) AS n FROM dm_daily_partners WHERE user_id = ? AND day = ?", userId, day)).n;
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
    await db.run(
      "INSERT OR IGNORE INTO dm_daily_partners (user_id, partner_id, day) VALUES (?, ?, ?)"
    , userId, partnerId, day);
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

/* POST /api/dm  { to_user_id, text } — enviar mensaje privado. */router.post("/", requireAuth, ah(async (req, res) => {
  // Bandera roja: cuenta deshabilitada para chatear.
  if (req.user.chat_disabled === 1)
    return res.status(403).json({ error: "Tu cuenta está deshabilitada para chatear por múltiples advertencias. 🚩" });
  const plan = getPlanType(req.user);
  const isMonthly = plan === "monthly";
  const isAnnual = plan === "annual"; // el admin cuenta como annual
  if (!isMonthly && !isAnnual) {
    return res.status(403).json({ error: "Los mensajes privados son para miembros con plan 💎" });
  }
  // Cobro fallido + gracia vencida + sin saldo RV: sin privados.
  const bill = await billingAccess(req.user);
  if (bill.blocked)
    return res.status(403).json({
      error: "BILLING_BLOCKED",
      message: "💳 Tu pago no pudo procesarse y la gracia terminó. Actualiza tu método de pago para seguir chateando 💎",
    });
  const toId = Number(req.body?.to_user_id);
  const text = String(req.body?.text || "").trim();
  if (!toId || toId === req.user.id) {
    return res.status(400).json({ error: "Destinatario inválido" });
  }
  if (!text) return res.status(400).json({ error: "Escribe un mensaje" });
  if (text.length > DM_MAX_CHARS) {
    return res.status(400).json({ error: "El mensaje es muy largo (máx 1000 caracteres)" });
  }
  const dest = await db.get("SELECT id FROM users WHERE id = ?", toId);
  if (!dest) return res.status(404).json({ error: "Usuario no encontrado" });
  /* Límite diario de conversaciones únicas (usuarios diferentes por día).
   * Solo el primer mensaje a un usuario nuevo ese día consume cupo. */
  const limite = dmConvLimit(req.user);
  const chk = await checkDmDailyLimit(req.user.id, toId, limite, isMonthly, req.user.is_admin === 1);
  if (!chk.ok) {
    return res.status(chk.status).json({ error: chk.code, message: chk.message });
  }
  cleanupExpired();
  /* Filtro anti-spam (mismo sistema de strikes que el chat grupal).
   * El admin está exento: publica sin restricciones.
   * Los miembros con plan SÍ pueden compartir enlaces en privado:
   * se revisa el resto del mensaje sin las URLs (correos, teléfonos
   * y redes sociales siguen bloqueados). */
  if (req.user.is_admin !== 1) {
    let textoFiltro = text;
    const v = detectSpam(text);
    if (v && (v.tipo === "link" || v.tipo === "red social")) {
      textoFiltro = text
        .replace(/((https?:\/\/)?(www\.)?[a-z0-9][a-z0-9\-]*\.(com|net|org|io|co|mx|es|app|store|shop|online|site|link|bio|ly|me|tv)(\/[^\s]*)?)/gi, " ")
        .replace(/(tiktok\.com|instagram\.com|youtube\.com|youtu\.be|facebook\.com|fb\.com|twitter\.com|x\.com|whatsapp\.com|telegram\.me|t\.me)(\/[^\s]*)?/gi, " ");
    }
    const spam = checkMessage(req.user.id, textoFiltro);
    if (spam) return res.status(spam.status).json({ error: spam.code, message: spam.message });
  }
  const info = await db.run(
      `INSERT INTO private_messages (from_user_id, to_user_id, text, expires_at)
       VALUES (?, ?, ?, datetime('now', '+48 hours'))`
    , req.user.id, toId, text);
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
}));

/* Límites de audio: máx 2 minutos ≈ 2MB en base64. */
const VOICE_MAX_BYTES = 2 * 1024 * 1024;

/* POST /api/dm/voice  { to_user_id, audio } — enviar mensaje de voz.
 * audio: data URL base64 (data:audio/...;base64,...).
 * Permitido: plan anual y mensual. Gratuitos → 403. */
router.post("/voice", requireAuth, ah(async (req, res) => {
  // Bandera roja: cuenta deshabilitada para chatear.
  if (req.user.chat_disabled === 1)
    return res.status(403).json({ error: "Tu cuenta está deshabilitada para chatear por múltiples advertencias. 🚩" });
  const plan = getPlanType(req.user);
  if (plan !== "annual" && plan !== "monthly") {
    return res.status(403).json({ error: "Los mensajes de voz son para miembros con plan 💎" });
  }
  const toId = Number(req.body?.to_user_id);
  const audio = String(req.body?.audio || "");
  if (!toId || toId === req.user.id) {
    return res.status(400).json({ error: "Destinatario inválido" });
  }
  // Acepta también el parámetro ;codecs=... (Chrome graba webm;codecs=opus).
  if (!/^data:audio\/[a-z0-9.+-]+(;codecs=["']?[a-z0-9.+-]+["']?)?;base64,/i.test(audio)) {
    return res.status(400).json({ error: "Formato de audio inválido" });
  }
  if (audio.length > VOICE_MAX_BYTES * 1.4) {
    return res.status(400).json({ error: "El audio es muy largo (máx 2 minutos) 🎤" });
  }
  const dest = await db.get("SELECT id FROM users WHERE id = ?", toId);
  if (!dest) return res.status(404).json({ error: "Usuario no encontrado" });
  /* Mismo límite diario de conversaciones únicas que los mensajes de texto. */
  const limite = dmConvLimit(req.user);
  const chk = await checkDmDailyLimit(req.user.id, toId, limite, plan === "monthly", req.user.is_admin === 1);
  if (!chk.ok) {
    return res.status(chk.status).json({ error: chk.code, message: chk.message });
  }
  cleanupExpired();
  const info = await db.run(
      `INSERT INTO private_messages (from_user_id, to_user_id, text, msg_type, audio_data, expires_at)
       VALUES (?, ?, '', 'voice', ?, datetime('now', '+48 hours'))`
    , req.user.id, toId, audio);
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
}));

/* POST /api/dm/photo  { to_user_id, photo } — enviar una FOTO privada.
 * photo: data URL base64 JPEG o PNG validado por magic bytes.
 * Permitido: plan mensual y anual. Se guarda en file_data. */
router.post("/photo", requireAuth, ah(async (req, res) => {
  if (req.user.chat_disabled === 1)
    return res.status(403).json({ error: "Tu cuenta está deshabilitada para chatear por múltiples advertencias. 🚩" });
  const plan = getPlanType(req.user);
  if (plan !== "annual" && plan !== "monthly") {
    return res.status(403).json({ error: "Enviar fotos es para miembros con plan 💎" });
  }
  const bill = await billingAccess(req.user);
  if (bill.blocked)
    return res.status(403).json({ error: "BILLING_BLOCKED", message: "💳 Tu pago no pudo procesarse y la gracia terminó. Actualiza tu método de pago para seguir chateando 💎" });
  const toId = Number(req.body?.to_user_id);
  const photo = String(req.body?.photo || "");
  if (!toId || toId === req.user.id) {
    return res.status(400).json({ error: "Destinatario inválido" });
  }
  const m = photo.match(/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!m) return res.status(400).json({ error: "Formato de imagen inválido (usa JPG o PNG)" });
  if (photo.length > 2 * 1024 * 1024) {
    return res.status(400).json({ error: "La imagen es muy grande 📷" });
  }
  const head = Buffer.from(m[2].slice(0, 16), "base64");
  const esJpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  const esPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  if ((m[1] === "jpeg" && !esJpeg) || (m[1] === "png" && !esPng)) {
    return res.status(400).json({ error: "La imagen no coincide con su formato 📷" });
  }
  const dest = await db.get("SELECT id FROM users WHERE id = ?", toId);
  if (!dest) return res.status(404).json({ error: "Usuario no encontrado" });
  const limite = dmConvLimit(req.user);
  const chk = await checkDmDailyLimit(req.user.id, toId, limite, plan === "monthly", req.user.is_admin === 1);
  if (!chk.ok) {
    return res.status(chk.status).json({ error: chk.code, message: chk.message });
  }
  cleanupExpired();
  const info = await db.run(
      `INSERT INTO private_messages (from_user_id, to_user_id, text, msg_type, file_data, file_name, expires_at)
       VALUES (?, ?, '', 'photo', ?, 'foto', datetime('now', '+48 hours'))`
    , req.user.id, toId, photo);
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
}));

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
router.post("/file", requireAuth, ah(async (req, res) => {
  // Bandera roja: cuenta deshabilitada para chatear.
  if (req.user.chat_disabled === 1)
    return res.status(403).json({ error: "Tu cuenta está deshabilitada para chatear por múltiples advertencias. 🚩" });
  const plan = getPlanType(req.user);
  if (plan !== "annual" && plan !== "monthly") {
    return res.status(403).json({
      error: "UPGRADE_PLAN",
      message: "Los archivos adjuntos son para miembros con plan 💎",
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
  /* Validación de magic bytes: el contenido debe coincidir con el tipo declarado.
   * Un PDF real empieza con "%PDF". Esto evita que suban ejecutables renombrados. */
  if (mime === "application/pdf") {
    try {
      const b64 = file.slice(m[0].length).replace(/\s/g, "");
      const head = Buffer.from(b64.slice(0, 16), "base64").toString("latin1");
      if (!head.startsWith("%PDF")) {
        return res.status(400).json({ error: "El archivo no es un PDF válido 📎" });
      }
    } catch (e) {
      return res.status(400).json({ error: "No se pudo verificar el archivo 📎" });
    }
  }
  const dest = await db.get("SELECT id FROM users WHERE id = ?", toId);
  if (!dest) return res.status(404).json({ error: "Usuario no encontrado" });
  const limite = dmConvLimit(req.user);
  const chk = await checkDmDailyLimit(req.user.id, toId, limite, plan === "monthly", req.user.is_admin === 1);
  if (!chk.ok) {
    return res.status(chk.status).json({ error: chk.code, message: chk.message });
  }
  cleanupExpired();
  const info = await db.run(
      `INSERT INTO private_messages (from_user_id, to_user_id, text, msg_type, file_data, file_name, file_size, expires_at)
       VALUES (?, ?, '', 'file', ?, ?, ?, datetime('now', '+48 hours'))`
    , req.user.id, toId, file, fileName, bytesAprox);
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
}));

/* POST /api/dm/:uid/video-call — iniciar videollamada (Jitsi Meet).
 * Solo plan anual. Genera una sala aleatoria y envía la invitación por DM.
 * El mensual recibe 403 UPGRADE_ANNUAL. */
router.post("/:uid/video-call", requireAuth, ah(async (req, res) => {
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
  const dest = await db.get("SELECT id FROM users WHERE id = ?", other);
  if (!dest) return res.status(404).json({ error: "Usuario no encontrado" });
  /* Sala aleatoria e imposible de adivinar (sin datos del usuario). */
  const crypto = require("crypto");
  const roomId = "reaviva-" + crypto.randomBytes(8).toString("hex");
  const roomUrl = "https://meet.jit.si/" + roomId;
  cleanupExpired();
  /* La invitación viaja como mensaje especial en el DM (expira en 48h igual). */
  await db.run(
    `INSERT INTO private_messages (from_user_id, to_user_id, text, msg_type, expires_at)
     VALUES (?, ?, ?, 'video-invite', datetime('now', '+48 hours'))`
  , req.user.id, other, roomUrl);
  res.json({ ok: true, roomUrl });
}));

/* GET /api/dm/conversations — lista de conversaciones del usuario. */
/* POST /api/dm/delete  { ids:[...] } — eliminar mensajes seleccionados.
 * Los PROPIOS se borran para ambos; los RECIBIDOS se ocultan solo
 * de mi vista (dm_hidden). Máx 100 por vez. */
router.post("/delete", requireAuth, ah(async (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : [])
    .map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0).slice(0, 100);
  if (!ids.length) return res.status(400).json({ error: "Selecciona al menos un mensaje" });
  let n = 0;
  for (const id of ids) {
    const m = await db.get(
      "SELECT id, from_user_id, to_user_id FROM private_messages WHERE id = ?", id);
    if (!m) continue;
    if (m.from_user_id !== req.user.id && m.to_user_id !== req.user.id) continue;
    if (m.from_user_id === req.user.id) {
      await db.run("DELETE FROM private_messages WHERE id = ?", id);
      await db.run("DELETE FROM message_reactions WHERE message_type = 'dm' AND message_id = ?", id);
      await db.run("DELETE FROM dm_hidden WHERE message_id = ?", id);
    } else {
      await db.run("INSERT OR IGNORE INTO dm_hidden (user_id, message_id) VALUES (?, ?)", req.user.id, id);
    }
    n++;
  }
  res.json({ ok: true, eliminados: n });
}));

router.get("/conversations", requireAuth, ah(async (req, res) => {
  if (!canDm(req.user)) return res.status(403).json({ error: "Los mensajes privados son para miembros con plan 💎" });
  cleanupExpired();
  const me = req.user.id;
  const rows = await db.all(
      `SELECT m.id, m.from_user_id, m.to_user_id, m.text, m.msg_type, m.file_name, m.created_at, m.read_at,
              u.id AS uid, u.name, u.photo, u.country_code, u.subscribed, u.is_admin
       FROM private_messages m
       JOIN users u ON u.id = CASE WHEN m.from_user_id = ? THEN m.to_user_id ELSE m.from_user_id END
       WHERE (m.from_user_id = ? OR m.to_user_id = ?)
         AND m.id NOT IN (SELECT message_id FROM dm_hidden WHERE user_id = ?)
       ORDER BY m.created_at DESC`
    , me, me, me, me);
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
}));

/* GET /api/dm/unread-count — { count } mensajes sin leer.
 * Todos los usuarios autenticados pueden ver su contador (los de plan
 * mensual/gratuito lo usan como aviso para actualizar a anual). */
router.get("/unread-count", requireAuth, ah(async (req, res) => {
  cleanupExpired();
  const r = await db.get("SELECT COUNT(*) AS n FROM private_messages WHERE to_user_id = ? AND read_at IS NULL", req.user.id);
  res.json({ count: (r && r.n) || 0 });
}));

/* GET /api/dm/:uid — mensajes con un usuario (los marca como leídos). */
router.get("/:uid", requireAuth, ah(async (req, res) => {
  if (!canDm(req.user)) return res.status(403).json({ error: "Los mensajes privados son para miembros con plan 💎" });
  cleanupExpired();
  const me = req.user.id;
  const other = Number(req.params.uid);
  if (!other || other === me) return res.status(400).json({ error: "Conversación inválida" });
  const msgs = await db.all(
      `SELECT id, from_user_id, text, msg_type, audio_data, file_data, file_name, file_size, created_at, expires_at
       FROM private_messages
       WHERE ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?))
         AND id NOT IN (SELECT message_id FROM dm_hidden WHERE user_id = ?)
       ORDER BY created_at ASC`
    , me, other, other, me, me);
  await db.run(
    "UPDATE private_messages SET read_at = datetime('now') WHERE to_user_id = ? AND from_user_id = ? AND read_at IS NULL"
  , me, other);
  // Reacciones 👍👎: conteos por mensaje + mi reacción, en una sola consulta.
  const dmIds = msgs.map((m) => m.id);
  const dmReac = {};
  if (dmIds.length) {
    const dmPh = dmIds.map(() => "?").join(",");
    const dmReacRows = await db.all(
        `SELECT message_id, reaction, COUNT(*) AS n
         FROM message_reactions
         WHERE message_type = 'dm' AND message_id IN (${dmPh})
         GROUP BY message_id, reaction`
      , ...dmIds);
    for (const r of dmReacRows) {
      const e = dmReac[r.message_id] || (dmReac[r.message_id] = { likes: 0, dislikes: 0 });
      if (r.reaction === "like") e.likes = r.n;
      else if (r.reaction === "dislike") e.dislikes = r.n;
    }
    const dmMisRows = await db.all(
        `SELECT message_id, reaction FROM message_reactions
         WHERE message_type = 'dm' AND user_id = ? AND message_id IN (${dmPh})`
      , me, ...dmIds);
    for (const r of dmMisRows) {
      const e = dmReac[r.message_id] || (dmReac[r.message_id] = { likes: 0, dislikes: 0 });
      e.mi_reaccion = r.reaction;
    }
  }
  res.json({
    mensajes: msgs.map((m) => ({
      id: m.id,
      mio: m.from_user_id === me,
      texto: m.text,
      tipo: m.msg_type || "text",
      audio: m.msg_type === "voice" ? m.audio_data : null,
      foto: m.msg_type === "photo" ? m.file_data : null,
      archivo: m.msg_type === "file" ? { data: m.file_data, nombre: m.file_name, tamano: m.file_size } : null,
      fecha: fechaCorta(m.created_at),
      expira: m.expires_at,
      likes: (dmReac[m.id] && dmReac[m.id].likes) || 0,
      dislikes: (dmReac[m.id] && dmReac[m.id].dislikes) || 0,
      mi_reaccion: (dmReac[m.id] && dmReac[m.id].mi_reaccion) || null,
    })),
  });
}));

module.exports = { router };
