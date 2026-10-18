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
 *   POST /api/admin/users/:id/unmute → reactiva el chat de un usuario muteado
 *   GET  /api/admin/chat-violations   → intentos bloqueados por anti-spam
 *   GET  /api/admin/verified-domains  → lista de dominios verificados
 *   POST /api/admin/verified-domains  → agregar dominio verificado
 *   DELETE /api/admin/verified-domains/:id → quitar dominio verificado
 */
"use strict";

const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { requireAuth } = require("./auth");
const { isEmailConfigured, verificationUrl } = require("../email");

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

  // Países: cuántos países distintos y top 5
  const countriesCount = db
    .prepare("SELECT COUNT(DISTINCT country) AS n FROM users WHERE country IS NOT NULL")
    .get().n;
  const topCountries = db
    .prepare(
      `SELECT country AS pais, country_code AS codigo, COUNT(*) AS usuarios
       FROM users
       WHERE country IS NOT NULL
       GROUP BY country, country_code
       ORDER BY usuarios DESC
       LIMIT 5`
    )
    .all();

  res.json({
    totalUsers,
    subscribedUsers,
    trialUsers,
    onlineNow,
    signupsToday,
    activeSubscriptions,
    mrr: Math.round(mrr * 100) / 100,
    countriesCount,
    topCountries,
    // Referidos: usuarios que llegaron por un link compartido + top invitadores
    referredUsers: db.prepare("SELECT COUNT(*) AS n FROM users WHERE referred_by IS NOT NULL").get().n,
    topReferrers: db.prepare(`
      SELECT u.id, u.name AS nombre, COUNT(r.id) AS referidos
      FROM users u
      JOIN users r ON r.referred_by = u.id
      GROUP BY u.id, u.name
      ORDER BY referidos DESC
      LIMIT 10
    `).all(),
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
  const emailOk = isEmailConfigured();
  const users = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.subscribed, u.is_admin, u.created_at, u.last_seen,
              u.ip, u.country, u.country_code, u.email_verified, u.verification_token,
              u.chat_strikes, u.chat_strikes_date, u.chat_muted, u.chat_mutes, u.credits,
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
      ip: u.ip || null,
      pais: u.country || null,
      codigoPais: u.country_code || null,
      emailVerificado: u.email_verified === 1,
      // Si el correo automático no está configurado, el admin ve el link
      // para enviarlo manualmente (WhatsApp, etc.). Nunca se expone a no-admins.
      verificationLink: (!emailOk && u.email_verified !== 1 && u.verification_token)
        ? verificationUrl(u.verification_token)
        : null,
      chatMuted: Number(u.chat_muted || 0) === 1,
      chatStrikes: Number(u.chat_strikes || 0),
      chatMutes: Number(u.chat_mutes || 0),
      rv: u.is_admin === 1 ? -1 : Math.max(0, Number(u.credits || 0)), // -1 = ilimitado (admin)
    })),
  });
});

/* ============================================================
   DETALLE COMPLETO DE USUARIO (para la vista de actividad)
   ============================================================ */

/* Calcula la racha de días consecutivos completados (igual que el frontend).
 * doneDays: lista ordenada de días completados; currentDay: día actual del programa. */
function calcularRacha(doneDays, currentDay) {
  const arr = doneDays.slice().sort((a, b) => a - b);
  let max = 0;
  for (const x of arr) if (x <= currentDay) max = Math.max(max, x);
  let n = 0;
  while (arr.includes(max - n)) n++;
  return n;
}

/* Día actual del programa según program_start (YYYY-MM-DD). Sin inicio → 1. */
function diaActual(programStart) {
  if (!programStart) return 1;
  const diff = Math.floor((Date.now() - new Date(programStart + "T12:00:00").getTime()) / 86400000) + 1;
  return Math.min(Math.max(diff, 1), 30);
}

