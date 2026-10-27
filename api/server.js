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
const zlib = require("zlib");

const db = require("./db");
const { router: authRouter, requireAuth, verifyToken } = require("./routes/auth");
const { router: progressRouter } = require("./routes/progress");
const journalRouter = require("./routes/journal");
const { router: billingRouter, webhookHandler, paypalConfigured } = require("./routes/billing");
const { router: adminRouter } = require("./routes/admin");
const { router: communityRouter, processDueReposts } = require("./routes/community");
const { router: topicsRouter } = require("./routes/topics");
const { router: dmRouter } = require("./routes/dm");
const { router: rvRouter } = require("./routes/rv");
const { router: reactionsRouter } = require("./routes/reactions");
const { router: albumsRouter } = require("./routes/albums");
const { router: linksRouter } = require("./routes/links");
const { router: flagsRouter } = require("./routes/flags");
const { router: programRouter } = require("./routes/program");
const { notificationsRouter, dailyAdminRouter } = require("./routes/notifications");

const app = express();
const PORT = Number(process.env.PORT || 3000);

if (process.env.TRUST_PROXY === "true") app.set("trust proxy", 1);

if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
  console.warn("[seguridad] JWT_SECRET sin variable de entorno: se usará el persistente de la base de datos.");
}

const {
  blockIpMiddleware,
  securityHeaders,
  attackDetector,
  scanDetector,
  rateLimit,
} = require("./security");

app.use(securityHeaders);

const apiLimiter = rateLimit({
  max: 100, windowMs: 60 * 1000,
  keyFn: () => "api",
});
app.use("/api/", (req, res, next) => {
  if (req.path === "/api/paypal/webhook") return next();
  return apiLimiter(req, res, next);
});

app.post("/api/paypal/webhook", express.raw({ type: "application/json" }), webhookHandler);
if (paypalConfigured()) {
  console.log("[reaviva] PayPal configurado — webhook activo en /api/paypal/webhook");
} else {
  console.log("[reaviva] PayPal NO configurado — /api/paypal/* devolverá 503 hasta que Georges ponga las credenciales (ver README)");
}

app.use(express.json({ limit: "10mb" }));

app.use("/api/", (req, res, next) => {
  if (req.path === "/api/paypal/webhook") return next();
  return next();
});

app.use((req, res, next) => {
  const accept = req.headers["accept-encoding"] || "";
  if(!/\bgzip\b/.test(accept)) return next();
  const origSend = res.send.bind(res);
  res.send = (body) => {
    if(res.getHeader("Content-Encoding")) return origSend(body);
    const ct = String(res.getHeader("Content-Type") || "");
    const isText = /text|javascript|json|css|html|svg|xml/.test(ct);
    if(!isText || !body || Buffer.byteLength(String(body)) < 1024) return origSend(body);
    try{
      const gz = zlib.gzipSync(String(body), { level: 6 });
      res.setHeader("Content-Encoding", "gzip");
      res.setHeader("Content-Length", String(gz.length));
      return origSend(gz);
    }catch(e){ return origSend(body); }
  };
  next();
});

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
app.use("/api", billingRouter);
app.use("/api/admin", adminRouter);
app.use("/api/admin", dailyAdminRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/community", communityRouter);
app.use("/api/topics", topicsRouter);
app.use("/api/dm", dmRouter);
app.use("/api/rv", rvRouter);
app.use("/api/reactions", reactionsRouter);
app.use("/api/albums", albumsRouter);
app.use("/api/program", programRouter);
app.use("/api/links", linksRouter);
app.use("/api/flags", flagsRouter);

app.get("/api/messages", requireAuth, async (req, res) => {
  const rows = await db.all(
      `SELECT id, title, body, created_at
       FROM admin_messages
       WHERE read_at IS NULL AND (user_id = ? OR user_id IS NULL)
       ORDER BY created_at DESC`
    , req.user.id);
  res.json({
    messages: rows.map((m) => ({
      id: m.id,
      titulo: m.title,
      cuerpo: m.body,
      fecha: m.created_at,
    })),
  });
});
app.post("/api/messages/:id/read", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "ID inválido" });
  await db.run(
    `UPDATE admin_messages SET read_at = datetime('now')
     WHERE id = ? AND (user_id = ? OR user_id IS NULL)`
  , id, req.user.id);
  res.json({ ok: true });
});

app.get("/api/health", (req, res) =>
  res.json({ ok: true, paypal: paypalConfigured(), time: new Date().toISOString() })
);

app.get("/api/config", (req, res) =>
  res.json({ recaptchaSiteKey: process.env.RECAPTCHA_SITE_KEY || null })
);

