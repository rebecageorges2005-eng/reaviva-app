/* Reaviva API — auth: signup / login / me + JWT middleware */
"use strict";

const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../db");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TOKEN_TTL = "30d";

function signToken(user) {
  return jwt.sign(
    { uid: user.id, email: user.email, admin: user.is_admin === 1 },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    programStart: row.program_start,
    subscribed: row.subscribed === 1,
    isAdmin: row.is_admin === 1,
    createdAt: row.created_at,
  };
}

/* ============================================================
   IP Y PAÍS DEL USUARIO (para saber desde qué país se conectan)
   ============================================================ */
/* IP real del cliente: Render está detrás de un proxy, así que
 * x-forwarded-for (primera IP) es lo más fiable; si no existe,
 * se usa la conexión directa. */
function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) {
    const first = String(xff).split(",")[0].trim();
    if (first) return first;
  }
  const ra = req.socket && req.socket.remoteAddress;
  if (ra) {
    // Normaliza el formato IPv4-mapeado-en-IPv6 (::ffff:1.2.3.4)
    const m = String(ra).match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return m ? m[1] : String(ra);
  }
  return null;
}

function isPrivateIp(ip) {
  if (!ip) return true;
  if (ip === "::1" || ip === "::ffff:127.0.0.1") return true;
  return (
    /^127\./.test(ip) ||
    /^10\./.test(ip) ||
    /^192\.168\./.test(ip) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    /^169\.254\./.test(ip)
  );
}

/* Geo-lookup asíncrono (ip-api.com, gratis, sin API key).
 * NO bloquea la respuesta: se dispara y se olvida. */
function trackGeoAsync(userId, ip) {
  if (!userId || !ip || isPrivateIp(ip)) return;
  setTimeout(() => {
    fetch("http://ip-api.com/json/" + encodeURIComponent(ip) + "?fields=country,countryCode,status", { signal: AbortSignal.timeout(8000) })
      .then((r) => r.json())
      .then((j) => {
        if (j && j.status === "success" && j.country) {
          db.prepare("UPDATE users SET country = ?, country_code = ? WHERE id = ?")
            .run(j.country, j.countryCode || null, userId);
        }
      })
      .catch(() => { /* falla silenciosamente: el país queda null */ });
  }, 0);
}

/* Guarda/actualiza la IP del usuario y dispara el lookup de país. */
function trackUserIp(userId, req) {
  const ip = getClientIp(req);
  if (!userId || !ip) return;
  try {
    db.prepare("UPDATE users SET ip = ? WHERE id = ? AND (ip IS NULL OR ip != ?)").run(ip, userId, ip);
  } catch (e) { /* no bloquea */ }
  trackGeoAsync(userId, ip);
}

/* Middleware: require a valid Bearer token. Attaches req.user = full DB row. */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Token requerido" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(payload.uid);
    if (!row) return res.status(401).json({ error: "Usuario no encontrado" });
    req.user = row;
    // Track activity for the admin "online now" metric (fire and forget).
    try {
      db.prepare("UPDATE users SET last_seen = datetime('now') WHERE id = ?").run(row.id);
    } catch (e) { /* no bloquea la petición */ }
    next();
  } catch (e) {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }
}

/* POST /api/auth/signup  { name, email, password } */
router.post("/signup", (req, res) => {
  const name = String(req.body?.name || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  if (!name) return res.status(400).json({ error: "El nombre es requerido" });
  if (!email || !email.includes("@"))
    return res.status(400).json({ error: "Correo inválido" });
  if (password.length < 6)
    return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });

  const exists = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (exists) return res.status(409).json({ error: "Ese correo ya está registrado" });

  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare("INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)")
    .run(email, name, hash);
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
  trackUserIp(row.id, req); // registra IP y país (asíncrono)

  res.status(201).json({ token: signToken(row), user: publicUser(row) });
});

/* POST /api/auth/login  { email, password } */
router.post("/login", (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!row || !bcrypt.compareSync(password, row.password_hash))
    return res.status(401).json({ error: "Correo o contraseña incorrectos" });

  trackUserIp(row.id, req); // actualiza IP y país (asíncrono)
  res.json({ token: signToken(row), user: publicUser(row) });
});

/* POST /api/auth/admin-login  { code }
 * Code-based admin access. Requires ADMIN_CODE env var to be set.
 * Creates the admin user on first use (email admin@reavivaapp.com). */
router.post("/admin-login", (req, res) => {
  const adminCode = process.env.ADMIN_CODE;
  if (!adminCode)
    return res.status(503).json({ error: "Acceso de administrador no configurado" });

  const code = String(req.body?.code || "").trim();
  if (!code || code !== adminCode)
    return res.status(401).json({ error: "Código incorrecto" });

  const ADMIN_EMAIL = "admin@reavivaapp.com";
  let row = db.prepare("SELECT * FROM users WHERE email = ?").get(ADMIN_EMAIL);
  if (!row) {
    const hash = bcrypt.hashSync("admin-" + Date.now() + "-" + Math.random(), 10);
    const info = db
      .prepare(
        "INSERT INTO users (email, name, password_hash, subscribed, is_admin) VALUES (?, ?, ?, 1, 1)"
      )
      .run(ADMIN_EMAIL, "Georges", hash);
    row = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
  } else if (row.is_admin !== 1 || row.subscribed !== 1) {
    db.prepare("UPDATE users SET is_admin = 1, subscribed = 1 WHERE id = ?").run(row.id);
    row = db.prepare("SELECT * FROM users WHERE id = ?").get(row.id);
  }

  trackUserIp(row.id, req); // registra IP y país (asíncrono)
  res.json({ token: signToken(row), user: publicUser(row) });
});

/* GET /api/auth/me → devuelve el usuario actual (valida la sesión) */
router.get("/me", requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

module.exports = { router, requireAuth };
