/* Reaviva API — auth: signup / login / me + JWT middleware */
"use strict";

const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const db = require("../db");
const { sendVerificationEmail, sendWelcomeEmail } = require("../email");

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
    // El admin siempre se considera verificado.
    emailVerified: row.email_verified === 1 || row.is_admin === 1,
    createdAt: row.created_at,
    photo: row.photo || null,
    // País y último acceso: visibles para el propio usuario.
    // La IP NUNCA se expone aquí (solo el admin la ve en su panel).
    pais: row.country || null,
    codigoPais: row.country_code || null,
    ultimoAcceso: row.last_seen || null,
  };
}

/* Verifica un JWT y devuelve {id, subscribed, is_admin} o null.
 * Se usa en el middleware de audios (las etiquetas <audio> no envían
 * headers, así que el token llega como ?token=). */
function verifyToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const row = db
      .prepare("SELECT id, subscribed, is_admin FROM users WHERE id = ?")
      .get(payload.uid);
    return row || null;
  } catch (e) {
    return null;
  }
}

/* Genera un token único para el link de verificación.
 * Los tokens no expiran (documentado): el link funciona hasta que se usa. */
function newVerificationToken() {
  return crypto.randomBytes(32).toString("hex");
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

/* Verifica el token de reCAPTCHA v2 contra Google.
 * Si RECAPTCHA_SECRET_KEY no está configurado, o no llegó token,
 * NO bloquea (el registro funciona sin captcha). */
async function verifyRecaptcha(token, ip) {
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret || !token) return true;
  try {
    const params = new URLSearchParams({ secret, response: token });
    if (ip) params.append("remoteip", ip);
    const r = await fetch("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      signal: AbortSignal.timeout(10000),
    });
    const j = await r.json();
    return j.success === true;
  } catch (e) {
    console.error("[recaptcha] error verificando:", e.message);
    return false;
  }
}

/* POST /api/auth/signup  { name, email, password, recaptchaToken? }
 * Crea la cuenta SIN verificar. Envía el correo de confirmación
 * (asíncrono, no bloquea). NO devuelve token de sesión: el usuario
 * debe confirmar su correo antes de poder entrar. */
router.post("/signup", async (req, res) => {
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

  // reCAPTCHA v2 (solo si está configurado y llegó el token).
  const recaptchaToken = String(req.body?.recaptchaToken || "").trim();
  if (process.env.RECAPTCHA_SECRET_KEY && recaptchaToken) {
    const human = await verifyRecaptcha(recaptchaToken, getClientIp(req));
    if (!human) return res.status(400).json({ error: "Verifica que no eres un robot 🤖" });
  }

  const hash = bcrypt.hashSync(password, 10);
  const token = newVerificationToken();
  const info = db
    .prepare("INSERT INTO users (email, name, password_hash, email_verified, verification_token) VALUES (?, ?, ?, 0, ?)")
    .run(email, name, hash, token);
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
  trackUserIp(row.id, req); // registra IP y país (asíncrono)

  // Correo de verificación (fire-and-forget, no bloquea la respuesta).
  sendVerificationEmail({ to: email, name, token });

  res.status(201).json({
    ok: true,
    email,
    message: "Te enviamos un link de confirmación a tu correo. Haz clic en el link para activar tu cuenta.",
  });
});

/* GET /api/auth/verify?token=xxx
 * Confirma la cuenta con el link del correo. Devuelve una página HTML
 * bonita (es el destino del link del correo). Al confirmar, envía el
 * SEGUNDO correo: bienvenida/confirmación. */
router.get("/verify", (req, res) => {
  const token = String(req.query.token || "").trim();
  const page = (title, emoji, text, cta) =>
    `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1.0">` +
    `<title>${title} — Reaviva</title>` +
    `<link rel="icon" type="image/png" href="/favicon.png"></head>` +
    `<body style="margin:0;background:#faf6f1;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;">` +
    `<div style="max-width:520px;margin:0 auto;padding:60px 20px;text-align:center;">` +
    `<div style="font-size:1.5rem;font-weight:800;color:#4a3728;">Reaviva<span style="color:#c4704f;">.</span></div>` +
    `<div style="font-size:3.5rem;margin:24px 0 12px;">${emoji}</div>` +
    `<h1 style="color:#4a3728;font-size:1.5rem;">${title}</h1>` +
    `<p style="color:#7a6252;line-height:1.6;">${text}</p>` +
    (cta
      ? `<a href="/" style="display:inline-block;margin-top:16px;background:#c4704f;color:#fff;` +
        `text-decoration:none;font-weight:700;padding:14px 34px;border-radius:12px;">${cta}</a>`
      : "") +
    `</div></body></html>`;

  if (!token) {
    return res.status(400).send(page(
      "Link inválido", "⚠️",
      "Este link de confirmación no es válido. Vuelve a la página e inicia sesión para reenviar el correo de confirmación.",
      "Ir a Reaviva"
    ));
  }
  const row = db.prepare("SELECT * FROM users WHERE verification_token = ?").get(token);
  if (!row) {
    return res.status(400).send(page(
      "Link inválido o ya usado", "⚠️",
      "Este link de confirmación no es válido o ya fue usado. Si ya confirmaste tu cuenta, entra directamente. Si no, inicia sesión para reenviar el correo.",
      "Ir a Reaviva"
    ));
  }
  db.prepare("UPDATE users SET email_verified = 1, verification_token = NULL WHERE id = ?").run(row.id);
  // SEGUNDO correo: bienvenida/confirmación (fire-and-forget).
  sendWelcomeEmail({ to: row.email, name: row.name });
  res.send(page(
    "¡Cuenta confirmada! 🎉", "🎉",
    `Hola ${String(row.name || "").replace(/[<>&"]/g, "")}: tu correo quedó confirmado y tu cuenta ya está activa. Ya puedes entrar con tu correo y tu contraseña. ¡Bienvenido/a a tus 7 días gratis! 💛`,
    "Entrar a mi cuenta"
  ));
});

