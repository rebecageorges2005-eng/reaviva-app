/* Reaviva API — banderas de advertencia (moderación comunitaria).
 *
 *   POST /api/flags  { target_user_id }  → banderear a un usuario.
 *     Cada usuario solo puede banderear una vez al mismo usuario
 *     (UNIQUE en user_flags evita abuso).
 *     Responde: { ok, level } donde level = 0..4
 *       (0=blanca, 1=azul, 2=amarilla, 3=negra, 4=roja).
 *     Al llegar a 4 (roja): se deshabilita el chat del usuario
 *     (users.chat_disabled=1) y se avisa al admin ("ultimadecision").
 *
 *   GET  /api/flags/levels?ids=1,2,3   → { levels: { userId: level } }
 *     Para pintar las banderas junto a los nombres visibles.
 *
 * Reglas:
 *   - No se puede banderear a uno mismo ni al admin.
 *   - Cada click envía una notificación de advertencia al usuario bandereado
 *     (tabla admin_messages, visible en GET /api/messages).
 *   - Con bandera roja, el admin decide: reactivar o denegar
 *     (ver /api/admin/flagged en admin.js).
 */
"use strict";

const express = require("express");
const db = require("../db");
const { requireAuth } = require("./auth");

const router = express.Router();

/* Nivel de advertencia de un usuario: COUNT de flags (cap 4). */
function flagLevel(userId) {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM user_flags WHERE target_user_id = ?")
    .get(userId);
  return Math.min(4, Number(row?.n || 0));
}

/* Envía un mensaje interno al usuario (visible en GET /api/messages). */
function notifyUser(userId, email, title, body) {
  try {
    db.prepare(
      "INSERT INTO admin_messages (user_id, email, title, body) VALUES (?, ?, ?, ?)"
    ).run(userId, email || null, title, body);
  } catch (e) { /* no bloquea */ }
}

/* POST /api/flags  { target_user_id } — banderear a un usuario. */
router.post("/", requireAuth, (req, res) => {
  const me = req.user;
  const targetId = Number(req.body?.target_user_id);

  if (!targetId || targetId === me.id)
    return res.status(400).json({ error: "Usuario inválido" });

  const target = db
    .prepare("SELECT id, email, name, is_admin, chat_disabled FROM users WHERE id = ?")
    .get(targetId);
  if (!target) return res.status(404).json({ error: "Usuario no encontrado" });
  if (target.is_admin === 1)
    return res.status(400).json({ error: "No puedes reportar al administrador" });

  // ¿Ya lo bandereé? (un flag por reportero).
  const existing = db
    .prepare("SELECT id FROM user_flags WHERE target_user_id = ? AND reporter_user_id = ?")
    .get(targetId, me.id);
  if (existing)
    return res.status(400).json({ error: "Ya enviaste una advertencia a este usuario" });

  db.prepare(
    "INSERT INTO user_flags (target_user_id, reporter_user_id) VALUES (?, ?)"
  ).run(targetId, me.id);

  const level = flagLevel(targetId);

  // Notificación de comportamiento al usuario bandereado (cada click).
  const levelNames = ["", "azul 🔵", "amarilla 🟡", "negra ⚫", "roja 🔴"];
  notifyUser(
    targetId,
    target.email,
    "⚠️ Advertencia de comportamiento",
    `Recibiste una advertencia de la comunidad (bandera ${levelNames[level] || "blanca"}). ` +
      `Por favor evita ese comportamiento para no seguir acumulando advertencias. ` +
      `Si llegas a la bandera roja, tu cuenta será deshabilitada para chatear.`
  );

  // Bandera roja: deshabilitar chat + avisar al admin (ultimadecision).
  if (level >= 4 && target.chat_disabled !== 1) {
    db.prepare("UPDATE users SET chat_disabled = 1 WHERE id = ?").run(targetId);
    notifyUser(
      targetId,
      target.email,
      "🔴 Tu cuenta fue deshabilitada para chatear",
      `Recibiste una bandera roja por múltiples advertencias de la comunidad. ` +
        `Tu permiso para chatear y publicar contenido quedó deshabilitado. ` +
        `El administrador revisará tu caso y decidirá si rehabilita tu cuenta.`
    );
    // Aviso al admin: ultimadecision.
    const admin = db.prepare("SELECT id, email FROM users WHERE is_admin = 1 LIMIT 1").get();
    if (admin) {
      notifyUser(
        admin.id,
        admin.email,
        "🔴 ultimadecision: bandera roja",
        `El usuario "${target.name || target.email}" (id ${targetId}) recibió bandera roja ` +
          `y su chat quedó deshabilitado. Revisa su caso en el panel admin: ` +
          `reactiva su cuenta o deniega la rehabilitación.`
      );
    }
  }

  res.json({ ok: true, level });
});

/* GET /api/flags/levels?ids=1,2,3 — niveles para pintar las banderas. */
router.get("/levels", requireAuth, (req, res) => {
  const raw = String(req.query.ids || "");
  const ids = raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => n > 0)
    .slice(0, 100);
  const levels = {};
  if (ids.length) {
    const placeholders = ids.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT target_user_id AS uid, COUNT(*) AS n FROM user_flags
         WHERE target_user_id IN (${placeholders}) GROUP BY target_user_id`
      )
      .all(...ids);
    for (const r of rows) levels[r.uid] = Math.min(4, Number(r.n));
  }
  for (const id of ids) if (!(id in levels)) levels[id] = 0;
  res.json({ levels });
});

module.exports = { router, flagLevel };
