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
const { ah } = db;
const { requireAuth } = require("./auth");
const { isEmailConfigured, verificationUrl, sendPlanChangedEmail } = require("../email");
const { flagLevel } = require("./flags");

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
router.get("/stats", requireAdmin, ah(async (req, res) => {
  const totalUsers = (await db.get("SELECT COUNT(*) AS n FROM users")).n;
  const subscribedUsers = (await db.get("SELECT COUNT(*) AS n FROM users WHERE subscribed = 1")).n;
  const trialUsers = (await db.get("SELECT COUNT(*) AS n FROM users WHERE subscribed = 0")).n;
  const onlineNow = (await db.get("SELECT COUNT(*) AS n FROM users WHERE last_seen >= datetime('now', '-5 minutes')")).n;
  const signupsToday = (await db.get("SELECT COUNT(*) AS n FROM users WHERE date(created_at) = date('now')")).n;
  const activeSubscriptions = (await db.get("SELECT COUNT(*) AS n FROM paypal_subscriptions WHERE status = 'ACTIVE'")).n;
  // Estimación de ingresos mensuales recurrentes (MRR): 4.99 mensual, 39.99/12 anual
  const plans = await db.all("SELECT plan, COUNT(*) AS n FROM paypal_subscriptions WHERE status = 'ACTIVE' GROUP BY plan");
  let mrr = 0;
  for (const p of plans) {
    if (p.plan === "monthly") mrr += p.n * 4.99;
    else if (p.plan === "yearly") mrr += p.n * (39.99 / 12);
  }

  // Países: cuántos países distintos y top 5
  const countriesCount = (await db.get("SELECT COUNT(DISTINCT country) AS n FROM users WHERE country IS NOT NULL")).n;
  const topCountries = await db.all(
      `SELECT country AS pais, country_code AS codigo, COUNT(*) AS usuarios
       FROM users
       WHERE country IS NOT NULL
       GROUP BY country, country_code
       ORDER BY usuarios DESC
       LIMIT 5`
    );

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
    // Chats deshabilitados (muteados por anti-spam o por bandera roja)
    mutedChats: (await db.get("SELECT COUNT(*) AS n FROM users WHERE chat_muted = 1 OR chat_disabled = 1")).n,
    // Usuarios con banderas de advertencia
    flaggedUsers: (await db.get("SELECT COUNT(DISTINCT target_user_id) AS n FROM user_flags")).n,
    // Banderas rojas pendientes de decisión
    redFlags: (await db.get(`SELECT COUNT(*) AS n FROM (
        SELECT target_user_id FROM user_flags GROUP BY target_user_id HAVING COUNT(*) >= 4
      )`)).n,
    // Planes cancelados
    cancelledPlans: (await db.get("SELECT COUNT(*) AS n FROM paypal_subscriptions WHERE status = 'CANCELLED'")).n,
    // Referidos: usuarios que llegaron por un link compartido + top invitadores
    referredUsers: (await db.get("SELECT COUNT(*) AS n FROM users WHERE referred_by IS NOT NULL")).n,
    // RV en circulación: suma de saldos de los usuarios (sin el admin)
    rvCirculacion: (await db.get("SELECT COALESCE(SUM(credits), 0) AS n FROM users WHERE is_admin = 0")).n,
    // Ingresos por venta de RV (compras reales, sin los bonos BONO-*)
    ingresosRV: Math.round(((await db.get("SELECT COALESCE(SUM(CAST(amount_usd AS REAL)), 0) AS n FROM credit_purchases WHERE status = 'completed' AND paypal_order_id NOT LIKE 'BONO-%'")).n) * 100) / 100,
    rvVendidos: (await db.get("SELECT COALESCE(SUM(pack_credits), 0) AS n FROM credit_purchases WHERE status = 'completed' AND paypal_order_id NOT LIKE 'BONO-%'")).n,
    topReferrers: await db.all(`
      SELECT u.id, u.name AS nombre, COUNT(r.id) AS referidos
      FROM users u
      JOIN users r ON r.referred_by = u.id
      GROUP BY u.id, u.name
      ORDER BY referidos DESC
      LIMIT 10
    `),
  });
}));

/* ---------- GET /api/admin/growth ----------
 * ?days=N — período: 8, 15, 30, 60, 90, 180, 365 (por defecto 30).
 * Si days <= 90 agrupa por día; si days > 90 agrupa por semana
 * (strftime('%Y-%W')) para que la tabla/gráfico no sea eterna.
 * Rellena los períodos sin actividad con ceros para que el gráfico sea continuo. */
