/* Reaviva API — comunidad.
 *
 *   GET  /api/community  → comentarios públicos
 *   POST /api/community  → publicar comentario (con validación anti-spam)
 *
 * Regla de visualización: usuarios CON plan → nombre real + foto de perfil;
 * usuarios SIN plan → "Guest" + foto de perfil. NUNCA se exponen email,
 * user_id ni IP. El admin ve la identidad real en /api/admin/community
 * (routes/admin.js), que no cambia.
 */
"use strict";

const express = require("express");
const db = require("../db");
const { requireAuth } = require("./auth");

const router = express.Router();

/* Avatares anónimos: deterministas por user_id (siempre el mismo para el mismo usuario). */
const AVATARS = ["🌻", "🌙", "🦋", "🌿", "⭐", "🍀", "🌺", "🌊", "🔥", "💫", "🌷", "🍃"];
function avatarFor(userId) {
  return AVATARS[Math.abs(Number(userId) || 0) % AVATARS.length];
}

/* Fecha legible en español: "17 oct, 22:30". */
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function fechaCorta(iso) {
  const d = new Date((iso || "").replace(" ", "T") + "Z");
  if (isNaN(d)) return "";
  const dia = d.getDate();
  const mes = MESES[d.getMonth()];
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${dia} ${mes}, ${hh}:${mm}`;
}

/* --- Validación: bloquear correos y números de teléfono ---
 * Se hace SIEMPRE en el servidor; el cliente nunca es de fiar. */
const EMAIL_RE = /\S+@\S+\.\S+/;
const PHONE_RE = /(\d[\s\-\.\(\)]*){7,}/; // 7+ dígitos, con espacios/guiones/paréntesis
const MAX_CHARS = 500;
const RATE_PER_HOUR = 10;

/* --- Límite de chat freemium: 2 horas al día ---
 * Los usuarios gratuitos tienen 2 horas (7200s) de acceso diario a la
 * comunidad. El frontend envía POST /api/community/heartbeat cada 60s
 * mientras la pestaña está abierta; el servidor acumula los segundos.
 * Plan pagado y admin: ilimitado (chatTimeLeft: null). */
const CHAT_FREE_SECONDS = 7200; // 2 horas
const utcDate = () => new Date().toISOString().slice(0, 10);

/* { allowed: bool, left: segundos restantes | null si ilimitado } */
function chatAccess(user) {
  if (user.is_admin === 1 || user.subscribed === 1)
    return { allowed: true, left: null };
  const today = utcDate();
  const row = db
    .prepare("SELECT seconds_used FROM chat_usage WHERE user_id = ? AND date = ?")
    .get(user.id, today);
  const left = CHAT_FREE_SECONDS - (row ? row.seconds_used : 0);
  return { allowed: left > 0, left: Math.max(0, left) };
}

function chatBlockedPayload() {
  return {
    error:
      "Tu tiempo de chat de hoy se agotó ⏰ Vuelve mañana o desbloquea acceso ilimitado 💎",
    chatTimeLeft: 0,
    agotado: true,
  };
}

function validarTexto(raw) {
  const text = String(raw || "").trim();
  if (!text) return { error: "Escribe algo para compartir 💛" };
  if (text.length > MAX_CHARS)
    return { error: `Máximo ${MAX_CHARS} caracteres (tu mensaje tiene ${text.length})` };
  if (EMAIL_RE.test(text))
    return { error: "No puedes compartir correos en la comunidad 💛" };
  if (PHONE_RE.test(text))
    return { error: "No puedes compartir números de teléfono en la comunidad 💛" };
  return { text };
}

/* GET /api/community → lista pública, anónima, newest first.
 * Incluye chatTimeLeft (segundos restantes hoy; null = ilimitado).
 * Sin tiempo restante → 403 con mensaje en español. */
router.get("/", requireAuth, (req, res) => {
  const acc = chatAccess(req.user);
  if (!acc.allowed) return res.status(403).json(chatBlockedPayload());
  const rows = db
    .prepare(
      `SELECT c.id, c.user_id, c.text, c.created_at,
              u.name, u.photo, u.subscribed, u.is_admin
       FROM community_comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.hidden = 0
       ORDER BY c.created_at DESC
       LIMIT 100`
    )
    .all();
  res.json({
    chatTimeLeft: acc.left,
    comentarios: rows.map((c) => {
      // Regla de visualización: con plan → nombre real + foto;
      // sin plan → "Guest" + foto. NUNCA: email, ip, user_id.
      const paid = c.subscribed === 1 || c.is_admin === 1;
      return {
        id: c.id,
        texto: c.text,
        fecha: fechaCorta(c.created_at),
        nombre: paid ? c.name : "Guest",
        foto: c.photo || null,
        avatar: avatarFor(c.user_id), // emoji de respaldo si no tiene foto
      };
    }),
  });
});

/* POST /api/community → publicar (validado + rate limit + límite de tiempo). */
router.post("/", requireAuth, (req, res) => {
  const acc = chatAccess(req.user);
  if (!acc.allowed) return res.status(403).json(chatBlockedPayload());
  const v = validarTexto(req.body && req.body.text);
  if (v.error) return res.status(400).json({ error: v.error });

  const recent = db
    .prepare(
      `SELECT COUNT(*) AS n FROM community_comments
       WHERE user_id = ? AND created_at >= datetime('now', '-1 hour')`
    )
    .get(req.user.id).n;
  if (recent >= RATE_PER_HOUR)
    return res
      .status(429)
      .json({ error: "Publicaste muchos comentarios seguidos. Intenta en un rato 💛" });

  const r = db
    .prepare("INSERT INTO community_comments (user_id, text) VALUES (?, ?)")
    .run(req.user.id, v.text);
  res.status(201).json({ ok: true, id: Number(r.lastInsertRowid) });
});

/* POST /api/community/heartbeat → el frontend lo llama cada 60s mientras
 * la pestaña de comunidad está abierta. Acumula segundos de uso del día.
 * Devuelve { chatTimeLeft } para que el frontend muestre el temporizador.
 * Plan pagado / admin: { chatTimeLeft: null } (ilimitado). */
router.post("/heartbeat", requireAuth, (req, res) => {
  const u = req.user;
  if (u.is_admin === 1 || u.subscribed === 1)
    return res.json({ chatTimeLeft: null });

  const today = utcDate();
  const now = Math.floor(Date.now() / 1000);
  let row = db
    .prepare("SELECT seconds_used, last_heartbeat FROM chat_usage WHERE user_id = ? AND date = ?")
    .get(u.id, today);

  if (!row) {
    db.prepare(
      "INSERT INTO chat_usage (user_id, date, seconds_used, last_heartbeat) VALUES (?, ?, 0, ?)"
    ).run(u.id, today, now);
    return res.json({ chatTimeLeft: CHAT_FREE_SECONDS });
  }

  // Solo se suma el tiempo real entre heartbeats (huecos > 3 min = pestaña
  // cerrada, no se cuentan).
  const delta = now - (row.last_heartbeat || now);
  const add = delta > 0 && delta <= 180 ? delta : 0;
  const used = Math.min(CHAT_FREE_SECONDS, row.seconds_used + add);
  db.prepare(
    "UPDATE chat_usage SET seconds_used = ?, last_heartbeat = ? WHERE user_id = ? AND date = ?"
  ).run(used, now, u.id, today);

  res.json({ chatTimeLeft: Math.max(0, CHAT_FREE_SECONDS - used) });
});

module.exports = { router, avatarFor, validarTexto, chatAccess, CHAT_FREE_SECONDS };
