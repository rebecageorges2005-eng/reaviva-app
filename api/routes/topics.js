/* Reaviva API — temas temporales del chat grupal.
 *
 *   GET  /api/topics  → lista de temas activos (no expirados)
 *   POST /api/topics  → crear un tema (solo con plan pagado o admin)
 *
 * Reglas: cada tema dura 2 horas y luego expira/desaparece automáticamente.
 * El nombre se guarda SIN el símbolo #; al publicar un mensaje con el tema
 * se le antepone "#Nombre " al texto.
 * El creador se muestra con las mismas reglas que la comunidad:
 * con plan → iniciales + país; sin plan → "Guest" (aunque solo los de plan
 * pueden crear temas, el admin también puede).
 */
"use strict";

const express = require("express");
const db = require("../db");
const { requireAuth } = require("./auth");
const { detectSpam } = require("../spam");

const router = express.Router();

const TOPIC_TTL_MINUTES = 120; // 2 horas
const TOPIC_NAME_MIN = 2;
const TOPIC_NAME_MAX = 40;
const TOPICS_PER_DAY = 5;

/* Iniciales del nombre en mayúsculas: "María González" → "MG", "Pedro" → "PE".
 * En el chat grupal NUNCA se muestran nombres reales. */
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

function isPaidUser(u) {
  return u.is_admin === 1 || u.subscribed === 1;
}

/* Valida el nombre del tema: 2-40 caracteres, sin el símbolo #. */
function validarNombreTema(raw) {
  const name = String(raw || "").trim().replace(/\s+/g, " ");
  if (name.length < TOPIC_NAME_MIN)
    return { error: `El tema debe tener al menos ${TOPIC_NAME_MIN} caracteres.` };
  if (name.length > TOPIC_NAME_MAX)
    return { error: `El tema debe tener máximo ${TOPIC_NAME_MAX} caracteres.` };
  if (name.includes("#"))
    return { error: "El tema no puede contener el símbolo #." };
  return { name };
}

/* Minutos restantes hasta que expire (número entero ≥ 0). */
function minutosRestantes(expiresAt) {
  const ms = new Date(expiresAt.replace(" ", "T") + "Z").getTime() - Date.now();
  return Math.max(0, Math.round(ms / 60000));
}

function nombreCreador(row) {
  const paid = row.subscribed === 1 || row.is_admin === 1;
  if (!paid) return "Guest";
  const pais = String(row.country_code || "").toUpperCase();
  return pais ? iniciales(row.name) + " · " + pais : iniciales(row.name);
}

/* GET /api/topics → temas activos, más recientes primero.
 * Limpieza oportunista: borra los expirados al listar. */
router.get("/", requireAuth, (req, res) => {
  try {
    db.prepare("DELETE FROM chat_topics WHERE expires_at <= datetime('now')").run();
  } catch (e) { /* no bloquea */ }

  const rows = db
    .prepare(
      `SELECT t.id, t.name AS topic_name, t.created_at, t.expires_at,
              u.name AS user_name, u.subscribed, u.is_admin, u.country_code
       FROM chat_topics t
       JOIN users u ON u.id = t.user_id
       WHERE t.expires_at > datetime('now')
       ORDER BY t.created_at DESC
       LIMIT 50`
    )
    .all();

  res.json({
    temas: rows.map((t) => ({
      id: t.id,
      nombre: t.topic_name,
      creador: nombreCreador({ ...t, name: t.user_name }),
      creado: t.created_at,
      minutosRestantes: minutosRestantes(t.expires_at),
    })),
  });
});

/* POST /api/topics { name } → crear tema (solo con plan). */
router.post("/", requireAuth, (req, res) => {
  const u = req.user;
  if (!isPaidUser(u))
    return res
      .status(403)
      .json({ error: "Solo los miembros con plan pueden crear temas 💎" });

  const v = validarNombreTema(req.body && req.body.name);
  if (v.error) return res.status(400).json({ error: v.error });

  /* Anti-spam: el nombre del tema no puede contener correos, teléfonos
   * ni redes sociales. Se bloquea sin strike. */
  const spam = detectSpam(v.name);
  if (spam)
    return res
      .status(400)
      .json({ error: "🚩 El nombre del tema no puede contener " + spam.detalle + "." });

  // Límite: 5 temas por usuario por día.
  const hoy = db
    .prepare(
      `SELECT COUNT(*) AS n FROM chat_topics
       WHERE user_id = ? AND created_at >= datetime('now', '-1 day')`
    )
    .get(u.id).n;
  if (hoy >= TOPICS_PER_DAY)
    return res
      .status(429)
      .json({ error: "Creaste muchos temas hoy. Intenta mañana 💛" });

  const r = db
    .prepare(
      `INSERT INTO chat_topics (user_id, name, expires_at)
       VALUES (?, ?, datetime('now', '+${TOPIC_TTL_MINUTES} minutes'))`
    )
    .run(u.id, v.name);

  res.status(201).json({
    ok: true,
    id: Number(r.lastInsertRowid),
    nombre: v.name,
    mensaje: `Tema "#${v.name}" creado 🎉 Durará 2 horas.`,
  });
});

/* Devuelve el nombre de un tema activo por id, o null si no existe/expiró. */
function temaActivoPorId(id) {
  const n = Number(id);
  if (!n) return null;
  const t = db
    .prepare("SELECT name FROM chat_topics WHERE id = ? AND expires_at > datetime('now')")
    .get(n);
  return t ? t.name : null;
}

module.exports = { router, temaActivoPorId, TOPIC_TTL_MINUTES };
