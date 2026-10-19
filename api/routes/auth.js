/* Reaviva API — auth: signup / login / me + JWT middleware */
"use strict";

const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const db = require("../db");
const { ah } = db;
const { sendVerificationEmail, sendWelcomeEmail, sendLoginAlertEmail } = require("../email");
const { getPlanType } = require("../plan");
const {
  getClientIp,
  isPrivateIp,
  rateLimit,
  recordFailedLogin,
  clearFailedLogins,
  isBanned,
} = require("../security");

const router = express.Router();

/* Rate limits de autenticación (por IP):
 * - login: 10 intentos / 15 min (anti fuerza bruta)
 * - signup: 5 / hora (anti cuentas spam)
 * - admin-login: 10 / 15 min */
const loginLimiter = (req, res, next) => next(); // TEMP DESACTIVADO
const _loginLimiter = rateLimit({
  max: 10, windowMs: 15 * 60 * 1000,
  message: "Demasiados intentos de acceso. Espera 15 minutos.",
  keyFn: () => "login",
});
const signupLimiter = (req, res, next) => next(); // TEMP DESACTIVADO
const _signupLimiter = rateLimit({
  max: 5, windowMs: 60 * 60 * 1000,
  message: "Demasiados registros desde esta conexión. Espera una hora.",
  keyFn: () => "signup",
});
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TOKEN_TTL = "30d";

function signToken(user, extra) {
  const payload = { uid: user.id, email: user.email, admin: user.is_admin === 1 };
  // Modo "solo cambiar contraseña": el token solo sirve para eso.
  if (extra && extra.mustChangePassword) payload.must_change_password = true;
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    programStart: row.program_start,
    subscribed: row.subscribed === 1,
    isAdmin: row.is_admin === 1,
    // Tipo de plan: 'annual' | 'monthly' | 'free' (el admin cuenta como annual).
    planType: getPlanType(row),
    // El admin siempre se considera verificado.
    emailVerified: row.email_verified === 1 || row.is_admin === 1,
    createdAt: row.created_at,
    photo: row.photo || null,
    coverPhoto: row.cover_photo || null,
    // País y último acceso: visibles para el propio usuario.
    // La IP NUNCA se expone aquí (solo el admin la ve en su panel).
    pais: row.country || null,
    codigoPais: row.country_code || null,
    ultimoAcceso: row.last_seen || null,
    gender: row.gender || null,
    bio: row.bio || null,
  };
}

/* Contraseña fuerte: mín 8 caracteres, 1 mayúscula, 1 minúscula, 1 número y 1 carácter especial. */
function isStrongPassword(pw){
  return typeof pw === "string" &&
    pw.length >= 8 &&
    /[A-Z]/.test(pw) &&
    /[a-z]/.test(pw) &&
    /[0-9]/.test(pw) &&
    /[^A-Za-z0-9]/.test(pw);
}
const STRONG_PW_MSG = "La contraseña debe tener mínimo 8 caracteres, 1 mayúscula, 1 minúscula, 1 número y 1 carácter especial";

/* Verifica un JWT y devuelve {id, subscribed, is_admin} o null.
 * Se usa en el middleware de audios (las etiquetas <audio> no envían
 * headers, así que el token llega como ?token=). */
async function verifyToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const row = await db.get("SELECT id, subscribed, is_admin, banned FROM users WHERE id = ?", payload.uid);
    if (!row || row.banned === 1) return null; // baneado: token invalidado
    return row;
  } catch (e) {
    return null;
  }
}

/* Edad en años cumplidos para "YYYY-MM-DD". -1 si la fecha es inválida. */
function calcAge(bd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(bd || ""));
  if (!m) return -1;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return -1;
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return -1;
  const today = new Date();
  let age = today.getFullYear() - y;
  const md = (today.getMonth() + 1) - mo;
  if (md < 0 || (md === 0 && today.getDate() < d)) age--;
  return age;
}

/* Genera un token único para el link de verificación.
 * Los tokens no expiran (documentado): el link funciona hasta que se usa. */
function newVerificationToken() {
  return crypto.randomBytes(32).toString("hex");
}

/* ============================================================
   IP Y PAÍS DEL USUARIO (para saber desde qué país se conectan)
   getClientIp e isPrivateIp vienen de ../security (compartidos).
   ============================================================ */

