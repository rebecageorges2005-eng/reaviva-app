/* Reaviva API — capa de base de datos (dual backend, interfaz async).
 *
 * DECISIÓN DE DISEÑO (migración SQLite local → Turso, oct 2026):
 * ----------------------------------------------------------------
 * El código usaba node:sqlite de forma SÍNCRONA (db.prepare().get()/all()/run()).
 * Turso (@libsql/client) es ASÍNCRONO por naturaleza (I/O de red): no existe
 * forma de hacerlo sincrónico en Node.js sin bloquear el event loop.
 *
 * Por eso se optó por la conversión COMPLETA a async/await:
 *   - db.get(sql, ...args)  → Promise<row|undefined>
 *   - db.all(sql, ...args)  → Promise<row[]>
 *   - db.run(sql, ...args)  → Promise<{lastInsertRowid:number, changes:number}>
 *   - db.exec(sql)          → Promise<void>  (acepta múltiples statements)
 *   - db.ready              → Promise que se resuelve cuando las migraciones
 *                              terminan (server.js la espera antes de listen)
 *   - ah(fn)                → wrapper para handlers de Express 4: convierte
 *                              rechazos async en next(err) para que no cuelguen
 *                              (Express 4 no captura errores async solo).
 *
 * Backend:
 *   - Si existen TURSO_DATABASE_URL y TURSO_AUTH_TOKEN → Turso (nube).
 *   - Si no → node:sqlite con archivo local (desarrollo / fallback).
 *   La interfaz es idéntica en ambos casos; las consultas SQL no cambian
 *   (Turso es compatible con el dialecto SQLite).
 *
 * Notas:
 *   - libsql devuelve lastInsertRowid como BigInt; el wrapper lo convierte
 *     a Number para mantener compatibilidad con el código existente.
 *   - db.exec() divide múltiples statements (respetando strings con ';')
 *     y los ejecuta en batch, porque el protocolo remoto de Turso acepta
 *     un solo statement por execute().
 */
"use strict";

const path = require("path");

const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;
const isTurso = !!(TURSO_URL && TURSO_TOKEN);

let client = null;   // @libsql/client (modo Turso)
let localDb = null;  // node:sqlite DatabaseSync (modo local)

if (isTurso) {
  const { createClient } = require("@libsql/client");
  client = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });
  console.log("[db] backend: Turso (nube)");
} else {
  const { DatabaseSync } = require("node:sqlite");
  const DB_PATH = process.env.DB_PATH || path.join(__dirname, "reaviva.db");
  localDb = new DatabaseSync(DB_PATH);
  console.log("[db] backend: SQLite local (" + DB_PATH + ")");
}

/* Divide un script SQL en statements individuales, respetando
 * strings entre comillas simples/dobles (que pueden contener ';'). */