router.get("/growth", requireAdmin, ah(async (req, res) => {
  const ALLOWED = [8, 15, 30, 60, 90, 180, 365];
  let days = parseInt(req.query.days, 10);
  if (!ALLOWED.includes(days)) days = 30;
  const byWeek = days > 90;

  let rows;
  if (byWeek) {
    rows = await db.all(
        `SELECT strftime('%Y-%W', created_at) AS periodo, COUNT(*) AS signups, SUM(subscribed) AS new_subs
         FROM users
         WHERE created_at >= date('now', '-' || ? || ' days')
         GROUP BY periodo
         ORDER BY periodo`
      , days);
  } else {
    rows = await db.all(
        `SELECT date(created_at) AS periodo, COUNT(*) AS signups, SUM(subscribed) AS new_subs
         FROM users
         WHERE created_at >= date('now', '-' || ? || ' days')
         GROUP BY periodo
         ORDER BY periodo`
      , days);
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
}));

/* ---------- GET /api/admin/growth-geo?days=N ----------
 * Crecimiento por PAÍS y por CIUDAD (registros del período).
 * La ciudad sale de la IP del último ingreso (se guarda en users.city
 * desde el login; los usuarios antiguos la obtienen al volver a entrar). */
router.get("/growth-geo", requireAdmin, ah(async (req, res) => {
  const ALLOWED = [8, 15, 30, 60, 90, 180, 365];
  let days = parseInt(req.query.days, 10);
  if (!ALLOWED.includes(days)) days = 30;
  const paises = await db.all(
      `SELECT country AS pais, country_code AS codigo, COUNT(*) AS signups, SUM(subscribed) AS new_subs
       FROM users
       WHERE created_at >= date('now', '-' || ? || ' days') AND country IS NOT NULL AND country != ''
       GROUP BY country, country_code
       ORDER BY signups DESC`
    , days);
  const ciudades = await db.all(
      `SELECT city AS ciudad, country AS pais, COUNT(*) AS signups, SUM(subscribed) AS new_subs
       FROM users
       WHERE created_at >= date('now', '-' || ? || ' days') AND city IS NOT NULL AND city != ''
       GROUP BY city, country
       ORDER BY signups DESC
       LIMIT 50`
    , days);
  res.json({
    days,
    paises: paises.map((r) => ({ pais: r.pais, codigo: r.codigo || "", nuevosUsuarios: r.signups, nuevosConPlan: r.new_subs || 0 })),
    ciudades: ciudades.map((r) => ({ ciudad: r.ciudad, pais: r.pais || "", nuevosUsuarios: r.signups, nuevosConPlan: r.new_subs || 0 })),
  });
}));

/* ---------- GET /api/admin/users ---------- */
router.get("/users", requireAdmin, ah(async (req, res) => {
  const emailOk = isEmailConfigured();
  const users = await db.all(
      `SELECT u.id, u.email, u.name, u.subscribed, u.is_admin, u.created_at, u.last_seen,
              u.ip, u.country, u.country_code, u.email_verified, u.verification_token,
              u.chat_strikes, u.chat_strikes_date, u.chat_muted, u.chat_mutes, u.credits,
              u.gender, u.birthdate, u.plan_type,
              s.plan, s.status AS sub_status, s.next_billing_date
       FROM users u
       LEFT JOIN paypal_subscriptions s ON s.email = u.email
       ORDER BY u.created_at DESC
       LIMIT 500`
    );

  res.json({
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      nombre: u.name,
      conPlan: u.subscribed === 1,
      plan: planLabel(u.sub_status ? { status: u.sub_status } : null),
      planDetalle: u.plan || u.plan_type || null,
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
      gender: u.gender || null,
    })),
  });
}));

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
router.get("/users/:id", requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "ID inválido" });

  const u = await db.get(
      `SELECT u.id, u.email, u.name, u.subscribed, u.is_admin, u.created_at, u.last_seen,
              u.program_start, u.ip, u.country, u.country_code, u.photo,
              u.email_verified, u.verification_token,
              u.chat_strikes, u.chat_strikes_date, u.chat_muted, u.chat_mutes,
              u.chat_disabled, u.gender, u.birthdate,
              u.credits, u.img_block_remaining,
              u.banned, u.ban_reason, u.plan_type,
              s.plan, s.status AS sub_status, s.next_billing_date, s.subscription_id
       FROM users u
       LEFT JOIN paypal_subscriptions s ON s.email = u.email
       WHERE u.id = ?`
    , id);
  if (!u) return res.status(404).json({ error: "Usuario no encontrado" });

  const doneRows = (await db.all("SELECT day FROM progress WHERE user_id = ? ORDER BY day", id))
    .map((r) => r.day);
  const currentDay = diaActual(u.program_start);
  const racha = calcularRacha(doneRows, currentDay);

  const journalRows = await db.all("SELECT date, mood, text FROM journal WHERE user_id = ? ORDER BY date DESC LIMIT 10", id);

  const communityCount = (await db.get("SELECT COUNT(*) AS n FROM community_comments WHERE user_id = ?", id)).n;
  const communityRows = await db.all(
      "SELECT id, text, msg_type, created_at, hidden FROM community_comments WHERE user_id = ? ORDER BY created_at DESC LIMIT 10"
    , id);

  const topicsRows = await db.all("SELECT id, name, created_at, expires_at FROM chat_topics WHERE user_id = ? ORDER BY created_at DESC LIMIT 20", id);

  const today = new Date().toISOString().slice(0, 10);
  const chatToday = await db.get("SELECT seconds_used FROM chat_usage WHERE user_id = ? AND date = ?", id, today);
  const chatHistory = await db.all("SELECT date, seconds_used FROM chat_usage WHERE user_id = ? ORDER BY date DESC LIMIT 7", id);

  const messagesRows = await db.all(
      `SELECT id, title, body, created_at, read_at FROM admin_messages
       WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`
    , id);

  const violationsRows = await db.all(
      `SELECT attempted_text, violation_type, detail, created_at FROM chat_violations
       WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`
    , id);

  const emailOk = isEmailConfigured();

  // Banderas de advertencia: nivel actual + quiénes las pusieron.
  const nivelBandera = await flagLevel(id);
  const banderasDe = (await db.all(
      `SELECT f.created_at, r.name AS reportero, r.email AS reportero_email
       FROM user_flags f
       LEFT JOIN users r ON r.id = f.reporter_user_id
       WHERE f.target_user_id = ?
       ORDER BY f.created_at DESC`
    , id))
    .map((f) => ({
      reportero: f.reportero || f.reportero_email || "—",
      fecha: fmtDateTime(f.created_at),
    }));

  res.json({
    id: u.id,
    email: u.email,
    nombre: u.name,
    foto: u.photo || null,
    gender: u.gender || null,
    conPlan: u.subscribed === 1,
    plan: planLabel(u.sub_status ? { status: u.sub_status } : null),
    planDetalle: u.plan || u.plan_type || null,
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
      total: (await db.get("SELECT COUNT(*) AS n FROM journal WHERE user_id = ?", id)).n,
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
    chatDisabled: Number(u.chat_disabled || 0) === 1,
    nivelBandera,
    banderasDe,
    banned: Number(u.banned || 0) === 1,
    banReason: u.ban_reason || null,
    rv: u.is_admin === 1 ? -1 : Math.max(0, Number(u.credits || 0)), // -1 = ilimitado (admin)
    rvBloqueImagenes: Math.max(0, Number(u.img_block_remaining || 0)),
  });
}));

