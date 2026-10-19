/* Reaviva API — emotional journal entries (replaces localStorage) */
"use strict";

const express = require("express");
const db = require("../db");
const { ah } = db;
const { requireAuth } = require("./auth");

const router = express.Router();
router.use(requireAuth);

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));

/* GET /api/journal  → { entries: { "YYYY-MM-DD": { mood, text } } } */
router.get("/", ah(async (req, res) => {
  const rows = await db.all("SELECT date, mood, text FROM journal WHERE user_id = ? ORDER BY date DESC", req.user.id);
  const entries = {};
  for (const r of rows) entries[r.date] = { mood: r.mood, text: r.text };
  res.json({ entries });
}));

/* POST /api/journal  { date?, mood, text } — upsert one entry (defaults to today) */
router.post("/", ah(async (req, res) => {
  const date = req.body?.date && isDate(req.body.date)
    ? req.body.date
    : new Date().toISOString().slice(0, 10);
  const mood = String(req.body?.mood || "").slice(0, 10);
  const text = String(req.body?.text || "").slice(0, 10000);

  if (!mood && !text)
    return res.status(400).json({ error: "Elige un ánimo o escribe algo primero" });

  await db.run(
    `INSERT INTO journal (user_id, date, mood, text, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, date)
     DO UPDATE SET mood = excluded.mood, text = excluded.text, updated_at = datetime('now')`
  , req.user.id, date, mood, text);

  res.json({ ok: true, date, mood, text });
}));

/* DELETE /api/journal/:date — delete one entry */
router.delete("/:date", ah(async (req, res) => {
  const date = req.params.date;
  if (!isDate(date)) return res.status(400).json({ error: "Fecha inválida (YYYY-MM-DD)" });
  const info = await db.run("DELETE FROM journal WHERE user_id = ? AND date = ?", req.user.id, date);
  if (info.changes === 0) return res.status(404).json({ error: "Entrada no encontrada" });
  res.json({ ok: true });
}));

module.exports = router;
