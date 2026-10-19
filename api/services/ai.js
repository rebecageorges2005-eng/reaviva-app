/* Reaviva API — asistente de IA.
 * - El admin genera análisis/retos/tests con IA y los VALIDA antes de que lleguen al usuario.
 * - El usuario chatea con la IA de ayuda y ve sus retos aprobados.
 *
 * NOTA: las historias/ejercicios del programa viven en localStorage del frontend,
 * así que el análisis usa lo que hay en la BD: perfil, progreso, diario, tests, banderas.
 */
"use strict";

const express = require("express");
const db = require("../db");
const { ah } = db;
const { requireAuth } = require("./auth");
const { requireAdmin } = require("./admin");
const ai = require("../services/ai");

const router = express.Router();

/* ---------- helpers ---------- */

/* Junta los datos del usuario disponibles en la BD para el análisis de la IA. */
async function collectUserData(userId) {
  const u = await db.get(
    `SELECT id, name, email, gender, birthdate, country, country_code,
            subscribed, is_admin, created_at, last_seen, credits,
            chat_muted, chat_disabled, program_start
     FROM users WHERE id = ?`, userId);
  if (!u) return null;

  const progRows = await db.all("SELECT day FROM progress WHERE user_id = ? ORDER BY day", userId);
  const daysCompleted = progRows.map(r => r.day);
  const currentDay = daysCompleted.length ? Math.min(30, Math.max(...daysCompleted) + 1) : 1;

  const journalRows = await db.all(
    "SELECT date, mood, text FROM journal WHERE user_id = ? ORDER BY date DESC LIMIT 5", userId);

  let flags = 0;
  try {
    const fr = await db.get("SELECT COUNT(*) AS n FROM user_flags WHERE target_user_id = ?", userId);
    flags = fr ? fr.n : 0;
  } catch (e) { /* tabla puede no existir en instalaciones viejas */ }

  let age = null;
  if (u.birthdate && /^\d{4}-\d{2}-\d{2}$/.test(u.birthdate)) {
    const b = new Date(u.birthdate + "T12:00:00");
    const now = new Date();
    age = now.getFullYear() - b.getFullYear() -
      (now < new Date(now.getFullYear(), b.getMonth(), b.getDate()) ? 1 : 0);
  }

  return {
    id: u.id,
    name: u.name,
    gender: u.gender,
    age,
    country: u.country,
    planType: u.subscribed === 1 ? "pago" : "gratis",
    currentDay,
    daysCompleted: daysCompleted.length,
    journalEntries: journalRows.length,
    recentJournal: journalRows.map(j => `[${j.date} ${j.mood || ""}] ${String(j.text || "").slice(0, 400)}`).join("\n"),
    flags,
    chatMuted: u.chat_muted === 1 || u.chat_disabled === 1,
    rvBalance: u.credits || 0,
    testScores: null, // los tests de progreso viven en localStorage del frontend
  };
}

/* Guarda (o actualiza) el análisis en ai_user_analysis. */
async function saveAnalysis(userId, text) {
  const risk = /alto/i.test(text.slice(0, 2000)) && /riesgo/i.test(text.slice(0, 2000))
    ? "alto" : (/medio/i.test(text) ? "medio" : "bajo");
  // Extrae temas clave si la IA los listó (best-effort).
  const keyIssues = (text.match(/TEMAS CLAVE([\s\S]{0,600})/i) || [])[1] || "";
  const summary = (text.match(/RESUMEN DEL CASO([\s\S]{0,600})/i) || [])[1] || "";
  await db.run(
    `INSERT INTO ai_user_analysis (user_id, analysis_text, key_issues, progress_summary, risk_level, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       analysis_text = excluded.analysis_text,
       key_issues = excluded.key_issues,
       progress_summary = excluded.progress_summary,
       risk_level = excluded.risk_level,
       updated_at = datetime('now')`,
    userId, text, keyIssues.trim().slice(0, 2000), summary.trim().slice(0, 2000), risk);
}

/* Crea un reporte pendiente para el admin. Devuelve el id. */
async function createReport(userId, reportType, title, content) {
  const info = await db.run(
    "INSERT INTO ai_reports (user_id, report_type, title, content, status) VALUES (?, ?, ?, ?, 'pending')",
    userId, reportType, title, content);
  return info.lastInsertRowid;
}

/* ============ ADMIN ============ */

/* POST /api/admin/ai/analyze/:userId — genera análisis del caso con IA.
 * Guarda en ai_user_analysis y crea ai_reports (analysis, pending). */