/* Geo-lookup asíncrono (ip-api.com, gratis, sin API key).
 * NO bloquea la respuesta: se dispara y se olvida. */
function trackGeoAsync(userId, ip) {
  if (!userId || !ip || isPrivateIp(ip)) return;
  setTimeout(() => {
    fetch("http://ip-api.com/json/" + encodeURIComponent(ip) + "?fields=country,countryCode,status", { signal: AbortSignal.timeout(8000) })
      .then((r) => r.json())
      .then(async (j) => {
        if (j && j.status === "success" && j.country) {
          await db.run("UPDATE users SET country = ?, country_code = ? WHERE id = ?", j.country, j.countryCode || null, userId);
        }
      })
      .catch(() => { /* falla silenciosamente: el país queda null */ });
  }, 0);
}

/* Guarda/actualiza la IP del usuario y dispara el lookup de país. */
async function trackUserIp(userId, req) {
  const ip = getClientIp(req);
  if (!userId || !ip) return;
  try {
    await db.run("UPDATE users SET ip = ? WHERE id = ? AND (ip IS NULL OR ip != ?)", ip, userId, ip);
  } catch (e) { /* no bloquea */ }
  trackGeoAsync(userId, ip);
}

/* Describe el dispositivo de forma básica a partir del User-Agent. */
function describeDevice(ua) {
  const s = String(ua || "");
  const mobile = /mobile|android|iphone|ipad/i.test(s);
  let browser = "Navegador desconocido";
  if (/edg/i.test(s)) browser = "Edge";
  else if (/chrome/i.test(s) && !/edg/i.test(s)) browser = "Chrome";
  else if (/safari/i.test(s) && !/chrome/i.test(s)) browser = "Safari";
  else if (/firefox/i.test(s)) browser = "Firefox";
  else if (/opera|opr/i.test(s)) browser = "Opera";
  let os = "";
  if (/android/i.test(s)) os = "Android";
  else if (/iphone|ipad/i.test(s)) os = "iOS";
  else if (/windows/i.test(s)) os = "Windows";
  else if (/macintosh|mac os/i.test(s)) os = "Mac";
  else if (/linux/i.test(s)) os = "Linux";
  return `${browser} en ${os || (mobile ? "móvil" : "computadora")}`;
}

/* Alerta de nuevo inicio de sesión por correo (background, no bloquea).
 * Solo se envía si la IP es DISTINTA a la del último login registrado,
 * para no spamear al usuario que entra a diario desde su casa. */
function notifyNewLogin(row, req) {
  try {
    const ip = getClientIp(req);
    if (!ip || isPrivateIp(ip)) return;
    // row.ip es la IP del login ANTERIOR (trackUserIp aún no la actualizó o ya lo hizo;
    // comparamos contra lo que había antes de este login).
    const prevIp = row.ip || null;
    if (!prevIp) return; // primer login registrado: sin alerta
    if (prevIp === ip) return; // misma IP: sin alerta
    const ua = req.headers["user-agent"] || "";
    const device = describeDevice(ua);
    // Geo con ciudad para el correo (timeout corto, no bloquea).
    fetch("http://ip-api.com/json/" + encodeURIComponent(ip) + "?fields=country,city,status",
      { signal: AbortSignal.timeout(8000) })
      .then((r) => r.json())
      .then((j) => {
        sendLoginAlertEmail({
          to: row.email,
          name: row.name,
          ip,
          country: j && j.status === "success" ? j.country : null,
          city: j && j.status === "success" ? j.city : null,
          device,
        });
      })
      .catch(() => {
        // Sin geo: igual se envía la alerta con la IP.
        sendLoginAlertEmail({ to: row.email, name: row.name, ip, device });
      });
  } catch (e) { /* nunca bloquea el login */ }
}