/* ---------- GET /api/admin/credit-purchases ----------
 * Lista todas las compras de RV (para el admin). */
router.get("/credit-purchases", requireAdmin, ah(async (req, res) => {
  const rows = await db.all(
      `SELECT p.id, p.user_id, u.email, u.name, p.pack_credits AS rv, p.amount_usd AS monto,
              p.paypal_order_id AS orden, p.status AS estado, p.created_at
       FROM credit_purchases p
       JOIN users u ON u.id = p.user_id
       ORDER BY p.created_at DESC LIMIT 200`
    );
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
}));

/* ---------- POST /api/admin/users/:id/credits ----------
 * Ajusta manualmente el saldo de RV de un usuario (soporte).
 * Body: { amount } — puede ser positivo (agregar) o negativo (quitar). */
router.post("/users/:id/credits", requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "ID inválido" });
  const amount = Number(req.body?.amount);
  if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 100000)
    return res.status(400).json({ error: "Monto inválido" });
  const u = await db.get("SELECT id, credits FROM users WHERE id = ?", id);
  if (!u) return res.status(404).json({ error: "Usuario no encontrado" });
  const nuevo = Math.max(0, (Number(u.credits) || 0) + Math.trunc(amount));
  await db.run("UPDATE users SET credits = ? WHERE id = ?", nuevo, id);
  res.json({ ok: true, rv: nuevo });
}));

/* ---------- POST /api/admin/users/:id/verify ----------
 * Marca manualmente a un usuario como verificado (casos de soporte:
 * el correo no llegó, el usuario no puede abrir el link, etc.). */
router.post("/users/:id/verify", requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "ID inválido" });
  const u = await db.get("SELECT id, email FROM users WHERE id = ?", id);
  if (!u) return res.status(404).json({ error: "Usuario no encontrado" });
  await db.run("UPDATE users SET email_verified = 1, verification_token = NULL WHERE id = ?", id);
  res.json({ ok: true, verificado: true, email: u.email });
}));

/* ---------- POST /api/admin/users/:id/message ----------
 * Envía un mensaje PRIVADO a un usuario (aparece en su app vía GET /api/messages).
 * Body: { text, title? } — title por defecto: "Mensaje privado 💛" */
router.post("/users/:id/message", requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "ID inválido" });
  const u = await db.get("SELECT id, email, name FROM users WHERE id = ?", id);
  if (!u) return res.status(404).json({ error: "Usuario no encontrado" });

  const text = String(req.body?.text || "").trim();
  if (!text) return res.status(400).json({ error: "Escribe el mensaje primero" });
  if (text.length > 2000)
    return res.status(400).json({ error: "El mensaje es muy largo (máximo 2000 caracteres)" });
  const title = String(req.body?.title || "").trim() || "Mensaje privado 💛";

  const r = await db.run("INSERT INTO admin_messages (user_id, email, title, body) VALUES (?, ?, ?, ?)", u.id, u.email, title, text);
  res.status(201).json({ ok: true, id: Number(r.lastInsertRowid), para: u.email });
}));

