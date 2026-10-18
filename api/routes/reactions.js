/* Reaviva API — reacciones 👍👎 a mensajes.
 *
 *   POST /api/reactions  → alternar like/dislike en un mensaje
 *     body: { message_id, message_type: 'community'|'dm', reaction: 'like'|'dislike' }
 *     Comportamiento:
 *       - Sin reacción previa → la crea.
 *       - Misma reacción → la quita (toggle).
 *       - Reacción opuesta → la cambia.
 *     Responde: { ok, likes, dislikes, mi_reaccion }
 *
 * Todos los usuarios autenticados pueden reaccionar (es participación,
 * no función premium). El mensaje debe existir y ser visible para el usuario.
 */
"use strict";

const express = require("express");
const db = require("../db");
const { requireAuth } = require("./auth");

const router = express.Router();

/* Cuenta likes/dislikes de un mensaje. */
function contarReacciones(messageId, messageType) {
  const rows = db
    .prepare(
      "SELECT reaction, COUNT(*) AS n FROM message_reactions WHERE message_id = ? AND message_type = ? GROUP BY reaction"
    )
    .all(messageId, messageType);
  let likes = 0,
    dislikes = 0;
  for (const r of rows) {
    if (r.reaction === "like") likes = r.n;
    else if (r.reaction === "dislike") dislikes = r.n;
  }
  return { likes, dislikes };
}

/* Verifica que el mensaje exista y el usuario pueda verlo. */
function mensajeVisible(userId, messageId, messageType) {
  if (messageType === "community") {
    // Debe existir, no estar oculto por el admin y no estar oculto por mí.
    const row = db
      .prepare(
        `SELECT 1 FROM community_comments c
         WHERE c.id = ? AND c.hidden = 0
           AND (c.msg_type = 'photo' OR c.expires_at IS NULL OR c.expires_at > datetime('now'))
           AND NOT EXISTS (SELECT 1 FROM hidden_messages h WHERE h.user_id = ? AND h.message_id = c.id)`
      )
      .get(messageId, userId);
    return !!row;
  }
  // DM: debe ser un mensaje entre yo y el otro usuario (no expirado).
  const row = db
    .prepare(
      `SELECT 1 FROM private_messages
       WHERE id = ? AND (from_user_id = ? OR to_user_id = ?)
         AND (expires_at IS NULL OR expires_at > datetime('now'))`
    )
    .get(messageId, userId, userId);
  return !!row;
}

router.post("/", requireAuth, (req, res) => {
  const me = req.user.id;
  const messageId = Number(req.body && req.body.message_id);
  const messageType = String((req.body && req.body.message_type) || "");
  const reaction = String((req.body && req.body.reaction) || "");
  if (!messageId || (messageType !== "community" && messageType !== "dm")) {
    return res.status(400).json({ error: "Mensaje inválido" });
  }
  if (reaction !== "like" && reaction !== "dislike") {
    return res.status(400).json({ error: "Reacción inválida" });
  }
  if (!mensajeVisible(me, messageId, messageType)) {
    return res.status(404).json({ error: "Mensaje no encontrado" });
  }
  const previa = db
    .prepare(
      "SELECT reaction FROM message_reactions WHERE user_id = ? AND message_id = ? AND message_type = ?"
    )
    .get(me, messageId, messageType);
  let miReaccion = null;
  if (previa && previa.reaction === reaction) {
    // Toggle: quitar la reacción.
    db.prepare(
      "DELETE FROM message_reactions WHERE user_id = ? AND message_id = ? AND message_type = ?"
    ).run(me, messageId, messageType);
  } else if (previa) {
    // Cambiar de like a dislike (o viceversa).
    db.prepare(
      "UPDATE message_reactions SET reaction = ?, created_at = datetime('now') WHERE user_id = ? AND message_id = ? AND message_type = ?"
    ).run(reaction, me, messageId, messageType);
    miReaccion = reaction;
  } else {
    db.prepare(
      "INSERT INTO message_reactions (user_id, message_id, message_type, reaction) VALUES (?, ?, ?, ?)"
    ).run(me, messageId, messageType, reaction);
    miReaccion = reaction;
  }
  const { likes, dislikes } = contarReacciones(messageId, messageType);
  res.json({ ok: true, likes, dislikes, mi_reaccion: miReaccion });
});

module.exports = { router, contarReacciones };

// deploy-fix