/* Middleware: require a valid Bearer token. Attaches req.user = full DB row. */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Token requerido" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const row = await db.get("SELECT * FROM users WHERE id = ?", payload.uid);
    if (!row) return res.status(401).json({ error: "Usuario no encontrado" });
    if (row.banned === 1)
      return res.status(401).json({ error: "Cuenta suspendida permanentemente." });
    req.user = row;
    // Modo "solo cambiar contraseña": el token temporal solo permite
    // cambiar la contraseña. Todo lo demás queda bloqueado.
    if (payload.must_change_password === true) {
      const allowedPaths = ["/change-password", "/me", "/logout"];
      if (!allowedPaths.includes(req.path)) {
        return res.status(403).json({
          error: "Debes cambiar tu contraseña primero.",
          mustChangePassword: true,
        });
      }
      req.mustChangePassword = true;
    }
    // Track activity for the admin "online now" metric (fire and forget).
    try {
      await db.run("UPDATE users SET last_seen = datetime('now') WHERE id = ?", row.id);
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
router.post("/signup", signupLimiter, ah(async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  if (!name) return res.status(400).json({ error: "El nombre es requerido" });
  if (!email || !email.includes("@"))
    return res.status(400).json({ error: "Correo inválido" });
  if (!isStrongPassword(password))
    return res.status(400).json({ error: STRONG_PW_MSG });

  // Fecha de nacimiento: formato YYYY-MM-DD válido y 18+ años.
  const birthdate = String(req.body?.birthdate || "").trim();
  const age = calcAge(birthdate);
  if (age < 0)
    return res.status(400).json({ error: "Fecha de nacimiento inválida" });
  if (age < 18)
    return res.status(400).json({ error: "Debes tener al menos 18 años para registrarte." });
  if (age > 90)
    return res.status(400).json({ error: "La edad máxima para registrarse es 90 años." });

  // Sexo: M o F, requerido para adaptar contenido y voz.
  const gender = String(req.body?.gender || "").trim().toUpperCase();
  if (gender !== "M" && gender !== "F")
    return res.status(400).json({ error: "Elige si eres hombre o mujer" });

  // País: seleccionado por el usuario en el registro.
  const country = String(req.body?.country || "").trim().slice(0, 80);
  if (!country)
    return res.status(400).json({ error: "Elige tu país" });

  const exists = await db.get("SELECT id FROM users WHERE email = ?", email);
  if (exists) return res.status(409).json({ error: "Ese correo ya está registrado" });

  // reCAPTCHA v2 (solo si está configurado y llegó el token).
  const recaptchaToken = String(req.body?.recaptchaToken || "").trim();
  if (process.env.RECAPTCHA_SECRET_KEY && recaptchaToken) {
    const human = await verifyRecaptcha(recaptchaToken, getClientIp(req));
    if (!human) return res.status(400).json({ error: "Verifica que no eres un robot 🤖" });
  }

  const hash = bcrypt.hashSync(password, 10);
  const token = newVerificationToken();
  // Referido: ?ref=USERID en el link compartido (opcional).
  let referredBy = null;
  const refRaw = String(req.body?.referred_by || "").trim();
  if (/^\d+$/.test(refRaw)) {
    const refId = Number(refRaw);
    const refUser = await db.get("SELECT id FROM users WHERE id = ?", refId);
    if (refUser) referredBy = refId;
  }
  const info = await db.run("INSERT INTO users (email, name, password_hash, email_verified, verification_token, referred_by, birthdate, gender, country) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)", email, name, hash, token, referredBy, birthdate, gender, country);
  const row = await db.get("SELECT * FROM users WHERE id = ?", info.lastInsertRowid);
  trackUserIp(row.id, req); // registra IP y país (asíncrono)

  // Correo de verificación (fire-and-forget, no bloquea la respuesta).
  sendVerificationEmail({ to: email, name, token });

  res.status(201).json({
    ok: true,
    email,
    message: "Te enviamos un link de confirmación a tu correo. Haz clic en el link para activar tu cuenta.",
  });
}));

/* GET /api/auth/verify?token=xxx
 * Confirma la cuenta con el link del correo. Devuelve una página HTML
 * bonita (es el destino del link del correo). Al confirmar, envía el
 * SEGUNDO correo: bienvenida/confirmación. */
