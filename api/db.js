/* Reaviva API — SQLite database (node:sqlite, zero-config, file-based) */
"use strict";

const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "reaviva.db");
const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT UNIQUE NOT NULL,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    program_start TEXT,                       -- YYYY-MM-DD, set on first app entry
    subscribed    INTEGER NOT NULL DEFAULT 0, -- 0/1
    paypal_subscription_id TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS progress (
    user_id INTEGER NOT NULL,
    day     INTEGER NOT NULL,
    done_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, day),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS journal (
    user_id INTEGER NOT NULL,
    date    TEXT NOT NULL,        -- YYYY-MM-DD
    mood    TEXT NOT NULL DEFAULT '',
    text    TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, date),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_progress_user ON progress(user_id);
  CREATE INDEX IF NOT EXISTS idx_journal_user  ON journal(user_id);

  -- PayPal subscriptions (source of truth for who paid; keyed by buyer email
  -- because the MVP frontend uses localStorage auth and the PayPal webhook
  -- carries the email in custom_id).
  CREATE TABLE IF NOT EXISTS paypal_subscriptions (
    email           TEXT PRIMARY KEY,
    subscription_id TEXT NOT NULL,
    plan            TEXT,
    status          TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING|ACTIVE|PAST_DUE|CANCELLED
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

/* --- Migration: Oct 2026 — Stripe → PayPal ---
 * Adds paypal_subscription_id to users; drops the old Stripe columns
 * (the Stripe integration was removed: no US SSN → account can't be activated). */
try {
  const cols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
  if (!cols.includes("paypal_subscription_id")) {
    db.exec("ALTER TABLE users ADD COLUMN paypal_subscription_id TEXT");
  }
  for (const c of ["stripe_customer_id", "stripe_subscription_id"]) {
    if (cols.includes(c)) {
      try {
        db.exec(`ALTER TABLE users DROP COLUMN ${c}`);
        console.log(`[db] columna obsoleta eliminada: users.${c}`);
      } catch (e) {
        console.warn(`[db] no se pudo eliminar users.${c}: ${e.message}`);
      }
    }
  }
} catch (e) {
  console.error("[db] migración PayPal:", e.message);
}

/* --- Migration: Oct 2026 — admin access ---
 * Adds is_admin flag to users for the administrator account. */
try {
  const cols2 = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
  if (!cols2.includes("is_admin")) {
    db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0");
    console.log("[db] migración: columna users.is_admin agregada");
  }
} catch (e) {
  console.error("[db] migración is_admin:", e.message);
}

/* --- Migration: Oct 2026 — admin dashboard ---
 * Adds last_seen to users (who is online now), admin_messages table
 * (admin → user messages; user_id NULL = broadcast to all), and
 * next_billing_date + reminder_sent to paypal_subscriptions (for the
 * automatic "your plan expires soon" reminder job). */
try {
  const cols3 = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
  if (!cols3.includes("last_seen")) {
    db.exec("ALTER TABLE users ADD COLUMN last_seen TEXT");
    console.log("[db] migración: columna users.last_seen agregada");
  }
} catch (e) {
  console.error("[db] migración last_seen:", e.message);
}

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER,                 -- NULL = mensaje para todos
      email      TEXT,
      title      TEXT NOT NULL,
      body       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      read_at    TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_admin_messages_user ON admin_messages(user_id);
  `);
  console.log("[db] migración: tabla admin_messages lista");
} catch (e) {
  console.error("[db] migración admin_messages:", e.message);
}

try {
  const cols4 = db.prepare("PRAGMA table_info(paypal_subscriptions)").all().map((c) => c.name);
  if (!cols4.includes("next_billing_date")) {
    db.exec("ALTER TABLE paypal_subscriptions ADD COLUMN next_billing_date TEXT");
    console.log("[db] migración: columna paypal_subscriptions.next_billing_date agregada");
  }
  if (!cols4.includes("reminder_sent")) {
    db.exec("ALTER TABLE paypal_subscriptions ADD COLUMN reminder_sent INTEGER NOT NULL DEFAULT 0");
    console.log("[db] migración: columna paypal_subscriptions.reminder_sent agregada");
  }
} catch (e) {
  console.error("[db] migración paypal_subscriptions:", e.message);
}

/* --- Migration: Oct 2026 — IP y país de usuarios ---
 * Registra la dirección IP y el país de cada usuario para saber
 * desde qué país se conectan. El lookup de país se hace de forma
 * asíncrona vía ip-api.com al registrarse / iniciar sesión. */
try {
  const cols5 = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
  for (const c of ["ip", "country", "country_code"]) {
    if (!cols5.includes(c)) {
      db.exec(`ALTER TABLE users ADD COLUMN ${c} TEXT`);
      console.log(`[db] migración: columna users.${c} agregada`);
    }
  }
} catch (e) {
  console.error("[db] migración ip/país:", e.message);
}

/* --- Migration: Oct 2026 — comunidad anónima ---
 * community_comments: comentarios públicos de la comunidad.
 * Los usuarios son anónimos entre sí; solo el admin ve quién escribió
 * cada comentario (user_id). hidden=1 → oculto por el admin. */
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS community_comments (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL,
      text       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      hidden     INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_community_user ON community_comments(user_id);
    CREATE INDEX IF NOT EXISTS idx_community_created ON community_comments(created_at);
  `);
  console.log("[db] migración: tabla community_comments lista");
} catch (e) {
  console.error("[db] migración community_comments:", e.message);
}