function splitStatements(sql) {
  const out = [];
  let cur = "", q = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (q) {
      cur += ch;
      if (ch === q) {
        // '' dentro de un string simple es un escape, no el cierre
        if (q === "'" && sql[i + 1] === "'") { cur += sql[++i]; }
        else q = null;
      }
    } else if (ch === "'" || ch === '"') {
      q = ch; cur += ch;
    } else if (ch === ";") {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const toNum = (v) => (typeof v === "bigint" ? Number(v) : v);

async function tGet(sql, args) {
  const r = await client.execute({ sql, args: args || [] });
  return r.rows[0];
}
async function tAll(sql, args) {
  const r = await client.execute({ sql, args: args || [] });
  return r.rows;
}
async function tRun(sql, args) {
  const r = await client.execute({ sql, args: args || [] });
  return { lastInsertRowid: toNum(r.lastInsertRowid), changes: toNum(r.rowsAffected) };
}
async function tExec(sql) {
  const stmts = splitStatements(sql);
  if (stmts.length === 0) return;
  if (stmts.length === 1) {
    await client.execute(stmts[0]);
  } else {
    await client.batch(stmts.map((s) => ({ sql: s, args: [] })));
  }
}

const db = {
  isTurso,
  async get(sql, ...args) {
    if (isTurso) return tGet(sql, args);
    return localDb.prepare(sql).get(...args);
  },
  async all(sql, ...args) {
    if (isTurso) return tAll(sql, args);
    return localDb.prepare(sql).all(...args);
  },
  async run(sql, ...args) {
    if (isTurso) return tRun(sql, args);
    const r = localDb.prepare(sql).run(...args);
    return { lastInsertRowid: toNum(r.lastInsertRowid), changes: toNum(r.changes) };
  },
  async exec(sql) {
    if (isTurso) return tExec(sql);
    localDb.exec(sql);
  },
};

/* Wrapper para handlers async en Express 4: un rechazo se convierte en
 * next(err) en vez de dejar la petición colgada. Uso:
 *   router.get("/x", ah(async (req, res) => { ... })); */
function ah(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/* ---------------- MIGRACIONES ----------------
 * Se ejecutan una vez al arrancar, en orden. Cada bloque conserva su
 * try/catch original: un fallo se registra pero no tumba el servidor. */

async function tableCols(table) {
  const rows = await db.all(`PRAGMA table_info(${table})`);
  return rows.map((c) => c.name);
}

async function migrate() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      email         TEXT UNIQUE NOT NULL,
      name          TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      program_start TEXT,
      subscribed    INTEGER NOT NULL DEFAULT 0,
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
      date    TEXT NOT NULL,
      mood    TEXT NOT NULL DEFAULT '',
      text    TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, date),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_progress_user ON progress(user_id);
    CREATE INDEX IF NOT EXISTS idx_journal_user  ON journal(user_id);

    CREATE TABLE IF NOT EXISTS paypal_subscriptions (
      email           TEXT PRIMARY KEY,
      subscription_id TEXT NOT NULL,
      plan            TEXT,
      status          TEXT NOT NULL DEFAULT 'PENDING',
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  /* Migración: Stripe → PayPal */
  try {
    const cols = await tableCols("users");
    if (!cols.includes("paypal_subscription_id")) {
      await db.exec("ALTER TABLE users ADD COLUMN paypal_subscription_id TEXT");
    }
    for (const c of ["stripe_customer_id", "stripe_subscription_id"]) {
      if (cols.includes(c)) {
        try {
          await db.exec(`ALTER TABLE users DROP COLUMN ${c}`);
          console.log(`[db] columna obsoleta eliminada: users.${c}`);
        } catch (e) {
          console.warn(`[db] no se pudo eliminar users.${c}: ${e.message}`);
        }
      }
    }
  } catch (e) {
    console.error("[db] migración PayPal:", e.message);
  }

  /* Migración: admin access */
  try {
    const cols2 = await tableCols("users");
    if (!cols2.includes("is_admin")) {
      await db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0");
      console.log("[db] migración: columna users.is_admin agregada");
    }
  } catch (e) {
    console.error("[db] migración is_admin:", e.message);
  }

  /* Migración: admin dashboard */
  try {
    const cols3 = await tableCols("users");
    if (!cols3.includes("last_seen")) {
      await db.exec("ALTER TABLE users ADD COLUMN last_seen TEXT");
      console.log("[db] migración: columna users.last_seen agregada");
    }
  } catch (e) {
    console.error("[db] migración last_seen:", e.message);
  }

  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS admin_messages (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER,
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
    const cols4 = await tableCols("paypal_subscriptions");
    if (!cols4.includes("next_billing_date")) {
      await db.exec("ALTER TABLE paypal_subscriptions ADD COLUMN next_billing_date TEXT");
      console.log("[db] migración: columna paypal_subscriptions.next_billing_date agregada");
    }
    if (!cols4.includes("reminder_sent")) {
      await db.exec("ALTER TABLE paypal_subscriptions ADD COLUMN reminder_sent INTEGER NOT NULL DEFAULT 0");
      console.log("[db] migración: columna paypal_subscriptions.reminder_sent agregada");
    }
    if (!cols4.includes("grace_until")) {
      await db.exec("ALTER TABLE paypal_subscriptions ADD COLUMN grace_until TEXT");
      console.log("[db] migración: columna paypal_subscriptions.grace_until agregada");
    }
  } catch (e) {
    console.error("[db] migración paypal_subscriptions:", e.message);
  }

  /* Migración: IP y país de usuarios */
  try {
    const cols5 = await tableCols("users");
    for (const c of ["ip", "country", "country_code"]) {
      if (!cols5.includes(c)) {
        await db.exec(`ALTER TABLE users ADD COLUMN ${c} TEXT`);
        console.log(`[db] migración: columna users.${c} agregada`);
      }
    }
  } catch (e) {
    console.error("[db] migración ip/país:", e.message);
  }

  /* Migración: comunidad anónima */
  try {
    await db.exec(`
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

  /* Migración: expiración de mensajes del chat grupal por plan */
  try {
    const colsCC = await tableCols("community_comments");
    if (!colsCC.includes("expires_at")) {
      await db.exec("ALTER TABLE community_comments ADD COLUMN expires_at TEXT");
      await db.exec(
        "UPDATE community_comments SET expires_at = datetime(created_at, '+28 hours') WHERE expires_at IS NULL"
      );
      console.log("[db] migración: community_comments.expires_at agregada");
    }
  } catch (e) {
    console.error("[db] migración expires_at:", e.message);
  }

  /* Migración: ocultar mensajes personales */
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS hidden_messages (
        user_id    INTEGER NOT NULL,
        message_id INTEGER NOT NULL,
        hidden_at  TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, message_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (message_id) REFERENCES community_comments(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_hidden_user ON hidden_messages(user_id);
    `);
    console.log("[db] migración: tabla hidden_messages lista");
  } catch (e) {
    console.error("[db] migración hidden_messages:", e.message);
  }

  /* Migración: verificación de correo */
  try {
    const cols6 = await tableCols("users");
    if (!cols6.includes("email_verified")) {
      await db.exec("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0");
      console.log("[db] migración: columna users.email_verified agregada");
    }
    if (!cols6.includes("verification_token")) {
      await db.exec("ALTER TABLE users ADD COLUMN verification_token TEXT");
      console.log("[db] migración: columna users.verification_token agregada");
    }
  } catch (e) {
    console.error("[db] migración email_verified:", e.message);
  }

  /* Migración: foto de perfil */
  try {
    const cols7 = await tableCols("users");
    if (!cols7.includes("photo")) {
      await db.exec("ALTER TABLE users ADD COLUMN photo TEXT");
      console.log("[db] migración: columna users.photo agregada");
    }
    if (!cols7.includes("cover_photo")) {
      await db.exec("ALTER TABLE users ADD COLUMN cover_photo TEXT");
      console.log("[db] migración: columna users.cover_photo agregada");
    }
    if (!cols7.includes("bio")) {
      await db.exec("ALTER TABLE users ADD COLUMN bio TEXT");
      console.log("[db] migración: columna users.bio agregada");
    }
  } catch (e) {
    console.error("[db] migración photo:", e.message);
  }

  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS chat_usage (
        user_id        INTEGER NOT NULL,
        date           TEXT NOT NULL,
        seconds_used   INTEGER NOT NULL DEFAULT 0,
        last_heartbeat INTEGER,
        PRIMARY KEY (user_id, date),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);
    console.log("[db] migración: tabla chat_usage lista");
  } catch (e) {
    console.error("[db] migración chat_usage:", e.message);
  }

  /* Migración: temas temporales del chat */
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS chat_topics (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL,
        name       TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_topics_expires ON chat_topics(expires_at);
    `);
    console.log("[db] migración: tabla chat_topics lista");
  } catch (e) {
    console.error("[db] migración chat_topics:", e.message);
  }

  /* Migración: fotos temporales del chat */
  try {
    const cols8 = await tableCols("community_comments");
    if (!cols8.includes("msg_type")) {
      await db.exec("ALTER TABLE community_comments ADD COLUMN msg_type TEXT NOT NULL DEFAULT 'text'");
      console.log("[db] migración: columna community_comments.msg_type agregada");
    }
    if (!cols8.includes("photo_data")) {
      await db.exec("ALTER TABLE community_comments ADD COLUMN photo_data TEXT");
      console.log("[db] migración: columna community_comments.photo_data agregada");
    }
  } catch (e) {
    console.error("[db] migración fotos temporales:", e.message);
  }

  /* Migración: tipo de plan + mensajes privados (DM) */
  try {
    const cols9 = await tableCols("users");
    if (!cols9.includes("plan_type")) {
      await db.exec("ALTER TABLE users ADD COLUMN plan_type TEXT");
      console.log("[db] migración: columna users.plan_type agregada");
    }
    try {
      await db.exec(`
        UPDATE users SET plan_type = 'yearly'
        WHERE subscribed = 1 AND plan_type IS NULL AND lower(email) IN (
          SELECT lower(email) FROM paypal_subscriptions WHERE status = 'ACTIVE'
            AND (lower(plan) IN ('yearly','annual','anual') OR plan LIKE 'P-28J%')
        )`);
      await db.exec(`
        UPDATE users SET plan_type = 'monthly'
        WHERE subscribed = 1 AND plan_type IS NULL`);
    } catch (e2) {
      console.error("[db] migración plan_type (relleno):", e2.message);
    }
  } catch (e) {
    console.error("[db] migración plan_type:", e.message);
  }

  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS private_messages (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        from_user_id INTEGER NOT NULL,
        to_user_id   INTEGER NOT NULL,
        text         TEXT NOT NULL,
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at   TEXT NOT NULL,
        read_at      TEXT,
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

  /* Migración: mensajes de voz en DMs */
  try {
    const colsDm = await tableCols("private_messages");
    if (!colsDm.includes("msg_type")) {
      await db.exec("ALTER TABLE private_messages ADD COLUMN msg_type TEXT NOT NULL DEFAULT 'text'");
      console.log("[db] migración: columna private_messages.msg_type agregada");
    }
    if (!colsDm.includes("audio_data")) {
      await db.exec("ALTER TABLE private_messages ADD COLUMN audio_data TEXT");
      console.log("[db] migración: columna private_messages.audio_data agregada");
    }
    if (!colsDm.includes("file_data")) {
      await db.exec("ALTER TABLE private_messages ADD COLUMN file_data TEXT");
      console.log("[db] migración: columna private_messages.file_data agregada");
    }
    if (!colsDm.includes("file_name")) {
      await db.exec("ALTER TABLE private_messages ADD COLUMN file_name TEXT");
      console.log("[db] migración: columna private_messages.file_name agregada");
    }
    if (!colsDm.includes("file_size")) {
      await db.exec("ALTER TABLE private_messages ADD COLUMN file_size INTEGER");
      console.log("[db] migración: columna private_messages.file_size agregada");
    }
  } catch (e) {
    console.error("[db] migración msg_type/audio_data:", e.message);
  }

  /* Sistema anti-spam */
  try {
    const cols10 = await tableCols("users");
    const add = async (col, def) => {
      if (!cols10.includes(col)) {
        await db.exec(`ALTER TABLE users ADD COLUMN ${col} ${def}`);
        console.log(`[db] migración: columna users.${col} agregada`);
        cols10.push(col);
      }
    };
    await add("chat_strikes", "INTEGER NOT NULL DEFAULT 0");
    await add("chat_strikes_date", "TEXT");
    await add("chat_muted", "INTEGER NOT NULL DEFAULT 0");
    await add("chat_mutes", "INTEGER NOT NULL DEFAULT 0");
    await add("rv_bonus_for", "TEXT");
    await add("chat_alias", "TEXT");
  } catch (e) {
    console.error("[db] migración chat_strikes:", e.message);
  }

  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS chat_violations (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id        INTEGER NOT NULL,
        attempted_text TEXT NOT NULL,
        violation_type TEXT NOT NULL,
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

  /* Migración: sistema de créditos */
  try {
    const cols11 = await tableCols("users");
    if (!cols11.includes("credits")) {
      await db.exec("ALTER TABLE users ADD COLUMN credits INTEGER NOT NULL DEFAULT 0");
      console.log("[db] migración: columna users.credits agregada");
    }
  } catch (e) {
    console.error("[db] migración credits:", e.message);
  }

  try {
    await db.exec(`
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
    const colsC = await tableCols("community_comments");
    if (!colsC.includes("is_promo")) {
      await db.exec("ALTER TABLE community_comments ADD COLUMN is_promo INTEGER NOT NULL DEFAULT 0");
      console.log("[db] migración: columna community_comments.is_promo agregada");
    }
  } catch (e) {
    console.error("[db] migración is_promo:", e.message);
  }

  /* Migración: bloque de imágenes promocionales */
  try {
    const cols12 = await tableCols("users");
    if (!cols12.includes("img_block_remaining")) {
      await db.exec("ALTER TABLE users ADD COLUMN img_block_remaining INTEGER NOT NULL DEFAULT 0");
      console.log("[db] migración: columna users.img_block_remaining agregada");
    }
  } catch (e) {
    console.error("[db] migración img_block_remaining:", e.message);
  }

  /* Migración: republicación automática */
  try {
    await db.exec(`
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
    const colsE = await tableCols("scheduled_reposts");
    if (!colsE.includes("expires_at")) {
      await db.exec("ALTER TABLE scheduled_reposts ADD COLUMN expires_at TEXT");
      console.log("[db] migración: columna scheduled_reposts.expires_at agregada");
    }
    console.log("[db] migración: tabla scheduled_reposts lista");
  } catch (e) {
    console.error("[db] migración scheduled_reposts:", e.message);
  }

  try {
    const colsD = await tableCols("community_comments");
    if (!colsD.includes("is_repost")) {
      await db.exec("ALTER TABLE community_comments ADD COLUMN is_repost INTEGER NOT NULL DEFAULT 0");
      console.log("[db] migración: columna community_comments.is_repost agregada");
    }
  } catch (e) {
    console.error("[db] migración is_repost:", e.message);
  }

  /* Migración: límite diario de DMs */
  try {
    await db.exec(`
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

  /* Migración: dominios verificados */
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS verified_domains (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        domain      TEXT UNIQUE NOT NULL,
        approved_by TEXT,
        approved_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    const vd = await db.get("SELECT COUNT(*) AS n FROM verified_domains");
    if (!vd || vd.n === 0) {
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
      for (const d of semilla) {
        await db.run("INSERT OR IGNORE INTO verified_domains (domain, approved_by) VALUES (?, 'sistema')", d);
      }
      console.log("[db] migración: tabla verified_domains creada con", semilla.length, "dominios semilla");
    } else {
      console.log("[db] migración: tabla verified_domains lista");
    }
  } catch (e) {
    console.error("[db] migración verified_domains:", e.message);
  }

  /* Migración: usuarios en línea */
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS online_users (
        user_id   INTEGER PRIMARY KEY,
        last_seen INTEGER NOT NULL
      );
    `);
    console.log("[db] migración: tabla online_users lista");
  } catch (e) {
    console.error("[db] migración online_users:", e.message);
  }

  /* Migración: referidos */
  try {
    const colsRef = await tableCols("users");
    if (!colsRef.includes("referred_by")) {
      await db.exec("ALTER TABLE users ADD COLUMN referred_by INTEGER");
      console.log("[db] migración: users.referred_by agregada");
    }
  } catch (e) {
    console.error("[db] migración referred_by:", e.message);
  }

  /* Migración: reacciones */
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS message_reactions (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id      INTEGER NOT NULL,
        message_id   INTEGER NOT NULL,
        message_type TEXT NOT NULL CHECK (message_type IN ('community','dm')),
        reaction     TEXT NOT NULL CHECK (reaction IN ('like','dislike')),
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (user_id, message_id, message_type),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_react_msg ON message_reactions(message_id, message_type);
      CREATE INDEX IF NOT EXISTS idx_react_user ON message_reactions(user_id);
    `);
    console.log("[db] migración: tabla message_reactions lista");
  } catch (e) {
    console.error("[db] migración message_reactions:", e.message);
  }

  /* Seguridad: bloqueo de IPs y baneo */
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS blocked_ips (
        ip         TEXT PRIMARY KEY,
        reason     TEXT NOT NULL DEFAULT '',
        blocked_at TEXT NOT NULL DEFAULT (datetime('now')),
        blocked_by TEXT NOT NULL DEFAULT 'auto' CHECK (blocked_by IN ('auto','admin'))
      );
    `);
    console.log("[db] migración: tabla blocked_ips lista");
  } catch (e) {
    console.error("[db] migración blocked_ips:", e.message);
  }
  try {
    const colsSec = await tableCols("users");
    const addSec = async (col, def) => {
      if (!colsSec.includes(col)) {
        await db.exec(`ALTER TABLE users ADD COLUMN ${col} ${def}`);
        console.log(`[db] migración: columna users.${col} agregada`);
        colsSec.push(col);
      }
    };
    await addSec("banned", "INTEGER NOT NULL DEFAULT 0");
    await addSec("ban_reason", "TEXT");
  } catch (e) {
    console.error("[db] migración banned:", e.message);
  }

  /* Correo de respaldo del admin */
  try {
    const colsBk = await tableCols("users");
    if (!colsBk.includes("backup_email")) {
      await db.exec("ALTER TABLE users ADD COLUMN backup_email TEXT");
      console.log("[db] migración: columna users.backup_email agregada");
    }
  } catch (e) {
    console.error("[db] migración backup_email:", e.message);
  }

  /* Seguridad de cuenta */
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS password_reset_codes (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL,
        code       TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used       INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_reset_codes_user ON password_reset_codes(user_id);
      CREATE TABLE IF NOT EXISTS password_changes (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL,
        changed_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_pw_changes_user ON password_changes(user_id);
    `);
    console.log("[db] migración: tablas password_reset_codes y password_changes listas");
  } catch (e) {
    console.error("[db] migración códigos/cambios:", e.message);
  }
  try {
    const colsAcc = await tableCols("users");
    const addAcc = async (col, def) => {
      if (!colsAcc.includes(col)) {
        await db.exec(`ALTER TABLE users ADD COLUMN ${col} ${def}`);
        console.log(`[db] migración: columna users.${col} agregada`);
        colsAcc.push(col);
      }
    };
    await addAcc("failed_logins", "INTEGER NOT NULL DEFAULT 0");
    await addAcc("locked_until", "TEXT");
    await addAcc("disabled_until", "TEXT");
  } catch (e) {
    console.error("[db] migración seguridad cuenta:", e.message);
  }

  /* Álbumes de fotos */
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS albums (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL,
        title      TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_albums_user ON albums(user_id);
      CREATE TABLE IF NOT EXISTS album_photos (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        album_id   INTEGER NOT NULL,
        photo      TEXT NOT NULL,
        caption    TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_album_photos_album ON album_photos(album_id);
    `);
    console.log("[db] migración: tablas albums y album_photos listas");
  } catch (e) {
    console.error("[db] migración álbumes:", e.message);
  }

  /* Sistema de banderas */
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS user_flags (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        target_user_id   INTEGER NOT NULL,
        reporter_user_id INTEGER NOT NULL,
        created_at       TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(target_user_id, reporter_user_id),
        FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (reporter_user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_user_flags_target ON user_flags(target_user_id);
    `);
    const colsF = await tableCols("users");
    if (!colsF.includes("chat_disabled")) {
      await db.exec("ALTER TABLE users ADD COLUMN chat_disabled INTEGER NOT NULL DEFAULT 0");
      console.log("[db] migración: columna users.chat_disabled agregada");
    }
    console.log("[db] migración: tabla user_flags lista");
  } catch (e) {
    console.error("[db] migración banderas:", e.message);
  }

  /* Fecha de nacimiento */
  try {
    const colsB = await tableCols("users");
    if (!colsB.includes("birthdate")) {
      await db.exec("ALTER TABLE users ADD COLUMN birthdate TEXT");
      console.log("[db] migración: columna users.birthdate agregada");
    }
  } catch (e) {
    console.error("[db] migración birthdate:", e.message);
  }

  /* Mensajes del formulario de contacto */
  try {
    await db.exec(`CREATE TABLE IF NOT EXISTS contact_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )`);
    // Columna type: 'sugerencia' | 'problema' | 'otro' (contacto dentro de la app).
    try {
      const cCols = await tableCols("contact_messages");
      if (!cCols.includes("type")) await db.exec("ALTER TABLE contact_messages ADD COLUMN type TEXT");
    } catch (e) { /* la tabla puede no existir aún en esta pasada */ }
    console.log("[db] migración: tabla contact_messages lista");
  } catch (e) {
    console.error("[db] migración contact_messages:", e.message);
  }

  /* Sexo del usuario (M/F) para adaptar contenido y voz */
  try {
    const cols = await db.all("PRAGMA table_info(users)");
    if (!cols.some(c => c.name === "gender")) {
      await db.exec("ALTER TABLE users ADD COLUMN gender TEXT");
      console.log("[db] migración: columna users.gender agregada");
    }
  } catch (e) {
    console.error("[db] migración gender:", e.message);
  }

  /* IA: análisis de casos de usuarios */
  try {
    await db.exec(`CREATE TABLE IF NOT EXISTS ai_user_analysis (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      analysis_text TEXT,
      key_issues TEXT,
      progress_summary TEXT,
      risk_level TEXT DEFAULT 'bajo',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);
    console.log("[db] migración: tabla ai_user_analysis lista");
  } catch (e) {
    console.error("[db] migración ai_user_analysis:", e.message);
  }

  /* IA: retos personalizados (requieren aprobación del admin) */
  try {
    await db.exec(`CREATE TABLE IF NOT EXISTS ai_challenges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      day_target INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      admin_notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);
    console.log("[db] migración: tabla ai_challenges lista");
  } catch (e) {
    console.error("[db] migración ai_challenges:", e.message);
  }

  /* IA: reportes para el administrador */
  try {
    await db.exec(`CREATE TABLE IF NOT EXISTS ai_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      report_type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      admin_feedback TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      reviewed_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);
    console.log("[db] migración: tabla ai_reports lista");
  } catch (e) {
    console.error("[db] migración ai_reports:", e.message);
  }

  /* Reportes de Muse para el administrador */
  try {
    await db.exec(`CREATE TABLE IF NOT EXISTS admin_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      report_type TEXT DEFAULT 'general',
      user_id INTEGER,
      user_name TEXT,
      is_read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )`);
    console.log("[db] migración: tabla admin_reports lista");
    // Tabla de ajustes clave-valor (ej. el JWT_SECRET persistente).
    await db.exec(`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )`);
    // Link Pub: links que el admin publica en el perfil de los usuarios
    // (segmentados por usuarios, países y sexo; NULL/vacío = todos).
    await db.exec(`CREATE TABLE IF NOT EXISTS admin_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      title TEXT,
      target_users TEXT,
      target_countries TEXT,
      target_gender TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`);
    // Agregar columnas user_id/user_name si la tabla ya existía sin ellas.
    try {
      const cols = await tableCols("admin_reports");
      if (!cols.includes("user_id")) await db.exec("ALTER TABLE admin_reports ADD COLUMN user_id INTEGER");
      if (!cols.includes("user_name")) await db.exec("ALTER TABLE admin_reports ADD COLUMN user_name TEXT");
    } catch (e) { console.error("[db] migración admin_reports cols:", e.message); }
  } catch (e) {
    console.error("[db] migración admin_reports:", e.message);
  }
}

/* ready: se resuelve cuando las migraciones terminan. server.js la espera
 * antes de hacer listen(). */
const ready = migrate().then(
  () => console.log("[db] migraciones completadas (" + (isTurso ? "Turso" : "local") + ")"),
  (e) => console.error("[db] ERROR en migraciones:", e.message)
);

module.exports = { ...db, ready, ah, isTurso };