/* ---------- POST /api/admin/users/:id/unmute ----------
 * Reactiva la capacidad de escribir en el chat de un usuario muteado
 * por el sistema anti-spam. Reinicia sus strikes. */
router.post("/users/:id/unmute", requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "ID inválido" });
  const u = await db.get("SELECT id, email, chat_muted FROM users WHERE id = ?", id);
  if (!u) return res.status(404).json({ error: "Usuario no encontrado" });
  await db.run(
    "UPDATE users SET chat_muted = 0, chat_strikes = 0, chat_strikes_date = NULL WHERE id = ?"
  , id);
  res.json({ ok: true, reactivado: true, email: u.email });
}));

/* ---------- GET /api/admin/chat-violations ----------
 * Lista de intentos bloqueados por el filtro anti-spam (los más recientes).
 * Muestra quién intentó qué y cuándo, para revisión del administrador. */
router.get("/chat-violations", requireAdmin, ah(async (req, res) => {
  const rows = await db.all(
      `SELECT v.id, v.user_id, v.attempted_text, v.violation_type, v.detail, v.created_at,
              u.name, u.email
       FROM chat_violations v
       LEFT JOIN users u ON u.id = v.user_id
       ORDER BY v.created_at DESC
       LIMIT 100`
    );
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
}));

/* ---------- GET /api/admin/messages ---------- */

/* ---------- Dominios verificados 🔒 ----------
 * Solo se permiten links de páginas verificadas en mensajes
 * promocionales (anti-phishing/hackers). */
router.get("/verified-domains", requireAdmin, ah(async (req, res) => {
  const rows = await db.all("SELECT id, domain, approved_by, approved_at FROM verified_domains ORDER BY domain ASC");
  res.json({
    dominios: rows.map((d) => ({
      id: d.id,
      dominio: d.domain,
      aprobadoPor: d.approved_by || null,
      fecha: d.approved_at,
    })),
  });
}));

router.post("/verified-domains", requireAdmin, ah(async (req, res) => {
  const { normalizarDominio, invalidarCache } = require("../linkverify");
  const dominio = normalizarDominio(req.body && req.body.domain);
  if (!dominio || !/^[a-z0-9][a-z0-9\-.]*\.[a-z]{2,}$/.test(dominio)) {
    return res.status(400).json({ error: "Dominio inválido. Ejemplo: mitienda.com" });
  }
  try {
    await db.run(
      "INSERT INTO verified_domains (domain, approved_by) VALUES (?, ?)"
    , dominio, (req.user && (req.user.name || req.user.email)) || "admin");
  } catch (e) {
    if (String(e.message || "").includes("UNIQUE")) {
      return res.status(409).json({ error: "Ese dominio ya está verificado." });
    }
    throw e;
  }
  invalidarCache();
  res.status(201).json({ ok: true, dominio });
}));

router.delete("/verified-domains/:id", requireAdmin, ah(async (req, res) => {
  const { invalidarCache } = require("../linkverify");
  const r = await db.run("DELETE FROM verified_domains WHERE id = ?", req.params.id);
  invalidarCache();
  if (r.changes === 0) return res.status(404).json({ error: "No encontrado." });
  res.json({ ok: true });
}));
/* ---------- Planes manuales y apodo del admin en el chat ----------
 * El admin puede: dar plan mensual/anual a cualquier cuenta, quitarlo,
 * y participar en el chat grupal con el apodo que quiera (chat_alias). */
router.post("/users/:id/plan", requireAdmin, ah(async (req, res) => {
  const plan = String((req.body || {}).plan || "");
  const id = req.params.id;
  const u = await db.get("SELECT id, is_admin, email, name FROM users WHERE id = ?", id);
  if (!u) return res.status(404).json({ error: "Usuario no encontrado" });
  let bonus = 0;
  if (plan === "monthly" || plan === "annual") {
    await db.run("UPDATE users SET subscribed = 1, plan_type = ? WHERE id = ?", plan, id);
    // TODOS los beneficios: acceso vía plan_type + bono RV del plan
    // (+50 mensual / +200 anual, igual que pagando) + correo al usuario.
    bonus = plan === "annual" ? 200 : 50;
    await db.run("UPDATE users SET credits = COALESCE(credits, 0) + ? WHERE id = ?", bonus, id);
    try {
      await db.run("INSERT INTO credit_spending (user_id, credits_used, reason) VALUES (?, ?, ?)",
        id, -bonus, plan === "annual" ? "Bono plan Anual (asignado por el administrador)" : "Bono plan Mensual (asignado por el administrador)");
    } catch (e) { /* el abono ya se hizo; el registro es secundario */ }
  } else if (plan === "none" || plan === "" || plan === "free") {
    await db.run("UPDATE users SET subscribed = 0, plan_type = NULL WHERE id = ?", id);
  } else {
    return res.status(400).json({ error: "Plan inválido. Usa monthly, annual o none." });
  }
  // Correo al usuario avisando del cambio (no bloquea la respuesta).
  try { sendPlanChangedEmail({ to: u.email, name: u.name, plan: plan === "monthly" || plan === "annual" ? plan : "none", bonus }); } catch (e) { /* correo secundario */ }
  res.json({ ok: true, plan, bonus });
}));

