/* Reaviva API — contenido del programa editable por el admin.
 *
 *   GET /api/program/audio/:day/:gender → audio del día: si el admin
 *       subió uno para ese día/sexo, se sirve ese; si no, redirige al
 *       audio original (/audio/dia-N.mp3 o dia-N-f.mp3).
 *   GET /api/program/viral-audio/:day → audio viral extra del día
 *       (TikTok @reavivatufe1, top 30 por vistas, día 1 = más viral).
 *       SOLO audio, sin video. Los archivos viven en api/viral-audio/
 *       (FUERA de web/), así no se sirven como estáticos: este endpoint
 *       exige un token válido (Bearer o ?t=, porque <audio> no envía
 *       headers) y transmite el archivo. Sin token válido → 401.
 *   GET /api/program/test-extras → preguntas extra del admin para los
 *       tests de progreso (requiere sesión).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const express = require("express");
const db = require("../db");
const { ah } = db;
const { requireAuth, verifyToken } = require("./auth");

/* Títulos de los audios virales (TikTok @reavivatufe1, top 30 por
 * vistas, 28 oct 2026; día 1 = más viral). Solo se usa el título en
 * el frontend; el audio es el mp3 extraído del video. */
const VIRAL_TITLES = [
  "Cuando el rechazo se convierte en desconexión emocional",
  "Cuando el esfuerzo no es suficiente",
  "¿Por qué sentimos atracción por alguien nuevo?",
  "Cómo superar el dolor sin destruirte tras una ruptura",
  "¿Amor verdadero o interés?",
  "¿Por qué la novedad puede cambiar tu percepción en una relación larga?",
  "¿Por qué cada vez más hombres eligen la soledad?",
  "¿Por qué esforzarte más no siempre funciona en el amor?",
  "¿Qué pasa cuando un hombre se siente invisible en su propio hogar?",
  "¿Por qué perseguir a alguien que se aleja solo destruye tu dignidad?",
  "El abuso psicológico que no se ve",
  "El verdadero peligro tras una ruptura: vivir para impresionar a quien te dejó",
  "¿Cómo evitar que la novedad destruya tu relación de años?",
  "Las señales claras que indican que debes alejarte de una relación dañina",
  "El peor error de un hombre: sacrificarlo todo por amor",
  "El dolor de la traición descubierta",
  "¿Amor o suscripción?",
  "¿Sabes qué pasa realmente cuando una relación termina?",
  "Cómo dejar de perseguir a alguien y recuperar tu vida",
  "¿Amar no es suficiente?",
  "¿Cómo una mujer puede destruir la confianza de un hombre sin insultos?",
  "¿Sabías que la influencia no siempre es una orden?",
  "El error que destruye tus límites cuando alguien regresa",
  "¿Sabes cuándo empiezas a perder a una mujer?",
  "Deja de perseguir aprobación",
  "¿Qué destruye más una relación?",
  "¿El matrimonio convierte a un hombre en esclavo emocional?",
  "Cómo poner límites puede salvar tu relación",
  "El verdadero poder en las relaciones",
  "¿Sabes cuál es el momento más humillante para un hombre?",
];

const router = express.Router();

/* FASE 2 (día 31+): el contenido se genera por ciclos de 7 días
 * sobre un pool de 8 temas (ver web/program2.js — phase2Info; esta
 * fórmula DEBE coincidir con la del frontend).
 *   f2day = day - 30 · ciclo0 = floor((f2day-1)/7)
 *   tema  = (ciclo0 % 8) + 1 · día del ciclo = ((f2day-1) % 7) + 1
 * Los archivos viven en web/audio/ como f2-t<tema>-d<día>.mp3 (+ "-f").
 * El override del admin (program_audios, por día absoluto) se
 * consulta ANTES y sigue teniendo prioridad, igual que en Fase 1. */
const F2_THEMES = 8;
function phase2AudioFile(day, gender) {
  const f2 = day - 30;
  const cyc0 = Math.floor((f2 - 1) / 7);
  const tema = (cyc0 % F2_THEMES) + 1;
  const cd = ((f2 - 1) % 7) + 1;
  return "/audio/f2-t" + tema + "-d" + cd + (gender === "F" ? "-f" : "") + ".mp3";
}

router.get("/audio/:day/:gender", ah(async (req, res) => {
  const day = Math.max(1, parseInt(req.params.day, 10) || 1);
  const gender = req.params.gender === "F" ? "F" : "M";
  const row = await db.get("SELECT audio FROM program_audios WHERE day = ? AND gender = ?", day, gender);
  if (row && row.audio) {
    const m = String(row.audio).match(/^data:audio\/[a-z0-9.+-]+(?:;codecs=["']?[a-z0-9.+-]+["']?)?;base64,(.+)$/is);
    if (m) {
      const buf = Buffer.from(m[1], "base64");
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Content-Length", buf.length);
      res.setHeader("Cache-Control", "public, max-age=3600");
      return res.send(buf);
    }
  }
  if (day > 30) return res.redirect(302, phase2AudioFile(day, gender));
  return res.redirect(302, "/audio/dia-" + day + (gender === "F" ? "-f" : "") + ".mp3");
}));

/* Audio viral extra del día (solo días 1-30). El token puede venir
 * por header Bearer o por ?t=, porque la etiqueta <audio> del
 * navegador no puede enviar headers personalizados. */
router.get("/viral-audio/:day", ah(async (req, res) => {
  const day = parseInt(req.params.day, 10) || 0;
  if (day < 1 || day > 30) return res.status(404).json({ error: "Día no válido" });
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : (req.query.t || null);
  const user = token ? await verifyToken(token) : null;
  if (!user) return res.status(401).json({ error: "Token requerido" });
  const file = path.join(__dirname, "..", "viral-audio", "viral-" + day + ".mp3");
  if (!fs.existsSync(file)) return res.status(404).json({ error: "Audio viral no disponible para este día" });
  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Cache-Control", "private, max-age=3600");
  return res.sendFile(file);
}));

router.get("/test-extras", requireAuth, ah(async (req, res) => {
  const rows = await db.all("SELECT question, kind FROM program_test_questions ORDER BY id ASC LIMIT 10");
  res.json({
    preguntas: rows.map((r) => ({
      t: r.question,
      scale: r.kind !== "open",
      open: r.kind === "open",
    })),
  });
}));

module.exports = { router };
