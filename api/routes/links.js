/* Reaviva API — Link Pub: links que el ADMIN publica en el perfil de los
 * usuarios (promocionar su canal, blog, etc.).
 *
 * GET /api/links/mine → los links que aplican al usuario actual:
 * un link aplica si su segmentación lo incluye:
 *   - target_users vacío      → todos los usuarios
 *   - target_countries vacío → todos los países
 *   - target_gender vacío     → ambos sexos
 * Si no hay links para el usuario, la lista va vacía (la sección del perfil
 * queda invisible).
 */
"use strict";

const express = require("express");
const db = require("../db");
const { ah } = db;
const { requireAuth } = require("./auth");

const router = express.Router();

function parseList(v) {
  if (!v) return [];
  try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; }
  catch (e) { return []; }
}

function linkMatches(link, user) {
  const users = parseList(link.target_users).map(Number);
  if (users.length && !users.includes(Number(user.id))) return false;
  const countries = parseList(link.target_countries);
  if (countries.length && !countries.includes(String(user.country || ""))) return false;
  const g = String(link.target_gender || "").toUpperCase();
  if ((g === "M" || g === "F") && String(user.gender || "").toUpperCase() !== g) return false;
  return true;
}

router.get("/mine", requireAuth, ah(async (req, res) => {
  const rows = await db.all("SELECT id, url, title, target_users, target_countries, target_gender, created_at FROM admin_links ORDER BY id DESC");
  const links = rows
    .filter((l) => linkMatches(l, req.user))
    .map((l) => ({ id: l.id, url: l.url, title: l.title || "", created_at: l.created_at }));
  res.json({ links });
}));

module.exports = { router };