router.post("/admin/ai/analyze/:userId", requireAdmin, ah(async (req, res) => {
  const userId = Number(req.params.userId);
  if (!userId) return res.status(400).json({ error: "ID inválido" });
  if (!ai.hasKey())
    return res.status(503).json({ error: "Falta configurar OPENAI_API_KEY en el servidor" });

  const data = await collectUserData(userId);
  if (!data) return res.status(404).json({ error: "Usuario no encontrado" });

  const r = await ai.analyzeUserCase(data);
  if (!r.ok) return res.status(502).json({ error: "La IA no respondió: " + r.error });

  await saveAnalysis(userId, r.text);
  const reportId = await createReport(
    userId, "analysis",
    `Análisis IA: ${data.name}`,
    r.text);

  res.json({ ok: true, reportId, analysis: r.text });
}));

/* GET /api/admin/ai/reports — lista reportes (filtro ?status=pending). */
router.get("/admin/ai/reports", requireAdmin, ah(async (req, res) => {
  const status = String(req.query.status || "pending");
  const rows = await db.all(
    `SELECT r.*, u.name AS user_name, u.email AS user_email
     FROM ai_reports r JOIN users u ON u.id = r.user_id
     WHERE r.status = ?
     ORDER BY r.created_at DESC LIMIT 100`, status);
  res.json({ reports: rows });
}));

/* POST /api/admin/ai/reports/:id/approve — aprueba un reporte. */
router.post("/admin/ai/reports/:id/approve", requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  const info = await db.run(
    "UPDATE ai_reports SET status = 'approved', reviewed_at = datetime('now') WHERE id = ? AND status = 'pending'", id);
  if (!info.changes) return res.status(404).json({ error: "Reporte no encontrado o ya revisado" });
  res.json({ ok: true });
}));

/* POST /api/admin/ai/reports/:id/reject — rechaza con feedback del admin. */
router.post("/admin/ai/reports/:id/reject", requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  const feedback = String(req.body?.admin_feedback || "").slice(0, 2000);
  const info = await db.run(
    "UPDATE ai_reports SET status = 'rejected', admin_feedback = ?, reviewed_at = datetime('now') WHERE id = ? AND status = 'pending'",
    feedback, id);
  if (!info.changes) return res.status(404).json({ error: "Reporte no encontrado o ya revisado" });
  res.json({ ok: true });
}));

/* POST /api/admin/ai/challenge/:userId — genera un reto personalizado (pending + reporte). */
router.post("/admin/ai/challenge/:userId", requireAdmin, ah(async (req, res) => {
  const userId = Number(req.params.userId);
  if (!userId) return res.status(400).json({ error: "ID inválido" });
  if (!ai.hasKey())
    return res.status(503).json({ error: "Falta configurar OPENAI_API_KEY en el servidor" });

  const data = await collectUserData(userId);
  if (!data) return res.status(404).json({ error: "Usuario no encontrado" });

  const analysis = await db.get("SELECT progress_summary FROM ai_user_analysis WHERE user_id = ?", userId);
  if (analysis) data.analysisSummary = analysis.progress_summary;

  const r = await ai.generateChallenge(data);
  if (!r.ok) return res.status(502).json({ error: "La IA no respondió: " + r.error });

  const info = await db.run(
    "INSERT INTO ai_challenges (user_id, title, description, day_target, status) VALUES (?, ?, ?, ?, 'pending')",
    userId, r.title, r.description, data.currentDay);
  const challengeId = info.lastInsertRowid;

  const reportId = await createReport(
    userId, "challenge",
    `Reto IA para ${data.name}: ${r.title}`,
    `TÍTULO: ${r.title}\n\nDESCRIPCIÓN:\n${r.description}\n\n(challenge_id: ${challengeId})`);

  res.json({ ok: true, challengeId, reportId, title: r.title, description: r.description });
}));

/* GET /api/admin/ai/challenges — retos pendientes de aprobación. */
router.get("/admin/ai/challenges", requireAdmin, ah(async (req, res) => {
  const status = String(req.query.status || "pending");
  const rows = await db.all(
    `SELECT c.*, u.name AS user_name, u.email AS user_email
     FROM ai_challenges c JOIN users u ON u.id = c.user_id
     WHERE c.status = ?
     ORDER BY c.created_at DESC LIMIT 100`, status);
  res.json({ challenges: rows });
}));

