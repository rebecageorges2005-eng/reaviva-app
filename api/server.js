/* Reaviva API — main server
 *
 *  npm install
 *  cp .env.example .env   # fill in real values
 *  npm start              # http://localhost:3000
 */
"use strict";

require("dotenv").config();
const path = require("path");
const express = require("express");

const db = require("./db"); // initializes schema on require
const { router: authRouter, requireAuth } = require("./routes/auth");
const progressRouter = require("./routes/progress");
const journalRouter = require("./routes/journal");
const { router: billingRouter, webhookHandler, paypalConfigured } = require("./routes/billing");
const { router: adminRouter } = require("./routes/admin");
const { router: communityRouter } = require("./routes/community");

const app = express();
const PORT = Number(process.env.PORT || 3000);

if (process.env.TRUST_PROXY === "true") app.set("trust proxy", 1);

/* --- PayPal webhook needs the RAW body: mount BEFORE express.json() --- */
app.post("/api/paypal/webhook", express.raw({ type: "application/json" }), webhookHandler);
if (paypalConfigured()) {
  console.log("[reaviva] PayPal configurado — webhook activo en /api/paypal/webhook");
} else {
  console.log("[reaviva] PayPal NO configurado — /api/paypal/* devolverá 503 hasta que Georges ponga las credenciales (ver README)");
}

app.use(express.json({ limit: "1mb" }));

/* --- API routes --- */
app.use("/api/auth", authRouter);
app.get("/api/me", requireAuth, (req, res) => {
  const u = req.user;
  res.json({
    user: {
      id: u.id,
      email: u.email,
      name: u.name,
      programStart: u.program_start,
      subscribed: u.subscribed === 1,
      createdAt: u.created_at,
    },
  });
});
app.use("/api/progress", progressRouter);
app.use("/api/journal", journalRouter);
app.use("/api", billingRouter); // /api/paypal/*
app.use("/api/admin", adminRouter); // /api/admin/* (solo administradores)
app.use("/api/community", communityRouter); // /api/community/* (comunidad anónima)

/* --- Mensajes del administrador para el usuario ---
 * GET /api/messages → mensajes no leídos (para mí o para todos).
 * POST /api/messages/:id/read → marcar como leído. */
app.get("/api/messages", requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, title, body, created_at
       FROM admin_messages
       WHERE read_at IS NULL AND (user_id = ? OR user_id IS NULL)
       ORDER BY created_at DESC`
    )
    .all(req.user.id);
  res.json({
    messages: rows.map((m) => ({
      id: m.id,
      titulo: m.title,
      cuerpo: m.body,
      fecha: m.created_at,
    })),
  });
});
app.post("/api/messages/:id/read", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "ID inválido" });
  db.prepare(
    `UPDATE admin_messages SET read_at = datetime('now')
     WHERE id = ? AND (user_id = ? OR user_id IS NULL)`
  ).run(id, req.user.id);
  res.json({ ok: true });
});

app.get("/api/health", (req, res) =>
  res.json({ ok: true, paypal: paypalConfigured(), time: new Date().toISOString() })
);

/* --- Serve the frontend SPA in production --- */
const FRONTEND_DIR = path.resolve(__dirname, process.env.FRONTEND_DIR || "../web");
app.use(express.static(FRONTEND_DIR));
// SPA fallback: any non-API route serves index.html
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(FRONTEND_DIR, "index.html"));
});

/* --- Recordatorio automático: "tu plan vence pronto" ---
 * Cada 6 horas revisa suscripciones ACTIVAS cuyo próximo cobro sea en
 * 3 días o menos y que aún no recibieron el aviso (reminder_sent = 0).
 * Les deja un mensaje en la app y marca reminder_sent = 1 para no repetir. */
function checkExpiringPlans() {
  try {
    const rows = db
      .prepare(
        `SELECT email, next_billing_date
         FROM paypal_subscriptions
         WHERE status = 'ACTIVE'
           AND reminder_sent = 0
           AND next_billing_date IS NOT NULL
           AND date(next_billing_date) <= date('now', '+3 days')`
      )
      .all();
    for (const r of rows) {
      const user = db.prepare("SELECT id FROM users WHERE email = ?").get(r.email);
      const fecha = (() => {
        const d = new Date(r.next_billing_date.length <= 10 ? r.next_billing_date + "T12:00:00" : r.next_billing_date);
        return isNaN(d) ? r.next_billing_date
          : d.toLocaleDateString("es-ES", { day: "numeric", month: "long" });
      })();
      const titulo = "Tu plan vence pronto ⏰";
      const cuerpo = `Tu membresía Reaviva vence el ${fecha}. Renuévala para no perder tu progreso ni tu racha. ¡Tu sanación vale la pena! 💛`;
      if (user) {
        db.prepare(
          "INSERT INTO admin_messages (user_id, email, title, body) VALUES (?, ?, ?, ?)"
        ).run(user.id, r.email, titulo, cuerpo);
      } else {
        // sin cuenta local: mensaje dirigido por email (se mostrará al registrarse con ese correo)
        db.prepare(
          "INSERT INTO admin_messages (user_id, email, title, body) VALUES (NULL, ?, ?, ?)"
        ).run(r.email, titulo, cuerpo);
      }
      db.prepare("UPDATE paypal_subscriptions SET reminder_sent = 1 WHERE email = ?").run(r.email);
      console.log(`[reaviva] recordatorio de vencimiento enviado a ${r.email}`);
    }
  } catch (e) {
    console.error("[reaviva] error en recordatorio de vencimiento:", e.message);
  }
}
setInterval(checkExpiringPlans, 6 * 60 * 60 * 1000);
setTimeout(checkExpiringPlans, 60 * 1000); // primera pasada 1 min después de arrancar

app.listen(PORT, () => {
  console.log(`[reaviva] API corriendo en http://localhost:${PORT}`);
  console.log(`[reaviva] Frontend servido desde ${FRONTEND_DIR}`);
});