router.get("/verify", ah(async (req, res) => {
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
  const row = await db.get("SELECT * FROM users WHERE verification_token = ?", token);
  if (!row) {
    return res.status(400).send(page(
      "Link inválido o ya usado", "⚠️",
      "Este link de confirmación no es válido o ya fue usado. Si ya confirmaste tu cuenta, entra directamente. Si no, inicia sesión para reenviar el correo.",
      "Ir a Reaviva"
    ));
  }
  await db.run("UPDATE users SET email_verified = 1, verification_token = NULL WHERE id = ?", row.id);
  // SEGUNDO correo: bienvenida/confirmación (fire-and-forget).
  sendWelcomeEmail({ to: row.email, name: row.name });
  res.send(page(
    "¡Cuenta confirmada! 🎉", "🎉",
    `Hola ${String(row.name || "").replace(/[<>&"]/g, "")}: tu correo quedó confirmado y tu cuenta ya está activa. Ya puedes entrar con tu correo y tu contraseña. ¡Bienvenido/a a tus 7 días gratis! 💛`,
    "Entrar a mi cuenta"
  ));
}));

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
router.post("/resend-verification", ah(async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email || !email.includes("@"))
    return res.status(400).json({ error: "Correo inválido" });
  const row = await db.get("SELECT * FROM users WHERE email = ?", email);
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
  await db.run("UPDATE users SET verification_token = ? WHERE id = ?", token, row.id);
  sendVerificationEmail({ to: row.email, name: row.name, token });
  res.json({ ok: true, message: "Te enviamos un nuevo link de confirmación. Revisa tu correo." });
}));

/* POST /api/auth/login  { email, password }
 * Solo entran usuarios con el correo confirmado (el admin no necesita). */
router.post("/login", loginLimiter, ah(async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const ip = getClientIp(req);

  const row = await db.get("SELECT * FROM users WHERE email = ?", email);
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    // recordFailedLogin(ip, req); // TEMP DESACTIVADO → IP bloqueada
    // Bloqueo por contraseña incorrecta: 3 fallos → cuenta desactivada 48h.
    // (Solo si el correo existe, para no revelar qué correos están registrados.)
    let failedAttempts = 0;
    if (row) {
      try { failedAttempts = (row.failed_logins || 0) + 1; } catch(e) { failedAttempts = 1; }
      if (failedAttempts >= 3) {
        await db.run(
          "UPDATE users SET failed_logins = 0, locked_until = datetime('now', '+48 hours') WHERE id = ?"
        , row.id);
        console.warn(`[seguridad] cuenta desactivada 48h por 3 intentos fallidos: ${email}`);
        return res.status(403).json({
          error: "Cuenta desactivada por 48 horas por múltiples intentos fallidos.",
          locked: true,
        });
      }
      await db.run("UPDATE users SET failed_logins = ? WHERE id = ?", failedAttempts, row.id);
    }
    return res.status(401).json({
      error: "Correo o contraseña incorrectos",
      failedAttempts, // el frontend muestra "¿Olvidaste tu contraseña?" al 2do fallo
    });
  }
  clearFailedLogins(ip); // login correcto: se limpia el contador de IP
  // Login correcto: se reinicia el contador de fallos del usuario.
  if (row.failed_logins) {
    try { await db.run("UPDATE users SET failed_logins = 0 WHERE id = ?", row.id); } catch (e) {}
  }

  // Cuenta baneada permanentemente: no puede entrar (tokens viejos también invalidados).
  if (row.banned === 1) {
    return res.status(401).json({ error: "Cuenta suspendida permanentemente." });
  }

  // Cuenta desactivada por 48h (3 contraseñas incorrectas).
  if (row.locked_until && row.locked_until > new Date().toISOString().slice(0, 19).replace("T", " ")) {
    return res.status(403).json({
      error: "Cuenta desactivada por 48 horas por múltiples intentos fallidos.",
      locked: true,
      lockedUntil: row.locked_until,
    });
  }

  // Cuenta deshabilitada por 15 días (3 cambios de contraseña en una semana).
  if (row.disabled_until && row.disabled_until > new Date().toISOString().slice(0, 19).replace("T", " ")) {
    return res.status(403).json({
      error: "Cuenta deshabilitada por 15 días por seguridad. Tu saldo RV se perdió.",
      disabled: true,
      disabledUntil: row.disabled_until,
    });
  }

  // Cuenta baneada permanentemente: no puede entrar (tokens viejos también invalidados).
  if (row.banned === 1) {
    return res.status(401).json({ error: "Cuenta suspendida permanentemente." });
  }

  if (row.is_admin !== 1 && row.email_verified !== 1) {
    return res.status(403).json({
      error: "Confirma tu correo antes de entrar. Revisa tu bandeja.",
      needsVerification: true,
    });
  }

  trackUserIp(row.id, req); // actualiza IP y país (asíncrono)
  notifyNewLogin(row, req); // alerta por correo si la IP cambió (background)
  if (row.is_admin === 1) broadcastAdminOnline(row.id);
  res.json({ token: signToken(row), user: publicUser(row) });
}));