/* ---------- GET /api/admin/users/:id ---------- */
router.get("/users/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "ID inválido" });

  const u = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.subscribed, u.is_admin, u.created_at, u.last_seen,
              u.program_start, u.ip, u.country, u.country_code, u.photo,
              u.email_verified, u.verification_token,
              u.chat_strikes, u.chat_strikes_date, u.chat_muted, u.chat_mutes,
              u.credits, u.img_block_remaining,
              u.banned, u.ban_reason,
              s.plan, s.status AS sub_status, s.next_billing_date, s.subscription_id
       FROM users u
       LEFT JOIN paypal_subscriptions s ON s.email = u.email
       WHERE u.id = ?`
    )
    .get(id);
  if (!u) return res.status(404).json({ error: "Usuario no encontrado" });

  const doneRows = db
    .prepare("SELECT day FROM progress WHERE user_id = ? ORDER BY day")
    .all(id)
    .map((r) => r.day);
  const currentDay = diaActual(u.program_start);
  const racha = calcularRacha(doneRows, currentDay);

  const journalRows = db
    .prepare("SELECT date, mood, text FROM journal WHERE user_id = ? ORDER BY date DESC LIMIT 10")
    .all(id);

  const communityCount = db
    .prepare("SELECT COUNT(*) AS n FROM community_comments WHERE user_id = ?")
    .get(id).n;
  const communityRows = db
    .prepare(
      "SELECT id, text, msg_type, created_at, hidden FROM community_comments WHERE user_id = ? ORDER BY created_at DESC LIMIT 10"
    )
    .all(id);

  const topicsRows = db
    .prepare("SELECT id, name, created_at, expires_at FROM chat_topics WHERE user_id = ? ORDER BY created_at DESC LIMIT 20")
    .all(id);

  const today = new Date().toISOString().slice(0, 10);
  const chatToday = db
    .prepare("SELECT seconds_used FROM chat_usage WHERE user_id = ? AND date = ?")
    .get(id, today);
  const chatHistory = db
    .prepare("SELECT date, seconds_used FROM chat_usage WHERE user_id = ? ORDER BY date DESC LIMIT 7")
    .all(id);

  const messagesRows = db
    .prepare(
      `SELECT id, title, body, created_at, read_at FROM admin_messages
       WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`
    )
    .all(id);

  const violationsRows = db
    .prepare(
      `SELECT attempted_text, violation_type, detail, created_at FROM chat_violations
       WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`
    )
    .all(id);

  const emailOk = isEmailConfigured();

  res.json({
    id: u.id,
    email: u.email,
    nombre: u.name,
    foto: u.photo || null,
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
    programa: {
      diasCompletados: doneRows,
      totalCompletados: doneRows.length,
      diaActual: currentDay,
      racha,
    },
    diasCompletados: doneRows.length,
    ultimoDiaCompletado: doneRows.length ? Math.max(...doneRows) : 0,
    diario: {
      total: db.prepare("SELECT COUNT(*) AS n FROM journal WHERE user_id = ?").get(id).n,
      entradas: journalRows.map((j) => ({
        fecha: fmtDay(j.date),
        animo: j.mood || "—",
        texto: (j.text || "").slice(0, 300),
      })),
    },
    entradasDiario: journalRows.length,
    comunidad: {
      total: communityCount,
      mensajes: communityRows.map((c) => ({
        id: c.id,
        texto: c.msg_type === "photo" ? "📷 Foto" : (c.text || "").slice(0, 200),
        fecha: fmtDateTime(c.created_at),
        oculto: c.hidden === 1,
      })),
      temas: topicsRows.map((t) => ({
        id: t.id,
        nombre: t.name,
        creado: fmtDateTime(t.created_at),
        expirado: new Date(String(t.expires_at).replace(" ", "T") + "Z").getTime() < Date.now(),
      })),
    },
    chat: {
      segundosHoy: chatToday ? chatToday.seconds_used : 0,
      historial: chatHistory.map((h) => ({
        fecha: fmtDay(h.date),
        segundos: h.seconds_used,
      })),
    },
    violaciones: violationsRows.map((v) => ({
      intento: v.attempted_text,
      tipo: v.violation_type,
      detalle: v.detail,
      fecha: fmtDateTime(v.created_at),
    })),
    mensajes: messagesRows.map((m) => ({
      id: m.id,
      titulo: m.title,
      cuerpo: m.body,
      enviado: fmtDateTime(m.created_at),
      leido: !!m.read_at,
    })),
    ip: u.ip || null,
    pais: u.country || null,
    codigoPais: u.country_code || null,
    emailVerificado: u.email_verified === 1,
    verificationLink: (!emailOk && u.email_verified !== 1 && u.verification_token)
      ? verificationUrl(u.verification_token)
      : null,
    chatMuted: Number(u.chat_muted || 0) === 1,
    chatStrikes: Number(u.chat_strikes || 0),
    chatMutes: Number(u.chat_mutes || 0),
    chatStrikesFecha: u.chat_strikes_date || null,
    banned: Number(u.banned || 0) === 1,
    banReason: u.ban_reason || null,
    rv: u.is_admin === 1 ? -1 : Math.max(0, Number(u.credits || 0)), // -1 = ilimitado (admin)
    rvBloqueImagenes: Math.max(0, Number(u.img_block_remaining || 0)),
  });
});

/* ---------- GET /api/admin/credit-purchases ----------
 * Lista todas las compras de RV (para el admin). */
router.get("/credit-purchases", requireAdmin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT p.id, p.user_id, u.email, u.name, p.pack_credits AS rv, p.amount_usd AS monto,
              p.paypal_order_id AS orden, p.status AS estado, p.created_at
       FROM credit_purchases p
       JOIN users u ON u.id = p.user_id
       ORDER BY p.created_at DESC LIMIT 200`
    )
    .all();
  res.json({
    compras: rows.map((r) => ({
      id: r.id,
      usuario: r.name,
      email: r.email,
      rv: Number(r.rv),
      monto: r.monto,
      orden: r.orden,
      estado: r.estado,
      fecha: fmtDateTime(r.created_at),
    })),
  });
});

