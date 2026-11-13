/* Reaviva API — Menciones en video 🎬
 *
 *   POST /api/mentions        → pedir una mención (cobra RV, sin devolución)
 *   GET  /api/mentions/mine   → mis solicitudes y su estado
 *
 * Precios (orden de Georges, 12 nov 2026):
 *   nombre SIN imagen: 3 RV · nombre CON imagen: 10 RV (hasta 5 imágenes).
 * Cada imagen debe ser JPG o PNG (máx 1.5MB en base64, magic bytes reales,
 * mismo criterio que /api/albums). El usuario confirma que ninguna imagen es
 * una foto de una persona real y ninguna contiene abuso, sangre ni desnudez;
 * el admin revisa cada solicitud en el panel antes de usarla en un video.
 * Los RV cobrados NO son reembolsables (ni siquiera si se rechaza).
 */
"use strict";

const express = require("express");
const db = require("../db");
const { ah } = db;
const { requireAuth } = require("./auth");
const { getRV } = require("../spam");

const router = express.Router();

const RV_SIN_IMAGEN = 3;
const RV_CON_IMAGEN = 10;
// 1.5MB en base64 ≈ 1.1MB binarios (mismo límite que los álbumes).
const MAX_PHOTO_LEN = Math.floor(1.5 * 1024 * 1024);

/* Valida una data URL de imagen JPG/PNG con magic bytes.
 * Devuelve null si es válida, o un mensaje de error. */
function validarImagen(photo) {
  if (typeof photo !== "string" || !photo) return "Imagen inválida";
  const m = photo.match(/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return "La imagen debe ser JPG o PNG";
  if (photo.length > MAX_PHOTO_LEN) return "La imagen es muy grande (máx 1.5MB)";
  try {
    const buf = Buffer.from(m[2].slice(0, 32), "base64");
    const declared = m[1];
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    const valid = (declared === "jpeg" && isJpeg) || (declared === "png" && isPng);
    if (!valid) return "El archivo no es una imagen JPG o PNG válida";
  } catch (e) {
    return "No se pudo verificar la imagen";
  }
  return null;
}

/* POST /api/mentions → crear una solicitud de mención (cobra RV). */
router.post("/", requireAuth, ah(async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || "").trim();
  const name2 = String(body.name2 || "").trim();
  const gender = String(body.gender || "").trim().toUpperCase();
  const comment = String(body.comment || "").trim();
  const includeImage = body.includeImage === true;
  const acceptTerms = body.acceptTerms === true;

  if (name.length < 2 || name.length > 60)
    return res.status(400).json({ error: "Escribe un nombre de 2 a 60 caracteres." });
  if (gender !== "M" && gender !== "F" && gender !== "B")
    return res.status(400).json({ error: "Elige hombre, mujer o ambos." });
  // Ambos sexos: hacen falta los dos nombres (name = hombre, name2 = mujer).
  if (gender === "B" && (name2.length < 2 || name2.length > 60))
    return res.status(400).json({ error: "Escribe los dos nombres (hombre y mujer)." });
  if (comment.length > 500)
    return res.status(400).json({ error: "El comentario no puede pasar de 500 caracteres." });
  if (!acceptTerms)
    return res.status(400).json({ error: "Debes aceptar las condiciones para enviar tu solicitud." });

  // Hasta 5 imágenes (se acepta también el campo único `image` de la v1).
  let images = [];
  if (includeImage) {
    const arr = Array.isArray(body.images) ? body.images : (body.image ? [body.image] : []);
    if (!arr.length)
      return res.status(400).json({ error: "Elige al menos una imagen JPG o PNG." });
    if (arr.length > 5)
      return res.status(400).json({ error: "Puedes enviar hasta 5 imágenes." });
    for (const im of arr) {
      const err = validarImagen(im);
      if (err) return res.status(400).json({ error: err });
    }
    images = arr;
  }

  const costo = includeImage ? RV_CON_IMAGEN : RV_SIN_IMAGEN;
  const isAdmin = req.user && req.user.is_admin === 1;

  // Cobro de RV (sin devolución). El admin no paga.
  if (!isAdmin) {
    const row = await db.get("SELECT credits FROM users WHERE id = ?", req.user.id);
    const saldo = Math.max(0, Number(row && row.credits) || 0);
    if (saldo < costo)
      return res.status(402).json({
        error: `Te faltan RV: esta solicitud cuesta ${costo} RV y tienes ${saldo}.`,
        need: costo, balance: saldo,
      });
    const upd = await db.run(
      "UPDATE users SET credits = credits - ? WHERE id = ? AND credits >= ?",
      costo, req.user.id, costo);
    if (!upd || upd.changes === 0)
      return res.status(402).json({ error: "No se pudo cobrar los RV. Intenta de nuevo." });
    await db.run(
      `INSERT INTO credit_spending (user_id, credits_used, reason, created_at)
       VALUES (?, ?, 'video_mention', datetime('now'))`,
      req.user.id, costo);
  }

  const r = await db.run(
    `INSERT INTO video_mentions (user_id, name, name2, gender, comment, has_image, rv_cost, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pendiente')`,
    req.user.id, name, name2 || null, gender, comment || null, includeImage ? 1 : 0, costo);
  for (let i = 0; i < images.length; i++) {
    await db.run(
      "INSERT INTO video_mention_images (mention_id, image, sort_order) VALUES (?, ?, ?)",
      r.lastInsertRowid, images[i], i);
  }

  res.json({ ok: true, id: r.lastInsertRowid, rv_cost: costo, balance: await getRV(req.user.id) });
}));

/* GET /api/mentions/mine → mis solicitudes (sin la imagen, para no pesar). */
router.get("/mine", requireAuth, ah(async (req, res) => {
  const rows = await db.all(
    `SELECT id, name, name2, gender, comment, has_image, rv_cost, status, created_at
     FROM video_mentions WHERE user_id = ? ORDER BY id DESC LIMIT 50`,
    req.user.id);
  res.json({ mentions: rows, balance: await getRV(req.user.id) });
}));

module.exports = { router, RV_SIN_IMAGEN, RV_CON_IMAGEN };
