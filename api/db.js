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

module.exports = db;
