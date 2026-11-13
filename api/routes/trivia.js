/* Reaviva API — Trivia de Sanación 🎮
 *
 *   GET  /api/trivia/today   → 10 preguntas al azar (SIN respuestas) + mejor puntaje y racha
 *   POST /api/trivia/finish  → valida las respuestas en el servidor, guarda el intento
 *                                y devuelve puntaje, respuestas correctas y explicaciones
 *
 * Las respuestas correctas NUNCA salen del servidor antes de terminar el juego.
 * V1 (orden de Georges, 12 nov 2026): puntos y racha, SIN recompensa de RV.
 * Se puede jugar cuantas veces se quiera; la racha cuenta días distintos jugados.
 */
"use strict";

const express = require("express");
const db = require("../db");
const { ah } = db;
const { requireAuth } = require("./auth");
const QUESTIONS = require("../trivia-questions");

const router = express.Router();

const TZ = "America/La_Paz";
const QUESTIONS_PER_GAME = 10;
const POINTS_PER_CORRECT = 10;

/* Fecha YYYY-MM-DD en America/La_Paz para un instante dado. */
function dayKeyLaPaz(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

/* Día anterior a una fecha YYYY-MM-DD (calendario). */
function prevDayKey(key) {
  const d = new Date(key + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function ensureTable() {
  await db.run(`CREATE TABLE IF NOT EXISTS trivia_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    day_key TEXT NOT NULL,
    score INTEGER NOT NULL,
    correct INTEGER NOT NULL,
    total INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await db.run("CREATE INDEX IF NOT EXISTS idx_trivia_user_day ON trivia_attempts(user_id, day_key)");
}

/* Mejor puntaje histórico del usuario. */
async function bestScore(userId) {
  const row = await db.get("SELECT MAX(score) AS m FROM trivia_attempts WHERE user_id = ?", userId);
  return row && row.m != null ? row.m : 0;
}

/* Racha: días consecutivos jugados terminando hoy o ayer (La Paz). */
async function streakFor(userId) {
  const rows = await db.all("SELECT DISTINCT day_key FROM trivia_attempts WHERE user_id = ? ORDER BY day_key DESC", userId);
  const days = new Set(rows.map(r => r.day_key));
  let key = dayKeyLaPaz();
  if (!days.has(key)) key = prevDayKey(key);
  let streak = 0;
  while (days.has(key)) { streak++; key = prevDayKey(key); }
  return streak;
}

/* Baraja una copia del banco y toma N preguntas. */
function pickQuestions(n) {
  const pool = QUESTIONS.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

/* GET /api/trivia/today — preguntas sin respuestas + estado del jugador. */
router.get("/today", requireAuth, ah(async (req, res) => {
  await ensureTable();
  const questions = pickQuestions(QUESTIONS_PER_GAME).map(q => ({
    id: q.id, q: q.q, options: q.options,
  }));
  const [best, streak] = [await bestScore(req.user.id), await streakFor(req.user.id)];
  const played = await db.get(
    "SELECT COUNT(*) AS c FROM trivia_attempts WHERE user_id = ? AND day_key = ?",
    req.user.id, dayKeyLaPaz()
  );
  res.json({ questions, best, streak, playedToday: (played && played.c) || 0 });
}));

/* POST /api/trivia/answer — { id, choice } → valida una respuesta y
 * devuelve si acertó, la correcta y la explicación. (El puntaje que
 * cuenta es el de /finish, que revalida todo en el servidor.) */
router.post("/answer", requireAuth, ah(async (req, res) => {
  const q = QUESTIONS.find(x => x.id === Number(req.body && req.body.id));
  if (!q) return res.status(400).json({ error: "Pregunta no válida." });
  const choice = Number(req.body.choice);
  if (!Number.isInteger(choice) || choice < 0 || choice >= q.options.length) {
    return res.status(400).json({ error: "Opción no válida." });
  }
  res.json({ correct: choice === q.answer, answer: q.answer, why: q.why });
}));

/* POST /api/trivia/finish — { answers: [{ id, choice }] } */
router.post("/finish", requireAuth, ah(async (req, res) => {
  await ensureTable();
  const answers = req.body && req.body.answers;
  if (!Array.isArray(answers) || answers.length === 0 || answers.length > QUESTIONS_PER_GAME) {
    return res.status(400).json({ error: "answers debe ser una lista de 1 a 10 respuestas." });
  }
  const byId = new Map(QUESTIONS.map(q => [q.id, q]));
  const results = [];
  let correct = 0;
  const seen = new Set();
  for (const a of answers) {
    const q = byId.get(Number(a && a.id));
    if (!q || seen.has(q.id)) continue;
    seen.add(q.id);
    const choice = Number(a.choice);
    const ok = choice === q.answer;
    if (ok) correct++;
    results.push({ id: q.id, correct: ok, answer: q.answer, why: q.why });
  }
  if (results.length === 0) return res.status(400).json({ error: "Ninguna respuesta válida." });
  const score = correct * POINTS_PER_CORRECT;
  await db.run(
    "INSERT INTO trivia_attempts (user_id, day_key, score, correct, total) VALUES (?, ?, ?, ?, ?)",
    req.user.id, dayKeyLaPaz(), score, correct, results.length
  );
  const [best, streak] = [await bestScore(req.user.id), await streakFor(req.user.id)];
  res.json({ score, correct, total: results.length, results, best, streak });
}));

module.exports = { router };
