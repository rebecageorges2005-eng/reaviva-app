/* Reaviva API — 30-day program progress (replaces localStorage) */
"use strict";

const express = require("express");
const db = require("../db");
const { ah } = db;
const { requireAuth } = require("./auth");

const router = express.Router();
router.use(requireAuth);

const todayKey = () => new Date().toISOString().slice(0, 10);

/* Límite freemium: sin plan pagado solo se puede llegar al día 7.
 * El admin y los suscriptores acceden a los 30 días. */
const FREE_MAX_DAY = 7;
function canAccessDay(user, day) {
  if (!user) return false;
  if (user.is_admin === 1 || user.subscribed === 1) return true;
  return Number(day) <= FREE_MAX_DAY;
}

/* Ensure the user has a program_start date (set on first progress read). */
async function ensureStart(user) {
  if (!user.program_start) {
    const d = todayKey();
    await db.run("UPDATE users SET program_start = ? WHERE id = ?", d, user.id);
    user.program_start = d;
  }
  return user.program_start;
}

/* GET /api/progress  → { programStart, doneDays: [1,2,3], currentDay } */
router.get("/", ah(async (req, res) => {
  const programStart = await ensureStart(req.user);
  const rows = await db.all("SELECT day FROM progress WHERE user_id = ? ORDER BY day", req.user.id);
  const doneDays = rows.map((r) => r.day);

  const diff = Math.floor((Date.now() - new Date(programStart + "T12:00:00").getTime()) / 86400000) + 1;
  const currentDay = Math.min(Math.max(diff, 1), 30);

  res.json({ programStart, doneDays, currentDay });
}));

/* POST /api/progress  { day, done } — mark/unmark a day (1–30) */
router.post("/", ah(async (req, res) => {
  const day = Number(req.body?.day);
  const done = req.body?.done !== false; // default true

  if (!Number.isInteger(day) || day < 1 || day > 30)
    return res.status(400).json({ error: "day debe ser un número entre 1 y 30" });

  // Límite freemium: marcar días 8+ como hechos requiere plan de pago.
  if (done && !canAccessDay(req.user, day))
    return res.status(403).json({ error: "Este día requiere un plan de pago 💎" });

  ensureStart(req.user);
  if (done) {
    await db.run(
      "INSERT OR IGNORE INTO progress (user_id, day) VALUES (?, ?)"
    , req.user.id, day);
  } else {
    await db.run("DELETE FROM progress WHERE user_id = ? AND day = ?", req.user.id, day);
  }

  const rows = await db.all("SELECT day FROM progress WHERE user_id = ? ORDER BY day", req.user.id);
  res.json({ doneDays: rows.map((r) => r.day) });
}));

module.exports = { router, canAccessDay, FREE_MAX_DAY };
