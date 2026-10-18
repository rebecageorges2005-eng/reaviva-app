/* Reaviva API — admin dashboard.
 *
 * Todas las rutas exigen is_admin === 1 (middleware requireAdmin).
 * Endpoints:
 *   GET  /api/admin/stats            → resumen general
 *   GET  /api/admin/growth           → últimos 30 días (gráfico de crecimiento)
 *   GET  /api/admin/users            → lista de usuarios con su plan
 *   GET  /api/admin/users/:id        → detalle de un usuario
 *   GET  /api/admin/messages         → mensajes enviados por el admin
 *   POST /api/admin/messages         → enviar mensaje a un usuario o a todos
 */
"use strict";

const express = require("express");
const db = require("../db");
const { requireAuth } = require("./auth");

const router = express.Router();

/* Solo administradores. */
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.is_admin !== 1)
      return res.status(403).json({ error: "Solo administradores" });
    next();
  });
}

/* ---------- helpers ---------- */
function planLabel(row) {
  if (!row) return "SIN PLAN";
  if (row.status === "ACTIVE") return "CON PLAN";
  if (row.status === "PAST_DUE") return "PAGO VENCIDO";
  if (row.status === "CANCELLED") return "CANCELADO";
  return "SIN PLAN";
}

function fmtDay(iso) {
  if (!iso) return "—";
  const d = new Date(iso.length <= 10 ? iso + "T12:00:00" : iso);
  if (isNaN(d)) return "—";
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fmtDateTime(iso) {
  if (!iso) return "nunca";
  const d = new Date(iso.length <= 10 ? iso + "T12:00:00" : iso.replace(" ", "T") + "Z");
  if (isNaN(d)) return "—";
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return "ahora mismo";
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `hace ${diffH} h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return "ayer";
  if (diffD < 7) return `hace ${diffD} días`;
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/* ---------- GET /api/admin/stats ---------- */
router.get("/stats", requireAdmin, (req, res) => {
  const totalUsers = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  const subscribedUsers = db.prepare("SELECT COUNT(*) AS n FROM users WHERE subscribed = 1").get().n;
  const trialUsers = db.prepare("SELECT COUNT(*) AS n FROM users WHERE subscribed = 0").get().n;
  const onlineNow = db
    .prepare("SELECT COUNT(*) AS n FROM users WHERE last_seen >= datetime('now', '-5 minutes')")
    .get().n;
  const signupsToday = db
    .prepare("SELECT COUNT(*) AS n FROM users WHERE date(created_at) = date('now')")
    .get().n;
  const activeSubscriptions = db
    .prepare("SELECT COUNT(*) AS n FROM paypal_subscriptions WHERE status = 'ACTIVE'")
    .get().n;
  // Estimación de ingresos mensuales recurrentes (MRR): 4.99 mensual, 39.99/12 anual
  const plans = db
    .prepare("SELECT plan, COUNT(*) AS n FROM paypal_subscriptions WHERE status = 'ACTIVE' GROUP BY plan")
    .all();
  let mrr = 0;
  for (const p of plans) {
    if (p.plan === "monthly") mrr += p.n * 4.99;
    else if (p.plan === "yearly") mrr += p.n * (39.99 / 12);
  }

  res.json({
    totalUsers,
    subscribedUsers,
    trialUsers,
    onlineNow,
    signupsToday,
    activeSubscriptions,
    mrr: Math.round(mrr * 100) / 100,
  });
});

/* ---------- GET /api/admin/growth ----------
 * ?days=N — período: 8, 15, 30, 60, 90, 180, 365 (por defecto 30).
 * Si days <= 90 agrupa por día; si days > 90 agrupa por semana
 * (strftime('%Y-%W')) para que la tabla/gráfico no sea eterna.
 * Rellena los períodos sin actividad con ceros para que el gráfico sea continuo. */
router.get("/growth", requireAdmin, (req, res) => {
  const ALLOWED = [8, 15, 30, 60, 90, 180, 365];
  let days = parseInt(req.query.days, 10);
  if (!ALLOWED.includes(days)) days = 30;
  const byWeek = days > 90;

  let rows;
  if (byWeek) {
    rows = db
      .prepare(
        `SELECT strftime('%Y-%W', created_at) AS periodo, COUNT(*) AS signups, SUM(subscribed) AS new_subs
         FROM users
         WHERE created_at >= date('now', '-' || ? || ' days')
         GROUP BY periodo
         ORDER BY periodo`
      )
      .all(days);
  } else {
    rows = db
      .prepare(
        `SELECT date(created_at) AS periodo, COUNT(*) AS signups, SUM(subscribed) AS new_subs
         FROM users
         WHERE created_at >= date('now', '-' || ? || ' days')
         GROUP BY periodo
         ORDER BY periodo`
      )
      .all(days);
  }

  const byPeriodo = {};
  for (const r of rows) byPeriodo[r.periodo] = { signups: r.signups, newSubs: r.new_subs || 0 };

  const periods = [];
  if (byWeek) {
    // Genera las semanas del período (lunes de cada semana)
    const today = new Date();
    const monday = new Date(today);
    const dow = (monday.getDay() + 6) % 7; // 0 = lunes
    monday.setDate(monday.getDate() - dow);
    const numWeeks = Math.ceil(days / 7);
    for (let i = numWeeks - 1; i >= 0; i--) {
      const w = new Date(monday);
      w.setDate(w.getDate() - i * 7);
      const year = w.getFullYear();
      // semana ISO aproximada (coincide con strftime %W lo suficiente para etiquetas)
      const weekNum = String(Math.ceil((((w - new Date(year, 0, 1)) / 86400000) + 1) / 7)).padStart(2, "0");
      const key = `${year}-${weekNum}`;
      const v = byPeriodo[key] || { signups: 0, newSubs: 0 };
      const label = `semana del ${w.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" })}`;
      periods.push({
        periodo: key,
        etiqueta: label,
        nuevosUsuarios: v.signups,
        nuevosConPlan: v.newSubs,
      });
    }
  } else {
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const v = byPeriodo[key] || { signups: 0, newSubs: 0 };
      periods.push({
        periodo: key,
        etiqueta: d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" }),
        nuevosUsuarios: v.signups,
        nuevosConPlan: v.newSubs,
      });
    }
  }

  const totalSignups = periods.reduce((a, p) => a + p.nuevosUsuarios, 0);
  const totalSubs = periods.reduce((a, p) => a + p.nuevosConPlan, 0);

  res.json({ days, porSemana: byWeek, periods, totalSignups, totalSubs });
});