/* ---------- Álbumes de un usuario (el admin puede ver y eliminar) ---------- */
router.get("/users/:id/albums", requireAdmin, ah(async (req, res) => {
  const albums = await db.all("SELECT id, title, created_at FROM albums WHERE user_id = ? ORDER BY created_at DESC", req.params.id);
  const out = [];
  for (const a of albums) {
    const fotos = await db.all("SELECT id, photo, caption FROM album_photos WHERE album_id = ? ORDER BY created_at ASC", a.id);
    out.push({
      id: a.id,
      titulo: a.title,
      creado: a.created_at,
      fotos: fotos.map((f) => ({ id: f.id, foto: f.photo, caption: f.caption || "" })),
    });
  }
  res.json({ albumes: out });
}));

router.delete("/albums/:albumId", requireAdmin, ah(async (req, res) => {
  await db.run("DELETE FROM album_photos WHERE album_id = ?", req.params.albumId);
  await db.run("DELETE FROM albums WHERE id = ?", req.params.albumId);
  res.json({ ok: true });
}));

router.delete("/albums/photos/:photoId", requireAdmin, ah(async (req, res) => {
  await db.run("DELETE FROM album_photos WHERE id = ?", req.params.photoId);
  res.json({ ok: true });
}));

router.post("/chat-alias", requireAdmin, ah(async (req, res) => {
  const alias = String((req.body || {}).alias || "").trim().slice(0, 30);
  await db.run("UPDATE users SET chat_alias = ? WHERE id = ?", alias || null, req.user.id);
  res.json({ ok: true, alias });
}));

router.get("/chat-alias", requireAdmin, ah(async (req, res) => {
  const u = await db.get("SELECT chat_alias FROM users WHERE id = ?", req.user.id);
  res.json({ alias: (u && u.chat_alias) || "" });
}));

/* ---------- Link Pub: links publicados en el perfil de los usuarios ----------
 * El admin promociona un link (su canal, blog…) segmentando por usuarios
 * específicos, países (solo los de usuarios registrados) y sexo (M/F). */
router.get("/links", requireAdmin, ah(async (req, res) => {
  const links = await db.all("SELECT * FROM admin_links ORDER BY id DESC");
  const cRows = await db.all(
    "SELECT DISTINCT country FROM users WHERE country IS NOT NULL AND country != '' ORDER BY country");
  res.json({
    links: links.map((l) => ({
      id: l.id, url: l.url, title: l.title || "",
      target_users: l.target_users ? JSON.parse(l.target_users) : [],
      target_countries: l.target_countries ? JSON.parse(l.target_countries) : [],
      target_gender: l.target_gender || "",
      created_at: l.created_at,
    })),
    countries: cRows.map((r) => r.country),
  });
}));