/* Aviso a todos los usuarios cuando el admin se conecta: mensaje de sistema
 * en el chat grupal ("👑 El administrador se ha conectado").
 * Se elimina solo después de 1 hora para no saturar el chat. */
async function broadcastAdminOnline(adminId) {
  try {
    await db.run(
      `INSERT INTO community_comments (user_id, text, msg_type, expires_at)
       VALUES (?, ?, 'system', datetime('now', '+1 hour'))`
    , adminId, "👑 El administrador se ha conectado");
  } catch (e) { /* no bloquea el login */ }
}

/* ============ SEGURIDAD DE CUENTA: código temporal y cambio de contraseña ============
 * REGLAS (pedido de Georges):
 * 1. 3 contraseñas incorrectas → cuenta desactivada 48h (ver /login arriba).
 * 2. Tras el 2do fallo, el login ofrece "¿Olvidaste tu contraseña?":
 *    envía un código de 10 SEGUNDOS al correo; se entra con usuario + código.
 * 3. Con el código temporal, la ÚNICA opción es cambiar la contraseña
 *    (el token lleva must_change_password; requireAuth bloquea lo demás).
 * 4. 3 cambios de contraseña en 7 días → cuenta deshabilitada 15 días.
 * 5. Al deshabilitar, el RV se pierde (saldo = 0). */

/* Genera un código numérico de 6 dígitos. */
function newResetCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/* POST /api/auth/forgot-password { email }
 * Envía un código temporal de 10 SEGUNDOS al correo del usuario.
 * Rate limit: 3 por hora por IP (evita spam de correos). */
router.post("/forgot-password", rateLimit({
  max: 3, windowMs: 60 * 60 * 1000,
  message: "Demasiadas solicitudes. Espera una hora.",
  keyFn: () => "forgot",
}), ah(async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email || !email.includes("@"))
    return res.status(400).json({ error: "Correo inválido" });
  const row = await db.get("SELECT id, name, email, banned FROM users WHERE email = ?", email);
  // Respuesta genérica para no revelar qué correos existen... pero necesitamos
  // el código solo si existe. Si no existe, respondemos ok de todos modos.
  if (row && row.banned !== 1) {
    // Invalida códigos anteriores sin usar.
    await db.run("UPDATE password_reset_codes SET used = 1 WHERE user_id = ? AND used = 0", row.id);
    const code = newResetCode();
    await db.run(
      "INSERT INTO password_reset_codes (user_id, code, expires_at) VALUES (?, ?, datetime('now', '+10 seconds'))"
    , row.id, code);
    // Envía el código por correo (background, no bloquea).
    const { sendEmail } = require("../email");
    const html =
      `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;">` +
      `<h2>🔑 Tu código temporal</h2>` +
      `<p>Hola ${String(row.name || "").replace(/[<>&"]/g, "")},</p>` +
      `<p>Tu código para entrar es:</p>` +
      `<div style="font-size:2.5rem;font-weight:800;letter-spacing:8px;text-align:center;` +
      `background:#faf6f1;border-radius:12px;padding:20px;margin:16px 0;">${code}</div>` +
      `<p><b>⏳ Vence en 10 segundos.</b> Úsalo rápido.</p>` +
      `<p style="color:#a33;">Si no fuiste tú, ignora este correo y cambia tu contraseña.</p></div>`;
    sendEmail({ to: row.email, subject: "🔑 Tu código temporal Reaviva (10 segundos)", html }).catch(() => {});
    console.log(`[seguridad] código temporal enviado a ${email}`);
  }
  // Siempre responde ok (no revela si el correo existe).
  res.json({ ok: true, message: "Si el correo existe, te enviamos un código de 10 segundos." });
}));

/* POST /api/auth/login-with-code { email, code }
 * Entra con el código temporal de 10 segundos. Devuelve un token en modo
 * "solo cambiar contraseña" (mustChangePassword: true). */