/* ---------- POST /api/admin/users/:id/credits ----------
 * Ajusta manualmente el saldo de RV de un usuario (soporte).
 * Body: { amount } — puede ser positivo (agregar) o negativo (quitar). */
router.post("/users/:id/credits", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "ID inválido" });
  const amount = Number(req.body?.amount);
  if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 100000)
    return res.status(400).json({ error: "Monto inválido" });
  const u = db.prepare("SELECT id, credits FROM users WHERE id = ?").get(id);
  if (!u) return res.status(404).json({ error: "Usuario no encontrado" });
  const nuevo = Math.max(0, (Number(u.credits) || 0) + Math.trunc(amount));
  db.prepare("UPDATE users SET credits = ? WHERE id = ?").run(nuevo, id);
  res.json({ ok: true, rv: nuevo });
});

/* ---------- POST /api/admin/users/:id/verify ----------
 * Marca manualmente a un usuario como verificado (casos de soporte:
 * el correo no llegó, el usuario no puede abrir el link, etc.). */
router.post("/users/:id/verify", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "ID inválido" });
  const u = db.prepare("SELECT id, email FROM users WHERE id = ?").get(id);
  if (!u) return res.status(404).json({ error: "Usuario no encontrado" });
  db.prepare("UPDATE users SET email_verified = 1, verification_token = NULL WHERE id = ?").run(id);
  res.json({ ok: true, verificado: true, email: u.email });
});

/* ---------- POST /api/admin/users/:id/message ----------
 * Envía un mensaje PRIVADO a un usuario (aparece en su app vía GET /api/messages).
 * Body: { text, title? } — title por defecto: "Mensaje privado 💛" */
router.post("/users/:id/message", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "ID inválido" });
  const u = db.prepare("SELECT id, email, name FROM users WHERE id = ?").get(id);
  if (!u) return res.status(404).json({ error: "Usuario no encontrado" });

  const text = String(req.body?.text || "").trim();
  if (!text) return res.status(400).json({ error: "Escribe el mensaje primero" });
  if (text.length > 2000)
    return res.status(400).json({ error: "El mensaje es muy largo (máximo 2000 caracteres)" });
  const title = String(req.body?.title || "").trim() || "Mensaje privado 💛";

  const r = db
    .prepare("INSERT INTO admin_messages (user_id, email, title, body) VALUES (?, ?, ?, ?)")
    .run(u.id, u.email, title, text);
  res.status(201).json({ ok: true, id: Number(r.lastInsertRowid), para: u.email });
});

/* ---------- POST /api/admin/users/:id/unmute ----------
 * Reactiva la capacidad de escribir en el chat de un usuario muteado
 * por el sistema anti-spam. Reinicia sus strikes. */
router.post("/users/:id/unmute", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "ID inválido" });
  const u = db.prepare("SELECT id, email, chat_muted FROM users WHERE id = ?").get(id);
  if (!u) return res.status(404).json({ error: "Usuario no encontrado" });
  db.prepare(
    "UPDATE users SET chat_muted = 0, chat_strikes = 0, chat_strikes_date = NULL WHERE id = ?"
  ).run(id);
  res.json({ ok: true, reactivado: true, email: u.email });
});

/* ---------- GET /api/admin/chat-violations ----------
 * Lista de intentos bloqueados por el filtro anti-spam (los más recientes).
 * Muestra quién intentó qué y cuándo, para revisión del administrador. */