/* POST /api/admin/ai/challenges/:id/approve — aprueba el reto (llega al usuario). */
router.post("/admin/ai/challenges/:id/approve", requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  const info = await db.run(
    "UPDATE ai_challenges SET status = 'approved' WHERE id = ? AND status = 'pending'", id);
  if (!info.changes) return res.status(404).json({ error: "Reto no encontrado o ya revisado" });
  // Marca sus reportes como aprobados también.
  await db.run("UPDATE ai_reports SET status = 'approved', reviewed_at = datetime('now') WHERE report_type = 'challenge' AND status = 'pending' AND content LIKE ?", `%challenge_id: ${id}%`);
  res.json({ ok: true });
}));

/* POST /api/admin/ai/challenges/:id/modify — el admin edita título/descripción y aprueba. */
router.post("/admin/ai/challenges/:id/modify", requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  const title = String(req.body?.title || "").trim().slice(0, 120);
  const description = String(req.body?.description || "").trim().slice(0, 2000);
  const adminNotes = String(req.body?.admin_notes || "").trim().slice(0, 1000);
  if (!title || !description)
    return res.status(400).json({ error: "Título y descripción son requeridos" });
  const info = await db.run(
    "UPDATE ai_challenges SET title = ?, description = ?, admin_notes = ?, status = 'approved' WHERE id = ? AND status = 'pending'",
    title, description, adminNotes || null, id);
  if (!info.changes) return res.status(404).json({ error: "Reto no encontrado o ya revisado" });
  await db.run("UPDATE ai_reports SET status = 'approved', reviewed_at = datetime('now') WHERE report_type = 'challenge' AND status = 'pending' AND content LIKE ?", `%challenge_id: ${id}%`);
  res.json({ ok: true });
}));

/* POST /api/admin/ai/challenges/:id/reject — rechaza un reto pendiente. */
router.post("/admin/ai/challenges/:id/reject", requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  const adminNotes = String(req.body?.admin_notes || "").trim().slice(0, 1000);
  const info = await db.run(
    "UPDATE ai_challenges SET status = 'rejected', admin_notes = ? WHERE id = ? AND status = 'pending'",
    adminNotes || null, id);
  if (!info.changes) return res.status(404).json({ error: "Reto no encontrado o ya revisado" });
  res.json({ ok: true });
}));

/* POST /api/admin/ai/test/:userId — genera test personalizado (reporte pending para validar). */
router.post("/admin/ai/test/:userId", requireAdmin, ah(async (req, res) => {
  const userId = Number(req.params.userId);
  if (!userId) return res.status(400).json({ error: "ID inválido" });
  if (!ai.hasKey())
    return res.status(503).json({ error: "Falta configurar OPENAI_API_KEY en el servidor" });

  const data = await collectUserData(userId);
  if (!data) return res.status(404).json({ error: "Usuario no encontrado" });
  const analysis = await db.get("SELECT progress_summary FROM ai_user_analysis WHERE user_id = ?", userId);
  if (analysis) data.analysisSummary = analysis.progress_summary;

  const r = await ai.generateTestQuestions(data);
  if (!r.ok) return res.status(502).json({ error: "La IA no respondió: " + r.error });

  const reportId = await createReport(
    userId, "test",
    `Test personalizado IA para ${data.name}`,
    r.text);

  res.json({ ok: true, reportId, questions: r.text });
}));

/* ============ USUARIO ============ */

/* GET /api/ai/challenges — retos aprobados del usuario actual. */
router.get("/ai/challenges", requireAuth, ah(async (req, res) => {
  const rows = await db.all(
    "SELECT id, title, description, day_target, created_at FROM ai_challenges WHERE user_id = ? AND status = 'approved' ORDER BY created_at DESC LIMIT 20",
    req.user.id);
  res.json({ challenges: rows });
}));

/* POST /api/ai/chat { message } — chat de ayuda con la IA. */
router.post("/ai/chat", requireAuth, ah(async (req, res) => {
  const message = String(req.body?.message || "").slice(0, 2000);
  if (!message.trim()) return res.status(400).json({ error: "Escribe un mensaje" });
  if (!ai.hasKey())
    return res.status(503).json({ error: "El asistente IA no está configurado todavía. Escríbenos por contacto 💛" });

  const data = await collectUserData(req.user.id);
  const analysis = await db.get("SELECT progress_summary FROM ai_user_analysis WHERE user_id = ?", req.user.id);

  const r = await ai.chatWithUser(message, {
    name: data ? data.name : req.user.name,
    currentDay: data ? data.currentDay : 1,
    analysisSummary: analysis ? analysis.progress_summary : null,
  });
  if (!r.ok) return res.status(502).json({ error: "La IA no respondió ahorita. Inténtalo de nuevo 💛" });
  res.json({ ok: true, reply: r.text });
}));

module.exports = { router };