app.post("/api/contact", async (req, res) => {
  const name = String(req.body?.name || "").trim().slice(0, 80);
  const email = String(req.body?.email || "").trim().toLowerCase().slice(0, 120);
  const message = String(req.body?.message || "").trim().slice(0, 2000);
  const type = ["sugerencia", "problema", "otro"].includes(String(req.body?.type || ""))
    ? String(req.body.type) : "otro";
  if (!name) return res.status(400).json({ error: "Escribe tu nombre." });
  if (!email || !email.includes("@")) return res.status(400).json({ error: "Correo inválido." });
  if (!message) return res.status(400).json({ error: "Escribe tu mensaje." });
  try {
    await db.run("INSERT INTO contact_messages (name, email, message, type) VALUES (?, ?, ?, ?)", name, email, message, type);
  } catch (e) { }
  console.log(`[contacto] ${name} <${email}>: ${message.slice(0, 120)}`);
  res.json({ ok: true });
});

app.use("/audio", (req, res, next) => {
  const m = /^\/dia-(\d+)\.mp3$/.exec(req.path);
  if (!m) return next();
  const day = Number(m[1]);
  if (day <= 7) return next();
  const user = req.query.token ? verifyToken(String(req.query.token)) : null;
  if (user && (user.subscribed === 1 || user.is_admin === 1)) return next();
  return res.status(403).send("Este día requiere un plan de pago 💎");
});

const FRONTEND_DIR = path.resolve(__dirname, process.env.FRONTEND_DIR || "../web");
app.use(express.static(FRONTEND_DIR, {
  maxAge: "7d",
  setHeaders(res, filePath){
    if(filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
  }
}));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  if (req.path === "/admin/ingzoe") return res.sendFile(path.join(FRONTEND_DIR, "admin.html"));
  if (req.path === "/admin/panel") return res.sendFile(path.join(FRONTEND_DIR, "panel.html"));
  res.sendFile(path.join(FRONTEND_DIR, "index.html"));
});

async function checkExpiringPlans() {
  try {
    const rows = await db.all(
        `SELECT email, next_billing_date
         FROM paypal_subscriptions
         WHERE status = 'ACTIVE'
           AND reminder_sent = 0
           AND next_billing_date IS NOT NULL
           AND date(next_billing_date) <= date('now', '+3 days')`
      );
    for (const r of rows) {
      const user = await db.get("SELECT id FROM users WHERE email = ?", r.email);
      const fecha = (() => {
        const d = new Date(r.next_billing_date.length <= 10 ? r.next_billing_date + "T12:00:00" : r.next_billing_date);
        return isNaN(d) ? r.next_billing_date
          : d.toLocaleDateString("es-ES", { day: "numeric", month: "long" });
      })();
      const titulo = "Tu plan vence pronto ⏰";
      const cuerpo = `Tu membresía Reaviva vence el ${fecha}. Renuévala para no perder tu progreso ni tu racha. ¡Tu sanación vale la pena! 💛`;
      if (user) {
        await db.run(
          "INSERT INTO admin_messages (user_id, email, title, body) VALUES (?, ?, ?, ?)"
        , user.id, r.email, titulo, cuerpo);
      } else {
        await db.run(
          "INSERT INTO admin_messages (user_id, email, title, body) VALUES (NULL, ?, ?, ?)"
        , r.email, titulo, cuerpo);
      }
      await db.run("UPDATE paypal_subscriptions SET reminder_sent = 1 WHERE email = ?", r.email);
      console.log(`[reaviva] recordatorio de vencimiento enviado a ${r.email}`);
    }
  } catch (e) {
    console.error("[reaviva] error en recordatorio de vencimiento:", e.message);
  }
}
setInterval(checkExpiringPlans, 6 * 60 * 60 * 1000);
setTimeout(checkExpiringPlans, 60 * 1000);

setInterval(() => {
  try {
    processDueReposts();
  } catch (e) {
    console.error("[reaviva] error en processDueReposts:", e.message);
  }
}, 5 * 60 * 1000);

db.ready.then(async () => {
  try {
    if (!process.env.JWT_SECRET) {
      const row = await db.get("SELECT value FROM settings WHERE key = 'jwt_secret'");
      if (row && row.value) {
        process.env.JWT_SECRET = row.value;
        console.log("[seguridad] JWT_SECRET cargado desde la base de datos (persistente).");
      } else {
        const secret = require("crypto").randomBytes(48).toString("hex");
        await db.run("INSERT INTO settings (key, value) VALUES ('jwt_secret', ?)", secret);
        process.env.JWT_SECRET = secret;
        console.log("[seguridad] JWT_SECRET generado y guardado en la base de datos (persistente).");
      }
    }
  } catch (e) {
    console.error("[seguridad] no se pudo resolver el JWT_SECRET persistente:", e.message);
  }
  app.listen(PORT, () => {
    console.log(`[reaviva] API corriendo en http://localhost:${PORT}`);
    console.log(`[reaviva] Frontend servido desde ${FRONTEND_DIR}`);
  });
});
