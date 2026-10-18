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

app.listen(PORT, () => {
  console.log(`[reaviva] API corriendo en http://localhost:${PORT}`);
  console.log(`[reaviva] Frontend servido desde ${FRONTEND_DIR}`);
});