router.get("/chat-violations", requireAdmin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT v.id, v.user_id, v.attempted_text, v.violation_type, v.detail, v.created_at,
              u.name, u.email
       FROM chat_violations v
       LEFT JOIN users u ON u.id = v.user_id
       ORDER BY v.created_at DESC
       LIMIT 100`
    )
    .all();
  res.json({
    infracciones: rows.map((v) => ({
      id: v.id,
      userId: v.user_id,
      usuario: v.name || v.email || ("#" + v.user_id),
      email: v.email || null,
      intento: v.attempted_text,
      tipo: v.violation_type,
      detalle: v.detail,
      fecha: v.created_at,
    })),
  });
});

/* ---------- GET /api/admin/messages ---------- */

/* ---------- Dominios verificados 🔒 ----------
 * Solo se permiten links de páginas verificadas en mensajes
 * promocionales (anti-phishing/hackers). */
router.get("/verified-domains", requireAdmin, (req, res) => {
  const rows = db
    .prepare("SELECT id, domain, approved_by, approved_at FROM verified_domains ORDER BY domain ASC")
    .all();
  res.json({
    dominios: rows.map((d) => ({
      id: d.id,
      dominio: d.domain,
      aprobadoPor: d.approved_by || null,
      fecha: d.approved_at,
    })),
  });
});

router.post("/verified-domains", requireAdmin, (req, res) => {
  const { normalizarDominio, invalidarCache } = require("../linkverify");
  const dominio = normalizarDominio(req.body && req.body.domain);
  if (!dominio || !/^[a-z0-9][a-z0-9\-.]*\.[a-z]{2,}$/.test(dominio)) {
    return res.status(400).json({ error: "Dominio inválido. Ejemplo: mitienda.com" });
  }
  try {
    db.prepare(
      "INSERT INTO verified_domains (domain, approved_by) VALUES (?, ?)"
    ).run(dominio, (req.user && (req.user.name || req.user.email)) || "admin");
  } catch (e) {
    if (String(e.message || "").includes("UNIQUE")) {
      return res.status(409).json({ error: "Ese dominio ya está verificado." });
    }
    throw e;
  }
  invalidarCache();
  res.status(201).json({ ok: true, dominio });
});

router.delete("/verified-domains/:id", requireAdmin, (req, res) => {
  const { invalidarCache } = require("../linkverify");
  const r = db.prepare("DELETE FROM verified_domains WHERE id = ?").run(req.params.id);
  invalidarCache();
  if (r.changes === 0) return res.status(404).json({ error: "No encontrado." });
  res.json({ ok: true });
});
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

/* ============================================================
   COMUNIDAD — moderación (solo admin)
   ============================================================ */

/* GET /api/admin/community → todos los comentarios CON la identidad real
 * del autor (solo el admin puede ver quién escribió qué). */
router.get("/community", requireAdmin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT c.id, c.user_id, c.text, c.created_at, c.hidden,
              u.name AS nombre, u.email
       FROM community_comments c
       LEFT JOIN users u ON u.id = c.user_id
       ORDER BY c.created_at DESC
       LIMIT 200`
    )
    .all();
  res.json({
    comentarios: rows.map((c) => ({
      id: c.id,
      texto: c.text,
      fecha: c.created_at,
      oculto: c.hidden === 1,
      usuarioId: c.user_id,
      nombre: c.nombre || "(eliminado)",
      email: c.email || "—",
    })),
  });
});

/* POST /api/admin/community/:id/hide → ocultar comentario inapropiado. */
router.post("/community/:id/hide", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Comentario inválido" });
  const r = db.prepare("UPDATE community_comments SET hidden = 1 WHERE id = ?").run(id);
  if (!r.changes) return res.status(404).json({ error: "Comentario no encontrado" });
  res.json({ ok: true, oculto: true });
});

/* POST /api/admin/community/:id/unhide → volver a mostrar. */
router.post("/community/:id/unhide", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Comentario inválido" });
  const r = db.prepare("UPDATE community_comments SET hidden = 0 WHERE id = ?").run(id);
  if (!r.changes) return res.status(404).json({ error: "Comentario no encontrado" });
  res.json({ ok: true, oculto: false });
});

/* ============ SEGURIDAD: IPs bloqueadas y usuarios baneados ============ */
const { blockIp, unblockIp, banUser, unbanUser, getClientIp } = require("../security");

/* GET /api/admin/blocked-ips → lista de IPs bloqueadas. */
router.get("/blocked-ips", requireAdmin, (req, res) => {
  const rows = db.prepare(
    "SELECT ip, reason, blocked_at, blocked_by FROM blocked_ips ORDER BY blocked_at DESC LIMIT 200"
  ).all();
  res.json({ ips: rows });
});