router.post("/login-with-code", loginLimiter, ah(async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const code = String(req.body?.code || "").trim();
  if (!email || !code) return res.status(400).json({ error: "Correo y código requeridos" });

  const row = await db.get("SELECT * FROM users WHERE email = ?", email);
  if (!row) return res.status(401).json({ error: "Código inválido o vencido" });
  if (row.banned === 1)
    return res.status(401).json({ error: "Cuenta suspendida permanentemente." });

  const rec = await db.get(
    `SELECT * FROM password_reset_codes
     WHERE user_id = ? AND code = ? AND used = 0 AND expires_at > datetime('now')
     ORDER BY id DESC LIMIT 1`
  , row.id, code);
  if (!rec) return res.status(401).json({ error: "Código inválido o vencido ⏳" });

  await db.run("UPDATE password_reset_codes SET used = 1 WHERE id = ?", rec.id);
  // Limpia el bloqueo de 48h: el usuario demostró ser el dueño del correo.
  try {
    await db.run("UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?", row.id);
  } catch (e) {}
  clearFailedLogins(getClientIp(req));

  const token = signToken(row, { mustChangePassword: true });
  res.json({
    token,
    user: publicUser(row),
    mustChangePassword: true,
    message: "Entra y cambia tu contraseña ahora 🔑",
  });
}));

/* POST /api/auth/change-password { newPassword, currentPassword? }
 * Cambia la contraseña. En modo mustChangePassword no pide la actual
 * (ya se verificó con el código temporal).
 * REGLA: 3 cambios en 7 días → cuenta deshabilitada 15 días + pierde su RV. */
