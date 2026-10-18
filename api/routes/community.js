/* Reaviva API — comunidad anónima.
 *
 *   GET  /api/community  → comentarios públicos (anónimos para no-admins)
 *   POST /api/community  → publicar comentario (con validación anti-spam)
 *
 * La identidad NUNCA se expone en estas rutas: cada usuario aparece como
 * "Anónimo" con un avatar emoji determinista según su user_id.
 * El admin ve y modera desde /api/admin/community (routes/admin.js).
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

/* GET /api/community → lista pública, anónima, newest first. */
router.get("/", requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, user_id, text, created_at
       FROM community_comments
       WHERE hidden = 0
       ORDER BY created_at DESC
       LIMIT 100`
    )
    .all();
  res.json({
    comentarios: rows.map((c) => ({
      id: c.id,
      texto: c.text,
      fecha: fechaCorta(c.created_at),
      avatar: avatarFor(c.user_id),
      // NUNCA: user_id, email, nombre.
    })),
  });
});

/* POST /api/community → publicar (validado + rate limit). */
router.post("/", requireAuth, (req, res) => {
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

module.exports = { router, avatarFor, validarTexto };