/* ---------- GET /api/admin/users ---------- */
router.get("/users", requireAdmin, (req, res) => {
  const users = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.subscribed, u.is_admin, u.created_at, u.last_seen,
              s.plan, s.status AS sub_status, s.next_billing_date
       FROM users u
       LEFT JOIN paypal_subscriptions s ON s.email = u.email
       ORDER BY u.created_at DESC
       LIMIT 500`
    )
    .all();

  res.json({
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      nombre: u.name,
      conPlan: u.subscribed === 1,
      plan: planLabel(u.sub_status ? { status: u.sub_status } : null),
      planDetalle: u.plan || null,
      estadoSuscripcion: u.sub_status || null,
      proximoCobro: u.next_billing_date ? fmtDay(u.next_billing_date) : null,
      esAdmin: u.is_admin === 1,
      registrado: fmtDateTime(u.created_at),
      registradoRaw: u.created_at,
      ultimaConexion: fmtDateTime(u.last_seen),
      enLinea: !!u.last_seen && new Date(u.last_seen.replace(" ", "T") + "Z").getTime() > Date.now() - 5 * 60000,
    })),
  });
});

/* ---------- GET /api/admin/users/:id ---------- */
router.get("/users/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "ID inválido" });

  const u = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.subscribed, u.is_admin, u.created_at, u.last_seen,
              u.program_start,
              s.plan, s.status AS sub_status, s.next_billing_date, s.subscription_id
       FROM users u
       LEFT JOIN paypal_subscriptions s ON s.email = u.email
       WHERE u.id = ?`
    )
    .get(id);
  if (!u) return res.status(404).json({ error: "Usuario no encontrado" });

  const progressCount = db.prepare("SELECT COUNT(*) AS n FROM progress WHERE user_id = ?").get(id).n;
  const journalCount = db.prepare("SELECT COUNT(*) AS n FROM journal WHERE user_id = ?").get(id).n;
  const lastProgress = db
    .prepare("SELECT MAX(day) AS d FROM progress WHERE user_id = ?")
    .get(id).d;

  res.json({
    id: u.id,
    email: u.email,
    nombre: u.name,
    conPlan: u.subscribed === 1,
    plan: planLabel(u.sub_status ? { status: u.sub_status } : null),
    planDetalle: u.plan || null,
    estadoSuscripcion: u.sub_status || null,
    proximoCobro: u.next_billing_date ? fmtDay(u.next_billing_date) : null,
    subscriptionId: u.subscription_id || null,
    esAdmin: u.is_admin === 1,
    registrado: fmtDateTime(u.created_at),
    ultimaConexion: fmtDateTime(u.last_seen),
    enLinea: !!u.last_seen && new Date(u.last_seen.replace(" ", "T") + "Z").getTime() > Date.now() - 5 * 60000,
    inicioPrograma: u.program_start ? fmtDay(u.program_start) : null,
    diasCompletados: progressCount,
    ultimoDiaCompletado: lastProgress || 0,
    entradasDiario: journalCount,
  });
});

/* ---------- GET /api/admin/messages ---------- */
router.get("/messages", requireAdmin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, user_id, email, title, body, created_at, read_at
       FROM admin_messages
       ORDER BY created_at DESC
       LIMIT 100`
    )
    .all();
  res.json({
    messages: rows.map((m) => ({
      id: m.id,
      para: m.user_id ? m.email || `usuario #${m.user_id}` : "TODOS",
      titulo: m.title,
      cuerpo: m.body,
      enviado: fmtDateTime(m.created_at),
      leido: !!m.read_at,
    })),
  });
});

/* ---------- POST /api/admin/messages ----------
 * Body: { userId: number | "all", title, body } */
router.post("/messages", requireAdmin, (req, res) => {
  const { userId, title, body } = req.body || {};
  const t = String(title || "").trim();
  const b = String(body || "").trim();
  if (!t) return res.status(400).json({ error: "El título es requerido" });
  if (!b) return res.status(400).json({ error: "El mensaje es requerido" });

  if (userId === "all" || userId === undefined || userId === null) {
    db.prepare(
      "INSERT INTO admin_messages (user_id, email, title, body) VALUES (NULL, NULL, ?, ?)"
    ).run(t, b);
    const total = db.prepare("SELECT COUNT(*) AS n FROM users WHERE is_admin != 1").get().n;
    return res.status(201).json({ ok: true, para: "todos", destinatarios: total });
  }

  const id = Number(userId);
  if (!id) return res.status(400).json({ error: "Usuario inválido" });
  const u = db.prepare("SELECT id, email FROM users WHERE id = ?").get(id);
  if (!u) return res.status(404).json({ error: "Usuario no encontrado" });

  db.prepare(
    "INSERT INTO admin_messages (user_id, email, title, body) VALUES (?, ?, ?, ?)"
  ).run(u.id, u.email, t, b);
  res.status(201).json({ ok: true, para: u.email });
});

module.exports = { router, requireAdmin };