router.post("/links", requireAdmin, ah(async (req, res) => {
  const b = req.body || {};
  const url = String(b.url || "").trim();
  if (!/^https?:\/\//i.test(url))
    return res.status(400).json({ error: "El link debe empezar con http:// o https://" });
  const title = String(b.title || "").trim().slice(0, 120);
  const userIds = Array.isArray(b.userIds) ? b.userIds.map(Number).filter((n) => n > 0) : [];
  const countries = Array.isArray(b.countries) ? b.countries.map((c) => String(c)).filter(Boolean) : [];
  const gender = ["M", "F"].includes(String(b.gender || "").toUpperCase())
    ? String(b.gender).toUpperCase() : "";
  const r = await db.run(
    "INSERT INTO admin_links (url, title, target_users, target_countries, target_gender) VALUES (?, ?, ?, ?, ?)",
    url, title || null,
    userIds.length ? JSON.stringify(userIds) : null,
    countries.length ? JSON.stringify(countries) : null,
    gender || null);
  res.json({ ok: true, id: r.lastID });
}));

router.delete("/links/:id", requireAdmin, ah(async (req, res) => {
  const r = await db.run("DELETE FROM admin_links WHERE id = ?", req.params.id);
  if (r.changes === 0) return res.status(404).json({ error: "No encontrado." });
  res.json({ ok: true });
}));

/* ---------- Contacto: sugerencias y problemas de los usuarios ---------- */
router.get("/contact-messages", requireAdmin, ah(async (req, res) => {
  const rows = await db.all(
    "SELECT id, name, email, message, type, created_at FROM contact_messages ORDER BY id DESC LIMIT 100");
  res.json({ messages: rows });
}));

router.delete("/contact-messages/:id", requireAdmin, ah(async (req, res) => {
  const r = await db.run("DELETE FROM contact_messages WHERE id = ?", req.params.id);
  if (r.changes === 0) return res.status(404).json({ error: "No encontrado." });
  res.json({ ok: true });
}));

router.get("/messages", requireAdmin, ah(async (req, res) => {
  const rows = await db.all(
      `SELECT id, user_id, email, title, body, created_at, read_at
       FROM admin_messages
       ORDER BY created_at DESC
       LIMIT 100`
    );
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
}));

/* ---------- POST /api/admin/messages ----------
 * Body: { userId: number | "all", title, body } */
router.post("/messages", requireAdmin, ah(async (req, res) => {
  const { userId, title, body } = req.body || {};
  const t = String(title || "").trim();
  const b = String(body || "").trim();
  if (!t) return res.status(400).json({ error: "El título es requerido" });
  if (!b) return res.status(400).json({ error: "El mensaje es requerido" });

  if (userId === "all" || userId === undefined || userId === null) {
    await db.run(
      "INSERT INTO admin_messages (user_id, email, title, body) VALUES (NULL, NULL, ?, ?)"
    , t, b);
    const total = (await db.get("SELECT COUNT(*) AS n FROM users WHERE is_admin != 1")).n;
    return res.status(201).json({ ok: true, para: "todos", destinatarios: total });
  }

  const id = Number(userId);
  if (!id) return res.status(400).json({ error: "Usuario inválido" });
  const u = await db.get("SELECT id, email FROM users WHERE id = ?", id);
  if (!u) return res.status(404).json({ error: "Usuario no encontrado" });

  await db.run(
    "INSERT INTO admin_messages (user_id, email, title, body) VALUES (?, ?, ?, ?)"
  , u.id, u.email, t, b);
  res.status(201).json({ ok: true, para: u.email });
}));

/* ============================================================
   COMUNIDAD — moderación (solo admin)
   ============================================================ */

/* GET /api/admin/community → todos los comentarios CON la identidad real
 * del autor (solo el admin puede ver quién escribió qué). */
router.get("/community", requireAdmin, ah(async (req, res) => {
  const rows = await db.all(
      `SELECT c.id, c.user_id, c.text, c.created_at, c.hidden,
              u.name AS nombre, u.email
       FROM community_comments c
       LEFT JOIN users u ON u.id = c.user_id
       ORDER BY c.created_at DESC
       LIMIT 200`
    );
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
}));

/* POST /api/admin/community/:id/hide → ocultar comentario inapropiado. */
router.post("/community/:id/hide", requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Comentario inválido" });
  const r = await db.run("UPDATE community_comments SET hidden = 1 WHERE id = ?", id);
  if (!r.changes) return res.status(404).json({ error: "Comentario no encontrado" });
  res.json({ ok: true, oculto: true });
}));

/* POST /api/admin/community/:id/unhide → volver a mostrar. */
router.post("/community/:id/unhide", requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Comentario inválido" });
  const r = await db.run("UPDATE community_comments SET hidden = 0 WHERE id = ?", id);
  if (!r.changes) return res.status(404).json({ error: "Comentario no encontrado" });
  res.json({ ok: true, oculto: false });
}));

/* ============ SEGURIDAD: IPs bloqueadas y usuarios baneados ============ */
const { blockIp, unblockIp, banUser, unbanUser, getClientIp } = require("../security");

/* GET /api/admin/blocked-ips → lista de IPs bloqueadas. */
router.get("/blocked-ips", requireAdmin, ah(async (req, res) => {
  const rows = await db.all(
    "SELECT ip, reason, blocked_at, blocked_by FROM blocked_ips ORDER BY blocked_at DESC LIMIT 200"
  );
  res.json({ ips: rows });
}));

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
router.get("/banned-users", requireAdmin, ah(async (req, res) => {
  const rows = await db.all(
    "SELECT id, name, email, country, ban_reason FROM users WHERE banned = 1 ORDER BY id DESC LIMIT 200"
  );
  res.json({ usuarios: rows });
}));

/* POST /api/admin/users/:id/ban { reason } → banear permanentemente. */
router.post("/users/:id/ban", requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Usuario inválido" });
  const target = await db.get("SELECT id, is_admin FROM users WHERE id = ?", id);
  if (!target) return res.status(404).json({ error: "Usuario no encontrado" });
  if (target.is_admin === 1)
    return res.status(400).json({ error: "No se puede banear a un administrador" });
  const reason = String(req.body?.reason || "Violación de términos").slice(0, 200);
  banUser(id, reason);
  res.json({ ok: true, baneado: true });
}));

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

router.post("/change-password", requireAdmin, ah(async (req, res) => {
  const current = String(req.body?.current_password || "");
  const nuevo = String(req.body?.new_password || "");
  const backupEmail = String(req.body?.backup_email || "").trim().toLowerCase();

  if (nuevo.length < 6)
    return res.status(400).json({ error: "La nueva contraseña debe tener al menos 6 caracteres" });

  const admin = await db.get("SELECT id, password_hash FROM users WHERE id = ?", req.user.id);
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
    await db.run("UPDATE users SET password_hash = ?, backup_email = ? WHERE id = ?", hash, backupEmail, admin.id);
  } else {
    await db.run("UPDATE users SET password_hash = ? WHERE id = ?", hash, admin.id);
  }
  res.json({
    ok: true,
    message: "Contraseña actualizada ✅" + (backupEmail ? " Correo de respaldo guardado 📧" : ""),
    backup_email: backupEmail || undefined,
  });
}));

