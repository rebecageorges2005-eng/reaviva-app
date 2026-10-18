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
      expires_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_community_user ON community_comments(user_id);
    CREATE INDEX IF NOT EXISTS idx_community_created ON community_comments(created_at);
  `);
  console.log("[db] migración: tabla community_comments lista");
} catch (e) {
  console.error("[db] migración community_comments:", e.message);
}

/* --- Migration: expiración de mensajes del chat grupal por plan ---
 * expires_at: fecha UTC 'YYYY-MM-DD HH:MM:SS' en que el mensaje se
 * elimina automáticamente. Mensual → 5h, anual/admin → 24h,
 * gratuito → 28h. Las fotos temporales usan su propia lógica de
 * 30 segundos (expires_at = NULL para ellas). */
try {
  const colsCC = db.prepare("PRAGMA table_info(community_comments)").all().map((c) => c.name);
  if (!colsCC.includes("expires_at")) {
    db.exec("ALTER TABLE community_comments ADD COLUMN expires_at TEXT");
    // Mensajes existentes: vencen 28h después de su creación
    // (política del plan gratuito).
    db.exec(
      "UPDATE community_comments SET expires_at = datetime(created_at, '+28 hours') WHERE expires_at IS NULL"
    );
    console.log("[db] migración: community_comments.expires_at agregada");
  }
} catch (e) {
  console.error("[db] migración expires_at:", e.message);
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

/* --- Migración: tipo de plan + mensajes privados (DM) ---
 * users.plan_type: 'monthly' | 'yearly' | NULL (lo fija el webhook de PayPal
 * al activarse/cancelarse la suscripción; ver routes/billing.js).
 * private_messages: mensajes privados entre usuarios con plan anual.
 * Cada mensaje expira a las 48 horas (expires_at) y se limpia al leer. */
try {
  const cols9 = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
  if (!cols9.includes("plan_type")) {
    db.exec("ALTER TABLE users ADD COLUMN plan_type TEXT");
    console.log("[db] migración: columna users.plan_type agregada");
  }
  // Relleno para suscriptores existentes según paypal_subscriptions.
  try {
    db.exec(`
      UPDATE users SET plan_type = 'yearly'
      WHERE subscribed = 1 AND plan_type IS NULL AND lower(email) IN (
        SELECT lower(email) FROM paypal_subscriptions WHERE status = 'ACTIVE'
          AND (lower(plan) IN ('yearly','annual','anual') OR plan LIKE 'P-28J%')
      )`);
    db.exec(`
      UPDATE users SET plan_type = 'monthly'
      WHERE subscribed = 1 AND plan_type IS NULL`);
  } catch (e2) {
    console.error("[db] migración plan_type (relleno):", e2.message);
  }
} catch (e) {
  console.error("[db] migración plan_type:", e.message);
}

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS private_messages (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      from_user_id INTEGER NOT NULL,
      to_user_id   INTEGER NOT NULL,
      text         TEXT NOT NULL,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at   TEXT NOT NULL,   -- created_at + 48 horas
      read_at      TEXT,            -- NULL = no leído
      FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_dm_pair ON private_messages(from_user_id, to_user_id);
    CREATE INDEX IF NOT EXISTS idx_dm_to ON private_messages(to_user_id, read_at);
  `);
  console.log("[db] migración: tabla private_messages lista");
} catch (e) {
  console.error("[db] migración private_messages:", e.message);
}

module.exports = db;

/* --- Sistema anti-spam: strikes por compartir correos/teléfonos/redes ---
 * users.chat_strikes: intentos bloqueados hoy (se reinicia cada día).
 * users.chat_strikes_date: fecha (YYYY-MM-DD) del último strike.
 * users.chat_muted: 1 = no puede escribir en el chat (solo lectura).
 * users.chat_mutes: veces que fue muteado (reincidentes).
 * chat_violations: registro de intentos bloqueados para revisión del admin. */
