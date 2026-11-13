/* Reaviva API — Trivia de Sanación 🎮
 *
 *   GET  /api/trivia/today    → 10 preguntas al azar (SIN respuestas) + estado del jugador
 *   POST /api/trivia/answer   → valida una respuesta y devuelve la explicación
 *   POST /api/trivia/finish   → valida el juego, aplica errores y paga el premio
 *   POST /api/trivia/recharge → recarga los corazones con RV (o renovación de 48h)
 *
 * Las respuestas correctas NUNCA salen del servidor antes de terminar el juego.
 *
 * CORAZONES Y RV (órdenes de Georges, 12 nov 2026):
 * - Cada ciclo empieza con 3 corazones = 30 RV en juego; cada error quita
 *   5 RV (medio corazón). Los corazones perdidos NO se recuperan al volver
 *   a jugar dentro del mismo ciclo.
 * - REGALÍA: al terminar una partida COMPLETA (10 preguntas) con al menos
 *   MEDIO corazón (5 RV), lo que queda va al saldo del usuario. En 0
 *   corazones NO hay regalía. El premio se paga UNA vez por ciclo.
 * - RECARGA: al quedar en 0 corazones, para jugar hay que recargar:
 *   se descuentan EXACTAMENTE 30 RV de la cuenta principal. Si el saldo
 *   es menor de 30 RV, NO se aplica ningún cambio (sin recarga parcial).
 *   La recarga es automática al intentar jugar teniendo saldo.
 * - RENOVACIÓN 48H: si los corazones llevan 48 horas en 0 Y el saldo es
 *   de al menos 30 RV, los corazones vuelven solos y GRATIS (sin descuento).
 *   Si el saldo es menor de 30 RV, la renovación de 48 horas NO se aplica:
 *   el usuario debe comprar RV (plan mínimo $12 USD = 120 RV).
 */
"use strict";

const express = require("express");
const db = require("../db");
const { ah } = db;
const { requireAuth } = require("./auth");
const { getRV } = require("../spam");
const QUESTIONS = require("../trivia-questions");

const router = express.Router();

const TZ = "America/La_Paz";
const QUESTIONS_PER_GAME = 10;
const POINTS_PER_CORRECT = 10;
const RV_START = 30;          // 3 corazones × 10 RV
const RV_PER_ERROR = 5;       // medio corazón por error
const RV_RECHARGE = 30;       // costo exacto de la recarga
const RENEW_MS = 48 * 60 * 60 * 1000;

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

/* Marca temporal UTC "YYYY-MM-DD HH:MM:SS" (mismo formato que datetime('now')). */
function utcStamp(date = new Date()) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