/* --- Migration: Oct 2026 — verificación de correo ---
 * email_verified: 0/1 — el usuario debe confirmar su correo con el link
 * que recibe al registrarse antes de poder entrar.
 * verification_token: token único del link de confirmación (se limpia
 * al verificar). Los tokens no expiran (documentado). */
try {
  const cols6 = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
  if (!cols6.includes("email_verified")) {
    db.exec("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0");
    console.log("[db] migración: columna users.email_verified agregada");
  }
  if (!cols6.includes("verification_token")) {
    db.exec("ALTER TABLE users ADD COLUMN verification_token TEXT");
    console.log("[db] migración: columna users.verification_token agregada");
  }
} catch (e) {
  console.error("[db] migración email_verified:", e.message);
}

/* --- Migration: Oct 2026 — foto de perfil y límite de chat ---
 * users.photo: foto de perfil del usuario (data URL base64, máx ~2MB).
 *   La IP NUNCA se expone a no-admins; el país sí es visible para el
 *   propio usuario en su perfil.
 * chat_usage: segundos de chat usados por día por usuario (límite
 *   freemium de 2 horas diarias en la comunidad). */
try {
  const cols7 = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
  if (!cols7.includes("photo")) {
    db.exec("ALTER TABLE users ADD COLUMN photo TEXT");
    console.log("[db] migración: columna users.photo agregada");
  }
} catch (e) {
  console.error("[db] migración photo:", e.message);
}

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_usage (
      user_id        INTEGER NOT NULL,
      date           TEXT NOT NULL,              -- YYYY-MM-DD (UTC)
      seconds_used   INTEGER NOT NULL DEFAULT 0,
      last_heartbeat INTEGER,                   -- unix timestamp del último heartbeat
      PRIMARY KEY (user_id, date),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  console.log("[db] migración: tabla chat_usage lista");
} catch (e) {
  console.error("[db] migración chat_usage:", e.message);
}

/* --- Migración: temas temporales del chat (solo con plan) ---
 * chat_topics: cada tema dura 2 horas y luego expira/desaparece.
 * Los temas expirados se filtran en el GET (sin cron). */
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_topics (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL,
      name       TEXT NOT NULL,   -- nombre del tema, sin el símbolo #
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,   -- created_at + 2 horas
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_topics_expires ON chat_topics(expires_at);
  `);
  console.log("[db] migración: tabla chat_topics lista");
} catch (e) {
  console.error("[db] migración chat_topics:", e.message);
}

/* --- Migración: fotos temporales del chat (30 segundos) ---
 * community_comments.msg_type: 'text' | 'photo'.
 * community_comments.photo_data: imagen base64 (data URL) para msg_type='photo'.
 * Las fotos se "eliminan" a los 30 segundos: el GET deja de devolver los
 * datos y muestra "📷 Foto eliminada". */
try {
  const cols8 = db.prepare("PRAGMA table_info(community_comments)").all().map((c) => c.name);
  if (!cols8.includes("msg_type")) {
    db.exec("ALTER TABLE community_comments ADD COLUMN msg_type TEXT NOT NULL DEFAULT 'text'");
    console.log("[db] migración: columna community_comments.msg_type agregada");
  }
  if (!cols8.includes("photo_data")) {
    db.exec("ALTER TABLE community_comments ADD COLUMN photo_data TEXT");
    console.log("[db] migración: columna community_comments.photo_data agregada");
  }
} catch (e) {
  console.error("[db] migración fotos temporales:", e.message);
}

module.exports = db;
