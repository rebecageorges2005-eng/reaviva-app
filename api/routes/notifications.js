/* Reaviva API — notificaciones diarias del programa.
 *
 *   GET  /api/notifications              → avisos sin leer del usuario
 *   POST /api/notifications/:id/read     → marcar un aviso como leído
 *   POST /api/admin/daily-notifications  → generar el aviso del día
 *        (SOLO admin; lo dispara el cron externo del agente principal.
 *        Body opcional: { "dayKey": "YYYY-MM-DD" } para reponer un día
 *        concreto; sin dayKey usa hoy en America/La_Paz. La generación
 *        es idempotente: re-ejecutarla el mismo día no duplica avisos
 *        ni correos. Ver api/DAILY_NOTIFICATIONS.md.)
 *
 * El aviso en app lo muestra el banner de la pantalla principal
 * (web/app.js: checkDailyNotifications) y se cierra marcándolo leído.
 */
"use strict";

const express = require("express");
const db = require("../db");
const { ah } = db;
const { requireAuth } = require("./auth");
const { generateDailyNotifications, ensureTable } = require("../daily-notifications");

/* --- Avisos del usuario --- */
const router = express.Router();

router.get("/", requireAuth, ah(async (req, res) => {
  await ensureTable();
  const rows = await db.all(
    `SELECT id, day_key, program_day, title, body, created_at
     FROM user_notifications
     WHERE user_id = ? AND read_at IS NULL
     ORDER BY created_at DESC LIMIT 10`,
    req.user.id);
  res.json({
    notifications: rows.map((r) => ({
      id: r.id,
      dayKey: r.day_key,
      programDay: r.program_day,
      titulo: r.title,
      cuerpo: r.body,
      fecha: r.created_at,
    })),
  });
}));

router.post("/:id/read", requireAuth, ah(async (req, res) => {
  await ensureTable();
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "ID inválido" });
  await db.run(
    `UPDATE user_notifications SET read_at = datetime('now')
     WHERE id = ? AND user_id = ?`,
    id, req.user.id);
  res.json({ ok: true });
}));

/* --- Disparo diario (solo admin) --- */
const adminRouter = express.Router();

adminRouter.post("/daily-notifications", requireAuth, ah(async (req, res) => {
  if (req.user.is_admin !== 1) {
    return res.status(403).json({ error: "Solo administradores" });
  }
  const dayKey = req.body?.dayKey ? String(req.body.dayKey) : undefined;
  const summary = await generateDailyNotifications({ dayKey });
  console.log(`[daily-notifications] día ${summary.dayKey}: ` +
    `${summary.generated} generados, ${summary.emailed} correos, ` +
    `${summary.skipped} ya tenían aviso, ${summary.failures.length} fallos`);
  res.json({ ok: true, ...summary });
}));

module.exports = { notificationsRouter: router, dailyAdminRouter: adminRouter };