async function ensureTables() {
  await db.run(`CREATE TABLE IF NOT EXISTS trivia_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    day_key TEXT NOT NULL,
    score INTEGER NOT NULL,
    correct INTEGER NOT NULL,
    total INTEGER NOT NULL,
    rv_earned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await db.run("CREATE INDEX IF NOT EXISTS idx_trivia_user_day ON trivia_attempts(user_id, day_key)");
  try {
    const cols = await db.all("PRAGMA table_info(trivia_attempts)");
    if (!cols.some(c => c.name === "rv_earned")) {
      await db.run("ALTER TABLE trivia_attempts ADD COLUMN rv_earned INTEGER NOT NULL DEFAULT 0");
    }
    const cols2 = await db.all("PRAGMA table_info(trivia_attempts)");
    if (!cols2.some(c => c.name === "cycle_no")) {
      await db.run("ALTER TABLE trivia_attempts ADD COLUMN cycle_no INTEGER NOT NULL DEFAULT 1");
    }
  } catch (e) { /* Las columnas ya existen. */ }
  await db.run(`CREATE TABLE IF NOT EXISTS trivia_hearts (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    hearts INTEGER NOT NULL DEFAULT 30,
    cycle_started_at TEXT NOT NULL,
    cycle_no INTEGER NOT NULL DEFAULT 1,
    depleted_at TEXT,
    updated_at TEXT NOT NULL
  )`);
  try {
    const colsH = await db.all("PRAGMA table_info(trivia_hearts)");
    if (!colsH.some(c => c.name === "cycle_no")) {
      await db.run("ALTER TABLE trivia_hearts ADD COLUMN cycle_no INTEGER NOT NULL DEFAULT 1");
    }
  } catch (e) { /* La columna ya existe. */ }
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

/* Estado de corazones del usuario, aplicando la renovación de 48h si toca.
 * Devuelve { hearts, cycleStartedAt, cycleNo, depletedAt, renewsAt }.
 * La renovación GRATIS exige 48h en 0 Y saldo >= 30 RV (orden de Georges).
 * cycle_no sube en cada renovación/recarga: identifica el ciclo sin
 * depender de marcas de tiempo (dos ciclos en el mismo segundo chocarían). */
async function heartsState(userId) {
  let row = await db.get("SELECT * FROM trivia_hearts WHERE user_id = ?", userId);
  if (!row) {
    const now = utcStamp();
    await db.run(
      "INSERT INTO trivia_hearts (user_id, hearts, cycle_started_at, cycle_no, depleted_at, updated_at) VALUES (?, ?, ?, 1, NULL, ?)",
      userId, RV_START, now, now
    );
    return { hearts: RV_START, cycleStartedAt: now, cycleNo: 1, depletedAt: null, renewsAt: null, renewed: false };
  }
  const cycleNo = row.cycle_no || 1;
  if (row.hearts <= 0 && row.depleted_at) {
    const depletedMs = new Date(row.depleted_at.replace(" ", "T") + "Z").getTime();
    if (!isNaN(depletedMs) && Date.now() - depletedMs >= RENEW_MS) {
      const balance = await getRV(userId);
      if (balance >= RV_RECHARGE) {
        const now = utcStamp();
        await db.run(
          "UPDATE trivia_hearts SET hearts = ?, cycle_started_at = ?, cycle_no = ?, depleted_at = NULL, updated_at = ? WHERE user_id = ?",
          RV_START, now, cycleNo + 1, now, userId
        );
        return { hearts: RV_START, cycleStartedAt: now, cycleNo: cycleNo + 1, depletedAt: null, renewsAt: null, renewed: true };
      }
    }
    const renewsAt = new Date(new Date(row.depleted_at.replace(" ", "T") + "Z").getTime() + RENEW_MS).toISOString();
    return { hearts: 0, cycleStartedAt: row.cycle_started_at, cycleNo, depletedAt: row.depleted_at, renewsAt, renewed: false };
  }
  return { hearts: row.hearts, cycleStartedAt: row.cycle_started_at, cycleNo, depletedAt: row.depleted_at, renewsAt: null, renewed: false };
}

/* RV ganados en el ciclo actual (para mostrar "ya ganaste X RV"). */
async function rvEarnedInCycle(userId, cycleNo) {
  const row = await db.get(
    "SELECT COALESCE(SUM(rv_earned), 0) AS s FROM trivia_attempts WHERE user_id = ? AND cycle_no = ?",
    userId, cycleNo
  );
  return (row && row.s) || 0;
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
  await ensureTables();
  const questions = pickQuestions(QUESTIONS_PER_GAME).map(q => ({
    id: q.id, q: q.q, options: q.options,
  }));
  const [best, streak, hearts] = [await bestScore(req.user.id), await streakFor(req.user.id), await heartsState(req.user.id)];
  const played = await db.get(
    "SELECT COUNT(*) AS c FROM trivia_attempts WHERE user_id = ? AND day_key = ?",
    req.user.id, dayKeyLaPaz()
  );
  res.json({
    questions, best, streak,
    playedToday: (played && played.c) || 0,
    rvEarnedToday: await rvEarnedInCycle(req.user.id, hearts.cycleNo),
    rvLeftToday: hearts.hearts,
    renewsAt: hearts.renewsAt,
    rvBalance: await getRV(req.user.id),
  });
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
  await ensureTables();
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
  const errors = results.length - correct;

  // Aplicar los errores a los corazones del ciclo.
  const before = await heartsState(req.user.id);
  const heartsAfter = Math.max(0, before.hearts - RV_PER_ERROR * errors);
  const now = utcStamp();
  const depletedAt = heartsAfter <= 0 ? (before.depletedAt || now) : null;
  await db.run(
    "UPDATE trivia_hearts SET hearts = ?, depleted_at = ?, updated_at = ? WHERE user_id = ?",
    heartsAfter, depletedAt, now, req.user.id
  );

  // REGALÍA: partida completa (10 preguntas) con al menos medio corazón
  // (5 RV). En 0 corazones NO hay regalía. Una vez por ciclo.
  const complete = results.length >= QUESTIONS_PER_GAME;
  let rvEarned = 0;
  if (complete && heartsAfter >= RV_PER_ERROR) {
    const ins = await db.run(
      `INSERT INTO credit_purchases (user_id, pack_credits, amount_usd, paypal_order_id, status, created_at)
       VALUES (?, ?, 0, ?, 'trivia_reward', datetime('now'))
       ON CONFLICT(paypal_order_id) DO NOTHING`,
      req.user.id, heartsAfter, "TRIVIA-" + req.user.id + "-C" + before.cycleNo
    );
    if (ins && ins.changes > 0) {
      await db.run("UPDATE users SET credits = credits + ? WHERE id = ?", heartsAfter, req.user.id);
      rvEarned = heartsAfter;
    }
  }
  await db.run(
    "INSERT INTO trivia_attempts (user_id, day_key, score, correct, total, rv_earned, cycle_no) VALUES (?, ?, ?, ?, ?, ?, ?)",
    req.user.id, dayKeyLaPaz(), score, correct, results.length, rvEarned, before.cycleNo
  );
  const [best, streak] = [await bestScore(req.user.id), await streakFor(req.user.id)];
  const after = await heartsState(req.user.id);
  res.json({
    score, correct, total: results.length, results, best, streak,
    rvEarned, rvBalance: await getRV(req.user.id),
    rvLeftToday: after.hearts, renewsAt: after.renewsAt,
  });
}));

/* POST /api/trivia/recharge — recarga los corazones en 0.
 * - Si ya pasaron 48h en 0 y el saldo es >= 30 RV: renovación GRATIS.
 * - Si no: descuenta EXACTAMENTE 30 RV de la cuenta principal (solo si
 *   el saldo alcanza; si no alcanza, NO se aplica ningún cambio).
 * - Si el saldo es menor de 30 RV: 402 con needPack (comprar RV). */
router.post("/recharge", requireAuth, ah(async (req, res) => {
  await ensureTables();
  const state = await heartsState(req.user.id);
  if (state.hearts > 0) {
    // Corazones llenos: o nunca se acabaron, o la renovación de 48h
    // acaba de aplicar (gratis, sin descuento).
    return res.json({ recharged: !!state.renewed, free: !!state.renewed, hearts: state.hearts, rvBalance: await getRV(req.user.id) });
  }
  // Siguen en 0: toca recarga con RV (o comprar si no alcanza).
  const upd = await db.run(
    "UPDATE users SET credits = credits - ? WHERE id = ? AND credits >= ?",
    RV_RECHARGE, req.user.id, RV_RECHARGE
  );
  if (!upd || upd.changes <= 0) {
    return res.status(402).json({
      error: "Necesitas al menos 30 RV para recargar tus corazones.",
      needPack: true, rvBalance: await getRV(req.user.id),
    });
  }
  await db.run(
    `INSERT INTO credit_spending (user_id, credits_used, reason, created_at)
     VALUES (?, ?, 'trivia_recharge', datetime('now'))`,
    req.user.id, RV_RECHARGE
  );
  const now = utcStamp();
  await db.run(
    "UPDATE trivia_hearts SET hearts = ?, cycle_started_at = ?, cycle_no = ?, depleted_at = NULL, updated_at = ? WHERE user_id = ?",
    RV_START, now, (state.cycleNo || 1) + 1, now, req.user.id
  );
  res.json({ recharged: true, free: false, hearts: RV_START, rvBalance: await getRV(req.user.id) });
}));

module.exports = { router };