/* POST /api/admin/blocked-ips { ip, reason } → bloquear IP manualmente. */
router.post("/blocked-ips", requireAdmin, (req, res) => {
  const ip = String(req.body?.ip || "").trim();
  const reason = String(req.body?.reason || "Bloqueo manual").slice(0, 200);
  if (!ip) return res.status(400).json({ error: "IP requerida" });
  // No permitir bloquear la propia IP del admin por accidente.
  if (ip === getClientIp(req))
    return res.status(400).json({ error: "No puedes bloquear tu propia IP" });
  blockIp(ip, reason, "admin");
  res.json({ ok: true, ip });
});

/* DELETE /api/admin/blocked-ips/:ip → desbloquear IP. */
router.delete("/blocked-ips/:ip", requireAdmin, (req, res) => {
  const ip = String(req.params.ip || "").trim();
  if (!ip) return res.status(400).json({ error: "IP requerida" });
  unblockIp(ip);
  res.json({ ok: true, ip });
});

/* GET /api/admin/banned-users → lista de usuarios baneados. */
router.get("/banned-users", requireAdmin, (req, res) => {
  const rows = db.prepare(
    "SELECT id, name, email, country, ban_reason FROM users WHERE banned = 1 ORDER BY id DESC LIMIT 200"
  ).all();
  res.json({ usuarios: rows });
});

/* POST /api/admin/users/:id/ban { reason } → banear permanentemente. */
router.post("/users/:id/ban", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Usuario inválido" });
  const target = db.prepare("SELECT id, is_admin FROM users WHERE id = ?").get(id);
  if (!target) return res.status(404).json({ error: "Usuario no encontrado" });
  if (target.is_admin === 1)
    return res.status(400).json({ error: "No se puede banear a un administrador" });
  const reason = String(req.body?.reason || "Violación de términos").slice(0, 200);
  banUser(id, reason);
  res.json({ ok: true, baneado: true });
});

/* POST /api/admin/users/:id/unban → quitar el baneo. */
router.post("/users/:id/unban", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Usuario inválido" });
  unbanUser(id);
  res.json({ ok: true, baneado: false });
});

/* ============================================================
   CAMBIO DE CONTRASEÑA DEL ADMIN 🔑 (+ correo de respaldo)
   ============================================================
 * POST /api/admin/change-password
 *   { current_password, new_password, backup_email? }
 *
 * Seguridad: current_password debe ser la contraseña actual (si el admin
 * ya fijó una) o el ADMIN_CODE (credencial actual del acceso admin).
 * new_password: mínimo 6 caracteres. Se guarda con bcrypt.
 * backup_email: opcional; si se envía, se valida el formato y se guarda
 *   en users.backup_email (para futura recuperación de cuenta).
 */
function emailValido(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || "").trim());
}

router.post("/change-password", requireAdmin, (req, res) => {
  const current = String(req.body?.current_password || "");
  const nuevo = String(req.body?.new_password || "");
  const backupEmail = String(req.body?.backup_email || "").trim().toLowerCase();

  if (nuevo.length < 6)
    return res.status(400).json({ error: "La nueva contraseña debe tener al menos 6 caracteres" });

  const admin = db.prepare("SELECT id, password_hash FROM users WHERE id = ?").get(req.user.id);
  if (!admin) return res.status(404).json({ error: "Administrador no encontrado" });

  // Verificación: contraseña actual (si existe) o el código de admin.
  const adminCode = process.env.ADMIN_CODE || "";
  let ok = false;
  try {
    if (admin.password_hash && bcrypt.compareSync(current, admin.password_hash)) ok = true;
  } catch (e) { /* sigue */ }
  if (!ok && adminCode && current === adminCode) ok = true;
  if (!ok)
    return res.status(401).json({ error: "La contraseña actual (o código de admin) es incorrecta" });

  // Validar correo de respaldo si se proporcionó.
  if (backupEmail && !emailValido(backupEmail))
    return res.status(400).json({ error: "El correo de respaldo no tiene un formato válido" });

  const hash = bcrypt.hashSync(nuevo, 10);
  if (backupEmail) {
    db.prepare("UPDATE users SET password_hash = ?, backup_email = ? WHERE id = ?")
      .run(hash, backupEmail, admin.id);
  } else {
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, admin.id);
  }
  res.json({
    ok: true,
    message: "Contraseña actualizada ✅" + (backupEmail ? " Correo de respaldo guardado 📧" : ""),
    backup_email: backupEmail || undefined,
  });
});

/* GET /api/admin/backup-email → correo de respaldo actual del admin. */
router.get("/backup-email", requireAdmin, (req, res) => {
  const row = db.prepare("SELECT backup_email FROM users WHERE id = ?").get(req.user.id);
  res.json({ backup_email: row?.backup_email || null });
});

module.exports = { router, requireAdmin };