router.post("/change-password", requireAuth, ah(async (req, res) => {
  const newPassword = String(req.body?.newPassword || req.body?.new_password || "");
  if (!isStrongPassword(newPassword))
    return res.status(400).json({ error: STRONG_PW_MSG });

  const userId = req.user.id;
  // Si NO viene del código temporal, debe confirmar la contraseña actual.
  if (!req.mustChangePassword) {
    const current = String(req.body?.currentPassword || req.body?.current_password || "");
    const full = await db.get("SELECT password_hash FROM users WHERE id = ?", userId);
    if (!full || !bcrypt.compareSync(current, full.password_hash))
      return res.status(401).json({ error: "Tu contraseña actual es incorrecta" });
  }

  // Límite: 3 cambios en 7 días → deshabilitar 15 días + pierde el RV.
  const recent = (await db.get(
    `SELECT COUNT(*) AS n FROM password_changes
     WHERE user_id = ? AND changed_at > datetime('now', '-7 days')`
  , userId)).n;
  if (recent >= 2) {
    // Este sería el 3er cambio en 7 días: deshabilitar.
    const rvRow = await db.get("SELECT credits FROM users WHERE id = ?", userId);
    const lostRv = rvRow ? rvRow.credits || 0 : 0;
    await db.run(
      `UPDATE users SET disabled_until = datetime('now', '+15 days'),
        credits = 0, failed_logins = 0, locked_until = NULL WHERE id = ?`
    , userId);
    await db.run("INSERT INTO password_changes (user_id) VALUES (?)", userId);
    console.warn(`[seguridad] cuenta deshabilitada 15 días por 3 cambios en 7 días: user ${userId} (perdió ${lostRv} RV)`);
    return res.status(403).json({
      error: "Cuenta deshabilitada por 15 días por seguridad. Tu saldo RV se perdió.",
      disabled: true,
      lostRv,
    });
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  await db.run("UPDATE users SET password_hash = ? WHERE id = ?", hash, userId);
  await db.run("INSERT INTO password_changes (user_id) VALUES (?)", userId);
  // Al cambiar la contraseña se limpian bloqueos y el modo temporal.
  try {
    await db.run("UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?", userId);
  } catch (e) {}
  // Invalida códigos temporales pendientes.
  try {
    await db.run("UPDATE password_reset_codes SET used = 1 WHERE user_id = ? AND used = 0", userId);
  } catch (e) {}
  res.json({ ok: true, message: "Contraseña actualizada ✅" });
}));

/* POST /api/auth/admin-login  { code }
 * Code-based admin access. Requires ADMIN_CODE env var to be set.
 * Creates the admin user on first use (email admin@reavivaapp.com). */
router.post("/admin-login", loginLimiter, ah(async (req, res) => {
  const adminCode = process.env.ADMIN_CODE;
  if (!adminCode)
    return res.status(503).json({ error: "Acceso de administrador no configurado" });

  const code = String(req.body?.code || "").trim();
  if (!code || code !== adminCode)
    return res.status(401).json({ error: "Código incorrecto" });

  const ADMIN_EMAIL = "admin@reavivaapp.com";
  let row = await db.get("SELECT * FROM users WHERE email = ?", ADMIN_EMAIL);
  if (!row) {
    const hash = bcrypt.hashSync("admin-" + Date.now() + "-" + Math.random(), 10);
    const info = await db.run(
        "INSERT INTO users (email, name, password_hash, subscribed, is_admin) VALUES (?, ?, ?, 1, 1)"
      , ADMIN_EMAIL, "Georges", hash);
    row = await db.get("SELECT * FROM users WHERE id = ?", info.lastInsertRowid);
  } else if (row.is_admin !== 1 || row.subscribed !== 1) {
    await db.run("UPDATE users SET is_admin = 1, subscribed = 1 WHERE id = ?", row.id);
    row = await db.get("SELECT * FROM users WHERE id = ?", row.id);
  }
  // El admin no necesita verificación de correo.
  if (row.email_verified !== 1) {
    await db.run("UPDATE users SET email_verified = 1, verification_token = NULL WHERE id = ?", row.id);
    row = await db.get("SELECT * FROM users WHERE id = ?", row.id);
  }

  trackUserIp(row.id, req); // registra IP y país (asíncrono)
  broadcastAdminOnline(row.id);
  res.json({ token: signToken(row), user: publicUser(row) });
}));

/* GET /api/auth/me → devuelve el usuario actual (valida la sesión) */
router.get("/me", requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

/* POST /api/profile/photo  { photo: "data:image/jpeg;base64,..." }
 * Foto de perfil del usuario (máx 2MB). El frontend la redimensiona
 * a 400x400 antes de subirla. Se guarda en users.photo. */
router.post("/profile/photo", requireAuth, ah(async (req, res) => {
  const photo = String(req.body?.photo || "");
  const m = photo.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return res.status(400).json({ error: "Formato de imagen inválido" });
  // ~2.9MB en base64 ≈ 2.1MB binarios
  if (photo.length > 2.9 * 1024 * 1024)
    return res.status(400).json({ error: "La imagen es muy grande (máx 2MB)" });
  /* Magic bytes: el contenido debe ser una imagen real del tipo declarado.
   * JPEG: FF D8 FF · PNG: 89 50 4E 47 · WebP: "RIFF"...."WEBP". */
  try {
    const buf = Buffer.from(m[2].slice(0, 32), "base64");
    const declared = m[1];
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    const isWebp = buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP";
    const valid = (declared === "jpeg" && isJpeg) || (declared === "png" && isPng) || (declared === "webp" && isWebp);
    if (!valid) return res.status(400).json({ error: "El archivo no es una imagen válida" });
  } catch (e) {
    return res.status(400).json({ error: "No se pudo verificar la imagen" });
  }
  await db.run("UPDATE users SET photo = ? WHERE id = ?", photo, req.user.id);
  res.json({ ok: true });
}));

/* POST /api/profile/cover  { cover: "data:image/jpeg;base64,..." }
 * Foto de portada del usuario (máx 3MB). Se guarda en users.cover_photo. */
router.post("/profile/cover", requireAuth, ah(async (req, res) => {
  const cover = String(req.body?.cover || "");
  const m = cover.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return res.status(400).json({ error: "Formato de imagen inválido" });
  if (cover.length > 4 * 1024 * 1024)
    return res.status(400).json({ error: "La imagen es muy grande (máx 3MB)" });
  try {
    const buf = Buffer.from(m[2].slice(0, 32), "base64");
    const declared = m[1];
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    const isWebp = buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP";
    const valid = (declared === "jpeg" && isJpeg) || (declared === "png" && isPng) || (declared === "webp" && isWebp);
    if (!valid) return res.status(400).json({ error: "El archivo no es una imagen válida" });
  } catch (e) {
    return res.status(400).json({ error: "No se pudo verificar la imagen" });
  }
  await db.run("UPDATE users SET cover_photo = ? WHERE id = ?", cover, req.user.id);
  res.json({ ok: true });
}));

/* Actualizar descripción/bio del perfil (mín 10, máx 100 caracteres). */
router.post("/profile/bio", requireAuth, ah(async (req, res) => {
  const bio = String(req.body?.bio || "").trim().slice(0, 100);
  if (bio.length < 10)
    return res.status(400).json({ error: "La descripción debe tener mínimo 10 caracteres" });
  await db.run("UPDATE users SET bio = ? WHERE id = ?", bio, req.user.id);
  res.json({ ok: true, bio });
}));

module.exports = { router, requireAuth, verifyToken };
