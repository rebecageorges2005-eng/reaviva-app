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
  if (password.length < 8)
    return res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres" });

  const exists = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (exists) return res.status(409).json({ error: "Ese correo ya está registrado" });

  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare("INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)")
    .run(email, name, hash);
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);

  res.status(201).json({ token: signToken(row), user: publicUser(row) });
});

/* POST /api/auth/login  { email, password } */
router.post("/login", (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!row || !bcrypt.compareSync(password, row.password_hash))
    return res.status(401).json({ error: "Correo o contraseña incorrectos" });

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

  res.json({ token: signToken(row), user: publicUser(row) });
});

module.exports = { router, requireAuth };
