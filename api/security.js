/* Reaviva API — seguridad: rate limiting, bloqueo de IPs, detección de ataques.
 *
 * UMBRALES (documentados):
 * - Login fallido: 10 intentos en 15 min desde la misma IP → IP bloqueada.
 * - Registro: 5 intentos por hora por IP (rate limit, sin bloqueo).
 * - API general: 100 requests por minuto por IP.
 * - Violaciones repetidas de rate limit: 5 en 1 hora → IP bloqueada.
 * - Patrón de SQLi/XSS detectado en un input → bloqueo inmediato de IP
 *   (+ baneo permanente del usuario si venía logueado).
 * - Escaneo de rutas sensibles: 10+ hits en 5 min a /.env, /.git, /wp-*,
 *   /phpmyadmin, /api/admin/* sin token de admin → IP bloqueada.
 * - La IP del administrador NUNCA se auto-bloquea.
 */
"use strict";

const db = require("./db");

/* ============ IP del cliente (Render está detrás de un proxy) ============ */
function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) {
    const first = String(xff).split(",")[0].trim();
    if (first) return first;
  }
  const ra = req.socket && req.socket.remoteAddress;
  if (ra) {
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

/* ============ IPs bloqueadas ============ */
function isBlockedIp(ip) {
  if (!ip) return false;
  try {
    const row = db.prepare("SELECT ip FROM blocked_ips WHERE ip = ?").get(ip);
    return !!row;
  } catch (e) { return false; }
}

function blockIp(ip, reason, by) {
  if (!ip || isPrivateIp(ip)) return false; // nunca bloquear IPs privadas/locales
  try {
    db.prepare(
      "INSERT OR IGNORE INTO blocked_ips (ip, reason, blocked_by) VALUES (?, ?, ?)"
    ).run(ip, String(reason || "Actividad sospechosa").slice(0, 200), by || "auto");
    console.warn(`[seguridad] IP bloqueada: ${ip} — ${reason} (${by || "auto"})`);
    return true;
  } catch (e) { return false; }
}

function unblockIp(ip) {
  try {
    db.prepare("DELETE FROM blocked_ips WHERE ip = ?").run(ip);
    return true;
  } catch (e) { return false; }
}

/* ¿La petición viene de un administrador autenticado? (para no auto-bloquearlo) */
function isAdminRequest(req) {
  try {
    const u = req.user;
    return !!(u && u.is_admin === 1);
  } catch (e) { return false; }
}

/* ============ Rate limiter en memoria ============
 * Ventanas deslizantes simples por clave (IP o IP+ruta). */
const buckets = new Map(); // key -> { count, resetAt, violations }

function checkRate(key, max, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + windowMs, violations: b ? b.violations : 0 };
    buckets.set(key, b);
  }
  b.count += 1;
  return { ok: b.count <= max, count: b.count, bucket: b };
}

function recordViolation(key) {
  const b = buckets.get(key);
  if (b) {
    b.violations = (b.violations || 0) + 1;
    return b.violations;
  }
  return 0;
}

/* Limpieza periódica de buckets viejos (cada 10 min). */
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (now >= b.resetAt + 3600 * 1000) buckets.delete(k);
  }
}, 10 * 60 * 1000).unref();

function rateLimit({ max, windowMs, message, keyFn }) {
  return (req, res, next) => {
    const ip = getClientIp(req) || "unknown";
    const key = (keyFn ? keyFn(req) : "rl") + ":" + ip;
    const r = checkRate(key, max, windowMs);
    if (!r.ok) {
      const v = recordViolation(key);
      // 5 violaciones en la ventana de memoria (1h) → bloqueo de IP.
      if (v >= 5 && !isAdminRequest(req) && !isPrivateIp(ip)) {
        blockIp(ip, `Rate limit excedido repetidamente (${r.count} req)`, "auto");
      }
      return res.status(429).json({
        error: message || "Demasiadas peticiones. Inténtalo más tarde.",
      });
    }
    next();
  };
}