try {
  const cols10 = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
  const add = (col, def) => {
    if (!cols10.includes(col)) {
      db.exec(`ALTER TABLE users ADD COLUMN ${col} ${def}`);
      console.log(`[db] migración: columna users.${col} agregada`);
      cols10.push(col);
    }
  };
  add("chat_strikes", "INTEGER NOT NULL DEFAULT 0");
  add("chat_strikes_date", "TEXT");
  add("chat_muted", "INTEGER NOT NULL DEFAULT 0");
  add("chat_mutes", "INTEGER NOT NULL DEFAULT 0");
  /* Bono de bienvenida RV: guarda el subscription_id que ya recibió el bono
   * para no darlo dos veces (idempotente). */
  add("rv_bonus_for", "TEXT");
} catch (e) {
  console.error("[db] migración chat_strikes:", e.message);
}

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_violations (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id        INTEGER NOT NULL,
      attempted_text TEXT NOT NULL,
      violation_type TEXT NOT NULL,   -- correo | telefono | red social
      detail         TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_viol_user ON chat_violations(user_id, created_at);
  `);
  console.log("[db] migración: tabla chat_violations lista");
} catch (e) {
  console.error("[db] migración chat_violations:", e.message);
}

/* --- Migración: sistema de créditos para mensajes promocionales ---
 * users.credits: saldo de créditos (1 crédito = 1 mensaje promocional
 * con enlaces/redes sociales/publicidad en el chat grupal).
 * credit_purchases: historial de compras de paquetes vía PayPal Orders.
 * credit_spending: registro de créditos gastados (auditoría).
 * community_comments.is_promo: marca mensajes publicados con crédito (📢). */
try {
  const cols11 = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
  if (!cols11.includes("credits")) {
    db.exec("ALTER TABLE users ADD COLUMN credits INTEGER NOT NULL DEFAULT 0");
    console.log("[db] migración: columna users.credits agregada");
  }
} catch (e) {
  console.error("[db] migración credits:", e.message);
}

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS credit_purchases (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id        INTEGER NOT NULL,
      pack_credits   INTEGER NOT NULL,
      amount_usd     TEXT NOT NULL,
      paypal_order_id TEXT NOT NULL UNIQUE,
      status         TEXT NOT NULL DEFAULT 'completed',
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_cp_user ON credit_purchases(user_id, created_at);
    CREATE TABLE IF NOT EXISTS credit_spending (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL,
      credits_used INTEGER NOT NULL DEFAULT 1,
      reason       TEXT NOT NULL DEFAULT 'promo_message',
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_cs_user ON credit_spending(user_id, created_at);
  `);
  console.log("[db] migración: tablas credit_purchases y credit_spending listas");
} catch (e) {
  console.error("[db] migración credit_purchases:", e.message);
}

try {
  const colsC = db.prepare("PRAGMA table_info(community_comments)").all().map((c) => c.name);
  if (!colsC.includes("is_promo")) {
    db.exec("ALTER TABLE community_comments ADD COLUMN is_promo INTEGER NOT NULL DEFAULT 0");
    console.log("[db] migración: columna community_comments.is_promo agregada");
  }
} catch (e) {
  console.error("[db] migración is_promo:", e.message);
}

/* --- Migración: bloque de imágenes promocionales ---
 * users.img_block_remaining: envíos de imagen restantes del bloque actual.
 * Cada bloque = 10 RV por 8 envíos de imágenes promocionales. */
try {
  const cols12 = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
  if (!cols12.includes("img_block_remaining")) {
    db.exec("ALTER TABLE users ADD COLUMN img_block_remaining INTEGER NOT NULL DEFAULT 0");
    console.log("[db] migración: columna users.img_block_remaining agregada");
  }
} catch (e) {
  console.error("[db] migración img_block_remaining:", e.message);
}