/* GET /api/admin/backup-email → correo de respaldo actual del admin. */
router.get("/backup-email", requireAdmin, ah(async (req, res) => {
  const row = await db.get("SELECT backup_email FROM users WHERE id = ?", req.user.id);
  res.json({ backup_email: row?.backup_email || null });
}));

/* ---------- Banderas de advertencia (moderación comunitaria) ----------
 * GET  /api/admin/flagged → usuarios con bandera roja (level 4) pendientes
 *        de decisión: reactivar o denegar la rehabilitación.
 * POST /api/admin/users/:id/reactivate → borra sus flags (level → 0),
 *        chat_disabled=0, notifica al usuario.
 * POST /api/admin/users/:id/deny-reactivation → mantiene deshabilitado,
 *        notifica al usuario que su solicitud fue denegada. */
router.get("/flagged", requireAdmin, ah(async (req, res) => {
  const rows = await db.all(
      `SELECT u.id, u.name, u.email, u.chat_disabled,
              (SELECT COUNT(*) FROM user_flags f WHERE f.target_user_id = u.id) AS flags,
              (SELECT MAX(f.created_at) FROM user_flags f WHERE f.target_user_id = u.id) AS ultimo
       FROM users u
       WHERE (SELECT COUNT(*) FROM user_flags f WHERE f.target_user_id = u.id) >= 4
       ORDER BY ultimo DESC`
    );
  res.json({ flagged: rows });
}));

router.post("/users/:id/reactivate", requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "ID inválido" });
  const u = await db.get("SELECT id, email, name FROM users WHERE id = ?", id);
  if (!u) return res.status(404).json({ error: "Usuario no encontrado" });
  await db.run("DELETE FROM user_flags WHERE target_user_id = ?", id);
  await db.run("UPDATE users SET chat_disabled = 0 WHERE id = ?", id);
  try {
    await db.run(
      "INSERT INTO admin_messages (user_id, email, title, body) VALUES (?, ?, ?, ?)"
    , id, u.email, "✅ Tu cuenta fue rehabilitada",
      "El administrador revisó tu caso y rehabilitó tu cuenta. Ya puedes volver a chatear y publicar. Por favor mantén un buen comportamiento en la comunidad. 💛");
  } catch (e) { /* no bloquea */ }
  res.json({ ok: true, reactivado: true, email: u.email });
}));

router.post("/users/:id/deny-reactivation", requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "ID inválido" });
  const u = await db.get("SELECT id, email, name FROM users WHERE id = ?", id);
  if (!u) return res.status(404).json({ error: "Usuario no encontrado" });
  try {
    await db.run(
      "INSERT INTO admin_messages (user_id, email, title, body) VALUES (?, ?, ?, ?)"
    , id, u.email, "⛔ Rehabilitación denegada",
      "El administrador revisó tu caso y decidió no rehabilitar tu cuenta por ahora. Tu permiso para chatear sigue deshabilitado.");
  } catch (e) { /* no bloquea */ }
  res.json({ ok: true, denegado: true, email: u.email });
}));

/* ---------- GET /api/admin/users/:id/dms ----------
 * Conversaciones DM de un usuario: por cada contraparte (nombre, id),
 * los mensajes intercambiados ordenados por fecha. Incluye mensajes
 * aunque hayan expirado (si aún están en la tabla). Solo lectura. */
router.get("/users/:id/dms", requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "ID inválido" });
  const u = await db.get("SELECT id, name, email FROM users WHERE id = ?", id);
  if (!u) return res.status(404).json({ error: "Usuario no encontrado" });

  // Contrapartes: usuarios con los que intercambió DMs (en ambas direcciones).
  const peers = await db.all(
      `SELECT DISTINCT other.id, other.name, other.email
       FROM (
         SELECT to_user_id AS oid FROM private_messages WHERE from_user_id = ?
         UNION
         SELECT from_user_id AS oid FROM private_messages WHERE to_user_id = ?
       ) x
       JOIN users other ON other.id = x.oid
       ORDER BY other.name`
    , id, id);

  const conversations = peers.map(async (p) => {
    const msgs = await db.all(
        `SELECT id, from_user_id, to_user_id, text, created_at, read_at, expires_at
         FROM private_messages
         WHERE (from_user_id = ? AND to_user_id = ?)
            OR (from_user_id = ? AND to_user_id = ?)
         ORDER BY created_at ASC, id ASC`
      , id, p.id, p.id, id);
    return {
      id: p.id,
      nombre: p.name || p.email,
      email: p.email,
      total: msgs.length,
      mensajes: msgs.map((m) => ({
        id: m.id,
        de: m.from_user_id === id ? "usuario" : "contraparte",
        deId: m.from_user_id,
        texto: m.text,
        fecha: fmtDateTime(m.created_at),
        leido: !!m.read_at,
        expirado: m.expires_at
          ? new Date(String(m.expires_at).replace(" ", "T") + "Z").getTime() < Date.now()
          : false,
      })),
    };
  });

  res.json({ ok: true, usuario: { id: u.id, nombre: u.name, email: u.email }, conversaciones: conversations });
}));

