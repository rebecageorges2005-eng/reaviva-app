/* Reaviva API — mensajes privados (DM) entre usuarios.
 *
 *   POST /api/dm                 → enviar mensaje privado { to_user_id, text }
 *   GET  /api/dm/conversations   → lista de conversaciones
 *   GET  /api/dm/unread-count    → { count } mensajes sin leer
 *   GET  /api/dm/:uid            → mensajes con un usuario (marca leídos)
 *
 * Reglas:
 * - Solo usuarios con plan ANUAL (o admin) pueden enviar y leer DMs.
 *   Los de plan mensual reciben 403 con error "UPGRADE_ANNUAL".
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
const DM_PER_DAY = 20;

/* Limpieza de mensajes expirados (48h). Se ejecuta en cada lectura. */
function cleanupExpired() {
  try {
    db.prepare("DELETE FROM private_messages WHERE expires_at <= datetime('now')").run();
  } catch (e) {
    /* no bloquea la petición */
  }
}

function canDm(user) {
  return getPlanType(user) === "annual"; // el admin cuenta como annual
}

/* Fecha corta en español para la lista. */
function fechaCorta(iso) {
  const d = new Date(String(iso || "").replace(" ", "T") + "Z");
  if (isNaN(d)) return "";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/* POST /api/dm  { to_user_id, text } — enviar mensaje privado. */
router.post("/", requireAuth, (req, res) => {
  const plan = getPlanType(req.user);
  if (plan === "monthly") {
    return res.status(403).json({
      error: "UPGRADE_ANNUAL",
      message: "Actualiza a un plan anual para enviar mensajes privados 💎",
    });
  }
  if (plan !== "annual") {
    return res.status(403).json({ error: "Necesitas un plan anual para enviar mensajes privados 💎" });
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
  const today = db
    .prepare("SELECT COUNT(*) AS n FROM private_messages WHERE from_user_id = ? AND date(created_at) = date('now')")
    .get(req.user.id);
  if (today && today.n >= DM_PER_DAY) {
    return res.status(429).json({ error: "Llegaste al límite de mensajes de hoy. Intenta mañana 💛" });
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

/* GET /api/dm/conversations — lista de conversaciones del usuario. */
router.get("/conversations", requireAuth, (req, res) => {
  if (!canDm(req.user)) return res.status(403).json({ error: "Necesitas un plan anual 💎" });
  cleanupExpired();
  const me = req.user.id;
  const rows = db
    .prepare(
      `SELECT m.id, m.from_user_id, m.to_user_id, m.text, m.created_at, m.read_at,
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
      map.set(otherId, {
        ...displayProfile({ id: r.uid, name: r.name, photo: r.photo, country_code: r.country_code, subscribed: r.subscribed, is_admin: r.is_admin }),
        ultimo: r.text.length > 60 ? r.text.slice(0, 60) + "…" : r.text,
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
  if (!canDm(req.user)) return res.status(403).json({ error: "Necesitas un plan anual 💎" });
  cleanupExpired();
  const me = req.user.id;
  const other = Number(req.params.uid);
  if (!other || other === me) return res.status(400).json({ error: "Conversación inválida" });
  const msgs = db
    .prepare(
      `SELECT id, from_user_id, text, created_at, expires_at
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
      fecha: fechaCorta(m.created_at),
      expira: m.expires_at,
    })),
  });
});

module.exports = { router };
