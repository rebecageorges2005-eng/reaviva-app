/* Reaviva API — álbumes de fotos en el perfil (estilo Facebook).
 *
 *   GET    /api/albums               → álbumes del usuario actual (con conteo de fotos)
 *   GET    /api/albums/user/:userId  → álbumes de otro usuario (solo lectura)
 *   POST   /api/albums  { title }    → crear álbum (máx 6 por usuario)
 *   DELETE /api/albums/:id           → eliminar álbum (solo el dueño)
 *   GET    /api/albums/:id/photos    → fotos de un álbum (cualquier usuario autenticado)
 *   POST   /api/albums/:id/photos { photo, caption? } → agregar foto (solo dueño, máx 50)
 *   DELETE /api/albums/:id/photos/:photoId → eliminar foto (solo dueño)
 *
 * Las fotos se validan como en /profile/photo: data URL jpeg/png/webp con
 * magic bytes reales. Límite ~1.5MB en base64 por foto.
 */
"use strict";

const express = require("express");
const db = require("../db");
const { ah } = db;
const { requireAuth } = require("./auth");

const router = express.Router();

const MAX_ALBUMS = 6;
const MAX_PHOTOS = 50;
// 1.5MB en base64 ≈ 1.1MB binarios
const MAX_PHOTO_LEN = Math.floor(1.5 * 1024 * 1024);

/* Valida una data URL de imagen (jpeg/png/webp) con magic bytes.
 * Devuelve null si es válida, o un mensaje de error. */
function validarFoto(photo) {
  if (typeof photo !== "string" || !photo) return "Imagen inválida";
  const m = photo.match(/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return "Formato de imagen inválido (usa JPG o PNG)";
  if (photo.length > MAX_PHOTO_LEN) return "La imagen es muy grande (máx 1.5MB)";
  try {
    const buf = Buffer.from(m[2].slice(0, 32), "base64");
    const declared = m[1];
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    const valid = (declared === "jpeg" && isJpeg) || (declared === "png" && isPng);
    if (!valid) return "El archivo no es una imagen válida";
  } catch (e) {
    return "No se pudo verificar la imagen";
  }
  return null;
}

/* Álbumes con conteo de fotos y portada (primera foto). */
async function albumsDe(userId) {
  return await db.all(
      `SELECT a.id, a.title, a.created_at,
              (SELECT COUNT(*) FROM album_photos p WHERE p.album_id = a.id) AS fotos,
              (SELECT p2.photo FROM album_photos p2 WHERE p2.album_id = a.id ORDER BY p2.id ASC LIMIT 1) AS portada
       FROM albums a WHERE a.user_id = ? ORDER BY a.created_at DESC`
    , userId);
}

/* GET /api/albums → mis álbumes. */
router.get("/", requireAuth, ah(async (req, res) => {
  res.json({ albums: await albumsDe(req.user.id) });
}));

/* GET /api/albums/user/:userId → álbumes de otro usuario (solo lectura). */
router.get("/user/:userId", requireAuth, ah(async (req, res) => {
  const userId = Number(req.params.userId);
  if (!userId) return res.status(400).json({ error: "Usuario inválido" });
  const existe = await db.get("SELECT id FROM users WHERE id = ?", userId);
  if (!existe) return res.status(404).json({ error: "Usuario no encontrado" });
  res.json({ albums: await albumsDe(userId) });
}));

/* POST /api/albums { title } → crear álbum (máx 6). */
router.post("/", requireAuth, ah(async (req, res) => {
  const title = String((req.body && req.body.title) || "").trim().slice(0, 80);
  if (!title) return res.status(400).json({ error: "El título es requerido" });
  const n = (await db.get("SELECT COUNT(*) AS n FROM albums WHERE user_id = ?", req.user.id)).n;
  if (n >= MAX_ALBUMS) {
    return res.status(400).json({ error: `Máximo ${MAX_ALBUMS} álbumes por usuario` });
  }
  const info = await db.run("INSERT INTO albums (user_id, title) VALUES (?, ?)", req.user.id, title);
  const album = await db.get("SELECT id, title, created_at FROM albums WHERE id = ?", info.lastInsertRowid);
  res.status(201).json({ ok: true, album: { ...album, fotos: 0, portada: null } });
}));

/* Verifica que el álbum exista y pertenezca al usuario actual. */
async function miAlbum(userId, albumId) {
  const id = Number(albumId);
  if (!id) return null;
  return await db.get("SELECT * FROM albums WHERE id = ? AND user_id = ?", id, userId) || null;
}

/* DELETE /api/albums/:id → eliminar álbum (solo dueño; las fotos se borran en cascada). */
router.delete("/:id", requireAuth, ah(async (req, res) => {
  const album = await miAlbum(req.user.id, req.params.id);
  if (!album) return res.status(404).json({ error: "Álbum no encontrado" });
  await db.run("DELETE FROM album_photos WHERE album_id = ?", album.id);
  await db.run("DELETE FROM albums WHERE id = ?", album.id);
  res.json({ ok: true });
}));

/* GET /api/albums/:id/photos → fotos del álbum (dueño o cualquier autenticado). */
router.get("/:id/photos", requireAuth, ah(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Álbum inválido" });
  const album = await db.get("SELECT id, user_id, title FROM albums WHERE id = ?", id);
  if (!album) return res.status(404).json({ error: "Álbum no encontrado" });
  const fotos = await db.all("SELECT id, photo, caption, created_at FROM album_photos WHERE album_id = ? ORDER BY id ASC", id);
  res.json({ album, dueno: album.user_id === req.user.id, fotos });
}));

/* POST /api/albums/:id/photos { photo, caption? } → agregar foto (solo dueño, máx 50). */
router.post("/:id/photos", requireAuth, ah(async (req, res) => {
  const album = await miAlbum(req.user.id, req.params.id);
  if (!album) return res.status(404).json({ error: "Álbum no encontrado" });
  const n = (await db.get("SELECT COUNT(*) AS n FROM album_photos WHERE album_id = ?", album.id)).n;
  if (n >= MAX_PHOTOS) {
    return res.status(400).json({ error: `Máximo ${MAX_PHOTOS} fotos por álbum` });
  }
  const photo = String((req.body && req.body.photo) || "");
  const errFoto = validarFoto(photo);
  if (errFoto) return res.status(400).json({ error: errFoto });
  const caption = String((req.body && req.body.caption) || "").trim().slice(0, 200);
  const info = await db.run("INSERT INTO album_photos (album_id, photo, caption) VALUES (?, ?, ?)", album.id, photo, caption);
  const foto = await db.get("SELECT id, photo, caption, created_at FROM album_photos WHERE id = ?", info.lastInsertRowid);
  res.status(201).json({ ok: true, foto });
}));

/* DELETE /api/albums/:id/photos/:photoId → eliminar foto (solo dueño). */
router.delete("/:id/photos/:photoId", requireAuth, ah(async (req, res) => {
  const album = await miAlbum(req.user.id, req.params.id);
  if (!album) return res.status(404).json({ error: "Álbum no encontrado" });
  const photoId = Number(req.params.photoId);
  const foto = await db.get("SELECT id FROM album_photos WHERE id = ? AND album_id = ?", photoId, album.id);
  if (!foto) return res.status(404).json({ error: "Foto no encontrada" });
  await db.run("DELETE FROM album_photos WHERE id = ?", photoId);
  res.json({ ok: true });
}));

module.exports = { router, MAX_ALBUMS, MAX_PHOTOS };