/* Límite de reenvíos: máx. 3 por hora por correo (en memoria). */
const resendAttempts = new Map();
function resendAllowed(email) {
  const now = Date.now();
  const key = email.toLowerCase();
  const arr = (resendAttempts.get(key) || []).filter((t) => now - t < 3600000);
  if (arr.length >= 3) return false;
  arr.push(now);
  resendAttempts.set(key, arr);
  // Limpieza ocasional para no crecer sin límite.
  if (resendAttempts.size > 5000) {
    for (const [k, v] of resendAttempts) {
      if (!v.some((t) => now - t < 3600000)) resendAttempts.delete(k);
    }
  }
  return true;
}

/* POST /api/auth/resend-verification  { email }
 * Reenvía el correo de confirmación (nuevo token). */
router.post("/resend-verification", (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email || !email.includes("@"))
    return res.status(400).json({ error: "Correo inválido" });
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  // No revelar si el correo existe o no (misma respuesta genérica).
  if (!row) {
    return res.json({ ok: true, message: "Si ese correo está registrado, te enviamos un nuevo link." });
  }
  if (row.email_verified === 1 || row.is_admin === 1) {
    return res.json({ ok: true, message: "Tu cuenta ya está confirmada. Ya puedes entrar." });
  }
  if (!resendAllowed(email)) {
    return res.status(429).json({ error: "Demasiados intentos. Espera una hora e inténtalo de nuevo." });
  }
  const token = newVerificationToken();
  db.prepare("UPDATE users SET verification_token = ? WHERE id = ?").run(token, row.id);
  sendVerificationEmail({ to: row.email, name: row.name, token });
  res.json({ ok: true, message: "Te enviamos un nuevo link de confirmación. Revisa tu correo." });
});

/* POST /api/auth/login  { email, password }
 * Solo entran usuarios con el correo confirmado (el admin no necesita). */
router.post("/login", (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!row || !bcrypt.compareSync(password, row.password_hash))
    return res.status(401).json({ error: "Correo o contraseña incorrectos" });

  if (row.is_admin !== 1 && row.email_verified !== 1) {
    return res.status(403).json({
      error: "Confirma tu correo antes de entrar. Revisa tu bandeja.",
      needsVerification: true,
    });
  }

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
  // El admin no necesita verificación de correo.
  if (row.email_verified !== 1) {
    db.prepare("UPDATE users SET email_verified = 1, verification_token = NULL WHERE id = ?").run(row.id);
    row = db.prepare("SELECT * FROM users WHERE id = ?").get(row.id);
  }

  trackUserIp(row.id, req); // registra IP y país (asíncrono)
  res.json({ token: signToken(row), user: publicUser(row) });
});

/* GET /api/auth/me → devuelve el usuario actual (valida la sesión) */
router.get("/me", requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

/* POST /api/profile/photo  { photo: "data:image/jpeg;base64,..." }
 * Foto de perfil del usuario (máx 2MB). El frontend la redimensiona
 * a 400x400 antes de subirla. Se guarda en users.photo. */
router.post("/profile/photo", requireAuth, (req, res) => {
  const photo = String(req.body?.photo || "");
  const ok = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(photo);
  if (!ok) return res.status(400).json({ error: "Formato de imagen inválido" });
  // ~2.9MB en base64 ≈ 2.1MB binarios
  if (photo.length > 2.9 * 1024 * 1024)
    return res.status(400).json({ error: "La imagen es muy grande (máx 2MB)" });
  db.prepare("UPDATE users SET photo = ? WHERE id = ?").run(photo, req.user.id);
  res.json({ ok: true });
});

module.exports = { router, requireAuth, verifyToken };
