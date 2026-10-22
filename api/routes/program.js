/* Reaviva API — contenido del programa editable por el admin.
 *
 *   GET /api/program/audio/:day/:gender → audio del día: si el admin
 *       subió uno para ese día/sexo, se sirve ese; si no, redirige al
 *       audio original (/audio/dia-N.mp3 o dia-N-f.mp3).
 *   GET /api/program/test-extras → preguntas extra del admin para los
 *       tests de progreso (requiere sesión).
 */
"use strict";

const express = require("express");
const db = require("../db");
const { ah } = db;
const { requireAuth } = require("./auth");

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