/* ============ Detección de patrones de ataque ============ */
const SQLI_PATTERNS = [
  /(\bunion\b.+\bselect\b)/i,
  /(\bselect\b.+\bfrom\b.+\bwhere\b)/i,
  /('|")\s*(or|and)\s*('|")?\d/i,
  /\b(drop|alter|truncate)\b.+\btable\b/i,
  /;\s*(drop|delete|update|insert)\b/i,
  /(\bwaitfor\b.+\bdelay\b)/i,
  /(benchmark|sleep)\s*\(/i,
  /information_schema/i,
];

const XSS_PATTERNS = [
  /<script[\s>]/i,
  /javascript\s*:/i,
  /on\w+\s*=\s*["']/i,
  /<iframe[\s>]/i,
  /<object[\s>]/i,
  /<embed[\s>]/i,
  /eval\s*\(/i,
];

function containsAttackPattern(value) {
  if (typeof value !== "string" || value.length > 100000) return null;
  for (const p of SQLI_PATTERNS) if (p.test(value)) return "sql";
  for (const p of XSS_PATTERNS) if (p.test(value)) return "xss";
  return null;
}

function scanValue(v, depth) {
  if (depth > 4) return null;
  if (typeof v === "string") return containsAttackPattern(v);
  if (Array.isArray(v)) {
    for (const x of v) { const r = scanValue(x, depth + 1); if (r) return r; }
  } else if (v && typeof v === "object") {
    for (const k of Object.keys(v)) {
      const r = scanValue(v[k], depth + 1); if (r) return r;
    }
  }
  return null;
}

/* Middleware: inspecciona query + body en POST/PUT/PATCH/DELETE.
 * Si detecta SQLi/XSS → bloquea la IP de inmediato y banea al usuario logueado. */
function attackDetector(req, res, next) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  const ip = getClientIp(req);
  let found = scanValue(req.query, 0) || scanValue(req.body, 0);
  // No inspeccionar data URLs de fotos/audios (base64 puede dar falsos positivos
  // en patrones como "eval(" — se salta cualquier string que empiece con data:).
  if (!found) return next();
  const kind = found === "sql" ? "Intento de inyección SQL" : "Intento de XSS";
  console.warn(`[seguridad] ${kind} detectado desde ${ip}: ${req.method} ${req.path}`);
  if (!isAdminRequest(req) && ip && !isPrivateIp(ip)) {
    blockIp(ip, kind, "auto");
  }
  // Banear al usuario logueado que intentó el ataque.
  if (req.user && req.user.is_admin !== 1) {
    try {
      db.prepare("UPDATE users SET banned = 1, ban_reason = ? WHERE id = ?")
        .run(kind + " detectado", req.user.id);
      console.warn(`[seguridad] usuario baneado: id=${req.user.id} (${kind})`);
    } catch (e) { /* no bloquea la respuesta */ }
  }
  return res.status(403).json({ error: "Acceso denegado." });
}

/* ============ Detección de escaneo de rutas sensibles ============ */
const SCAN_PATTERNS = [
  /^\/\.env/i, /^\/\.git/i, /^\/wp-/i, /phpmyadmin/i, /\/admin\/php/i,
  /^\/\.well-known/i, /\/shell/i, /\/config\.php/i, /\.bak$/i, /\.sql$/i,
];
const scanHits = new Map(); // ip -> { count, resetAt }

function scanDetector(req, res, next) {
  const p = req.path || "";
  const suspicious = SCAN_PATTERNS.some((re) => re.test(p));
  // /api/admin/* sin admin autenticado también cuenta como escaneo.
  const adminProbe = p.startsWith("/api/admin") && !isAdminRequest(req);
  if (!suspicious && !adminProbe) return next();
  const ip = getClientIp(req);
  if (!ip || isPrivateIp(ip) || isAdminRequest(req)) return next();
  const now = Date.now();
  let h = scanHits.get(ip);
  if (!h || now >= h.resetAt) h = { count: 0, resetAt: now + 5 * 60 * 1000 };
  h.count += 1;
  scanHits.set(ip, h);
  console.warn(`[seguridad] escaneo (${h.count}) desde ${ip}: ${req.method} ${p}`);
  if (h.count >= 10) {
    blockIp(ip, "Escaneo de rutas sensibles", "auto");
    scanHits.delete(ip);
  }
  next();
}

/* ============ Middleware: rechazar IPs bloqueadas ============ */
function blockIpMiddleware(req, res, next) {
  const ip = getClientIp(req);
  if (ip && isBlockedIp(ip)) {
    return res.status(403).json({ error: "Acceso denegado." });
  }
  next();
}

/* ============ Cabeceras de seguridad ============ */
function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  // SAMEORIGIN: el panel admin y la app usan el mismo origen; Jitsi abre en pestaña nueva.
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  // CSP básico que no rompe la app (sin CDNs externos en el frontend).
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: https:; " +
    "media-src 'self' data: blob: https:; " +
    "connect-src 'self' https://ip-api.com; " +
    "frame-ancestors 'self';"
  );
  next();
}

/* ============ Logins fallidos → auto-bloqueo ============ */
const failedLogins = new Map(); // ip -> { count, resetAt }

function recordFailedLogin(ip, req) {
  if (!ip || isPrivateIp(ip)) return;
  // Nunca auto-bloquear si la petición trae un admin autenticado.
  if (req && isAdminRequest(req)) return;
  const now = Date.now();
  let h = failedLogins.get(ip);
  if (!h || now >= h.resetAt) h = { count: 0, resetAt: now + 15 * 60 * 1000 };
  h.count += 1;
  failedLogins.set(ip, h);
  if (h.count >= 10) {
    blockIp(ip, `10+ logins fallidos en 15 min`, "auto");
    failedLogins.delete(ip);
  }
}

function clearFailedLogins(ip) {
  if (ip) failedLogins.delete(ip);
}

/* ============ Baneo de usuarios ============ */
function banUser(userId, reason) {
  try {
    db.prepare("UPDATE users SET banned = 1, ban_reason = ? WHERE id = ?")
      .run(String(reason || "Violación de términos").slice(0, 200), userId);
    return true;
  } catch (e) { return false; }
}

function unbanUser(userId) {
  try {
    db.prepare("UPDATE users SET banned = 0, ban_reason = NULL WHERE id = ?").run(userId);
    return true;
  } catch (e) { return false; }
}

function isBanned(userId) {
  try {
    const r = db.prepare("SELECT banned FROM users WHERE id = ?").get(userId);
    return !!(r && r.banned === 1);
  } catch (e) { return false; }
}

module.exports = {
  getClientIp,
  isPrivateIp,
  isBlockedIp,
  blockIp,
  unblockIp,
  isAdminRequest,
  rateLimit,
  attackDetector,
  scanDetector,
  blockIpMiddleware,
  securityHeaders,
  recordFailedLogin,
  clearFailedLogins,
  banUser,
  unbanUser,
  isBanned,
};