/* ---------- POST /api/admin/users/:id/flag ----------
 * El admin agrega UNA bandera de advertencia al usuario manualmente.
 * Si ya tiene 4, no hace nada. Al llegar a 4: chat_disabled=1.
 * El admin no puede banderearse a sí mismo ni a otro admin. */
router.post("/users/:id/flag", requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "ID inválido" });
  if (id === req.user.id)
    return res.status(400).json({ error: "No puedes banderearte a ti mismo" });
  const target = await db.get("SELECT id, email, name, is_admin, chat_disabled FROM users WHERE id = ?", id);
  if (!target) return res.status(404).json({ error: "Usuario no encontrado" });
  if (target.is_admin === 1)
    return res.status(400).json({ error: "No puedes banderear al administrador" });

  // Un flag por reportero (el admin cuenta como un reportero).
  const existing = await db.get("SELECT id FROM user_flags WHERE target_user_id = ? AND reporter_user_id = ?", id, req.user.id);
  if (!existing) {
    await db.run(
      "INSERT INTO user_flags (target_user_id, reporter_user_id) VALUES (?, ?)"
    , id, req.user.id);
  }

  const level = await flagLevel(id);

  // Notificar al usuario de la advertencia manual del admin.
  const levelNames = ["blanca ⚪", "azul 🔵", "amarilla 🟡", "negra ⚫", "roja 🔴"];
  try {
    await db.run(
      "INSERT INTO admin_messages (user_id, email, title, body) VALUES (?, ?, ?, ?)"
    , id, target.email, "⚠️ Advertencia del administrador",
      `El administrador te envió una advertencia directa (bandera ${levelNames[level]}). ` +
      `Por favor evita ese comportamiento. Si llegas a la bandera roja, tu cuenta será deshabilitada para chatear.`);
  } catch (e) { /* no bloquea */ }

  // Bandera roja: deshabilitar chat (sin aviso "ultimadecision": lo hizo el admin).
  if (level >= 4 && target.chat_disabled !== 1) {
    await db.run("UPDATE users SET chat_disabled = 1 WHERE id = ?", id);
    try {
      await db.run(
        "INSERT INTO admin_messages (user_id, email, title, body) VALUES (?, ?, ?, ?)"
      , id, target.email, "🔴 Tu cuenta fue deshabilitada para chatear",
        `El administrador te puso bandera roja. Tu permiso para chatear y publicar contenido quedó deshabilitado.`);
    } catch (e) { /* no bloquea */ }
  }

  res.json({ ok: true, level });
}));

/* ---------- DELETE /api/admin/users/:id/flags ----------
 * El admin quita TODAS las banderas del usuario (nivel → 0).
 * Si el chat estaba deshabilitado por bandera roja, se reactiva.
 * Sin notificación "ultimadecision". */
router.delete("/users/:id/flags", requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "ID inválido" });
  const u = await db.get("SELECT id, email FROM users WHERE id = ?", id);
  if (!u) return res.status(404).json({ error: "Usuario no encontrado" });
  await db.run("DELETE FROM user_flags WHERE target_user_id = ?", id);
  await db.run("UPDATE users SET chat_disabled = 0 WHERE id = ?", id);
  res.json({ ok: true, level: 0 });
}));

/* ---------- GET /api/admin/community/recent ----------
 * Mensajes recientes del chat grupal para la vista en vivo del admin.
 * Sin anonimizar: el admin ve nombres reales. Incluye ocultos. */
router.get("/community/recent", requireAdmin, ah(async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const rows = await db.all(
      `SELECT c.id, c.user_id, c.text, c.created_at, c.msg_type, c.hidden,
              u.name, u.email, u.is_admin
       FROM community_comments c
       JOIN users u ON u.id = c.user_id
       ORDER BY c.created_at DESC
       LIMIT ?`
    , limit);
  res.json({
    ok: true,
    mensajes: rows.map((c) => ({
      id: c.id,
      userId: c.user_id,
      nombre: c.name || c.email,
      email: c.email,
      esAdmin: c.is_admin === 1,
      texto: c.msg_type === "photo" ? "📷 Foto" : (c.text || ""),
      tipo: c.msg_type,
      fecha: fmtDateTime(c.created_at),
      oculto: c.hidden === 1,
    })),
  });
}));

/* ---------- 📊 Reportes de Muse para el administrador ---------- */
router.get("/reports", requireAdmin, ah(async (req, res) => {
  const rows = await db.all(
    "SELECT id, title, content, report_type, user_id, user_name, is_read, created_at FROM admin_reports ORDER BY id DESC LIMIT 50"
  );
  const unread = await db.get("SELECT COUNT(*) AS n FROM admin_reports WHERE is_read = 0");
  res.json({ ok: true, reports: rows, unread: unread ? unread.n : 0 });
}));

router.post("/reports/:id/read", requireAdmin, ah(async (req, res) => {
  await db.run("UPDATE admin_reports SET is_read = 1 WHERE id = ?", req.params.id);
  res.json({ ok: true });
}));

module.exports = { router, requireAdmin };