/* --- Migración: republicación automática de links pagados con RV ---
 * scheduled_reposts: cuando un usuario con plan publica un link pagado
 * con RV, el sistema lo republica 2 veces más (2 y 4 horas después).
 * expires_at se guarda ya desplazado por el mismo intervalo para que el
 * repost expire igual que un mensaje normal.
 * community_comments.is_repost: marca las republicaciones (🔁). */
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_reposts (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL,
      text         TEXT NOT NULL,
      msg_type     TEXT NOT NULL DEFAULT 'text',
      photo_data   TEXT,
      expires_at   TEXT,
      scheduled_at TEXT NOT NULL,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sr_due ON scheduled_reposts(scheduled_at);
  `);
  const colsE = db.prepare("PRAGMA table_info(scheduled_reposts)").all().map((c) => c.name);
  if (!colsE.includes("expires_at")) {
    db.exec("ALTER TABLE scheduled_reposts ADD COLUMN expires_at TEXT");
    console.log("[db] migración: columna scheduled_reposts.expires_at agregada");
  }
  console.log("[db] migración: tabla scheduled_reposts lista");
} catch (e) {
  console.error("[db] migración scheduled_reposts:", e.message);
}

try {
  const colsD = db.prepare("PRAGMA table_info(community_comments)").all().map((c) => c.name);
  if (!colsD.includes("is_repost")) {
    db.exec("ALTER TABLE community_comments ADD COLUMN is_repost INTEGER NOT NULL DEFAULT 0");
    console.log("[db] migración: columna community_comments.is_repost agregada");
  }
} catch (e) {
  console.error("[db] migración is_repost:", e.message);
}

/* --- Migración: límite diario de conversaciones privadas (DM) ---
 * dm_daily_partners: usuarios únicos contactados por día (UTC).
 * Anual: 90 conversaciones/día · mensual: 15/día. Las filas viejas
 * (más de 2 días) se limpian al enviar. */
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dm_daily_partners (
      user_id    INTEGER NOT NULL,
      partner_id INTEGER NOT NULL,
      day        TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, partner_id, day)
    );
    CREATE INDEX IF NOT EXISTS idx_ddp_user_day ON dm_daily_partners(user_id, day);
  `);
  console.log("[db] migración: tabla dm_daily_partners lista");
} catch (e) {
  console.error("[db] migración dm_daily_partners:", e.message);
}

/* --- Migración: dominios verificados para enlaces promocionales 🔒 ---
 * verified_domains: solo se permiten links de páginas verificadas
 * cuando un usuario paga RV para compartir un enlace (anti-hackers).
 * El admin gestiona la lista desde el panel. Se precarga con
 * dominios comunes y seguros. */
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS verified_domains (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      domain      TEXT UNIQUE NOT NULL,
      approved_by TEXT,
      approved_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const n = db.prepare("SELECT COUNT(*) AS n FROM verified_domains").get().n;
  if (n === 0) {
    const semilla = [
      "reavivaapp.com",
      "youtube.com", "youtu.be",
      "instagram.com",
      "tiktok.com",
      "facebook.com", "fb.com",
      "twitter.com", "x.com",
      "whatsapp.com",
      "telegram.me", "t.me",
      "amazon.com", "amazon.com.mx", "amazon.es",
      "mercadolibre.com", "mercadolibre.com.mx", "mercadolibre.com.co", "mercadolibre.com.ar",
      "ebay.com",
      "paypal.com",
      "hotmart.com",
      "google.com",
    ];
    const ins = db.prepare(
      "INSERT OR IGNORE INTO verified_domains (domain, approved_by) VALUES (?, 'sistema')"
    );
    for (const d of semilla) ins.run(d);
    console.log("[db] migración: tabla verified_domains creada con", semilla.length, "dominios semilla");
  } else {
    console.log("[db] migración: tabla verified_domains lista");
  }
} catch (e) {
  console.error("[db] migración verified_domains:", e.message);
}

/* --- Migración: usuarios en línea en el chat grupal 🟢🔴 ---
 * online_users: marca de presencia con timestamp (segundos Unix).
 * Se actualiza en cada heartbeat del chat (cada 60s con la pestaña abierta)
 * y al cargar/publicar en la comunidad. En línea = last_seen < 2 minutos.
 * Filas viejas (>1 hora) se limpian al consultar. */
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS online_users (
      user_id   INTEGER PRIMARY KEY,
      last_seen INTEGER NOT NULL
    );
  `);
  console.log("[db] migración: tabla online_users lista");
} catch (e) {
  console.error("[db] migración online_users:", e.message);
}
