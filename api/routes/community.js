/* Reaviva API — comunidad.
 *
 *   GET  /api/community  → comentarios públicos
 *   POST /api/community  → publicar comentario (con validación anti-spam)
 *
 * Regla de visualización: usuarios CON plan → INICIALES (ej. "MG · MX") + foto de perfil;
 * usuarios SIN plan → "Guest" + foto de perfil. NUNCA se exponen nombres reales,
 * email ni IP. El uid del autor se incluye para permitir mensajes privados
 * (solo usuarios autenticados; no revela identidad). El admin ve la identidad
 * real en /api/admin/community (routes/admin.js), que no cambia.
 */
"use strict";

const express = require("express");
const db = require("../db");
const { requireAuth } = require("./auth");
const { temaActivoPorId } = require("./topics");
const { getPlanType } = require("../plan");
const {
  mutedPayload,
  detectSpam,
  registerStrike,
  trySpendRV,
  trySpendImageSend,
  getRV,
} = require("../spam");
const { verifyLinks, mensajeBloqueo } = require("../linkverify");

const router = express.Router();

/* Avatares anónimos: deterministas por user_id (siempre el mismo para el mismo usuario). */
const AVATARS = ["🌻", "🌙", "🦋", "🌿", "⭐", "🍀", "🌺", "🌊", "🔥", "💫", "🌷", "🍃"];
function avatarFor(userId) {
  return AVATARS[Math.abs(Number(userId) || 0) % AVATARS.length];
}

/* Iniciales del nombre en mayúsculas: "María González" → "MG", "Pedro" → "PE".
 * En el chat grupal NUNCA se muestran nombres reales. */
function iniciales(nombre) {
  const partes = String(nombre || "").trim().split(/\s+/).filter(Boolean);
  if (partes.length >= 2) {
    return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
  }
  if (partes.length === 1) {
    return partes[0].slice(0, 2).toUpperCase();
  }
  return "??";
}

/* --- Usuarios en línea en el chat 🟢🔴 ---
 * online_users: presencia con timestamp (segundos Unix). Se actualiza en cada
 * heartbeat (cada 60s con la pestaña de comunidad abierta), al cargar la
 * comunidad y al publicar. En línea = last_seen dentro de los últimos 2 min.
 * Las filas viejas (>1 hora) se limpian al consultar. */
const ONLINE_WINDOW = 120; // segundos: en línea si last_seen > ahora - 120
function markOnline(userId) {
  try {
    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      "INSERT INTO online_users (user_id, last_seen) VALUES (?, ?) " +
      "ON CONFLICT(user_id) DO UPDATE SET last_seen = excluded.last_seen"
    ).run(Number(userId), now);
  } catch (e) { /* nunca bloquea */ }
}
function pruneOnline() {
  try {
    const limite = Math.floor(Date.now() / 1000) - 3600;
    db.prepare("DELETE FROM online_users WHERE last_seen < ?").run(limite);
  } catch (e) { /* nunca bloquea */ }
}
function onlineCount() {
  try {
    const corte = Math.floor(Date.now() / 1000) - ONLINE_WINDOW;
    return db.prepare("SELECT COUNT(*) AS n FROM online_users WHERE last_seen > ?").get(corte).n || 0;
  } catch (e) { return 0; }
}
/* Lista de usuarios en línea para el botón del chat: solo INICIALES + país
 * (con plan) o "Guest" (sin plan) + foto/avatar. NUNCA nombres reales. */
function onlineUsers() {
  try {
    pruneOnline();
    const corte = Math.floor(Date.now() / 1000) - ONLINE_WINDOW;
    const rows = db.prepare(
      `SELECT u.id, u.name, u.photo, u.subscribed, u.is_admin, u.country_code
       FROM online_users o JOIN users u ON u.id = o.user_id
       WHERE o.last_seen > ? ORDER BY o.last_seen DESC LIMIT 100`
    ).all(corte);
    return rows.map((u) => {
      const paid = u.subscribed === 1 || u.is_admin === 1;
      const pais = String(u.country_code || "").toUpperCase();
      const nombre = paid
        ? (pais ? iniciales(u.name) + " · " + pais : iniciales(u.name))
        : "Guest";
      return {
        nombre,
        foto: (u.photo && String(u.photo).startsWith("data:image/")) ? u.photo : null,
        avatar: avatarFor(u.id),
      };
    });
  } catch (e) { return []; }
}

/* Fecha legible en español: "17 oct, 22:30". */
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function fechaCorta(iso) {
  const d = new Date((iso || "").replace(" ", "T") + "Z");
  if (isNaN(d)) return "";
  const dia = d.getDate();
  const mes = MESES[d.getMonth()];
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${dia} ${mes}, ${hh}:${mm}`;
}

/* --- Validación básica de texto ---
 * Los correos/teléfonos/redes se detectan en el filtro anti-spam
 * (api/spam.js) con sistema de strikes. Se hace SIEMPRE en el servidor. */
const MAX_CHARS = 500;
const RATE_PER_HOUR = 10;

/* --- Límite de chat freemium: 2 horas al día ---
 * Los usuarios gratuitos tienen 2 horas (7200s) de acceso diario a la
 * comunidad. El frontend envía POST /api/community/heartbeat cada 60s
 * mientras la pestaña está abierta; el servidor acumula los segundos.
 * Plan pagado y admin: ilimitado (chatTimeLeft: null). */
const CHAT_FREE_SECONDS = 7200; // 2 horas
const utcDate = () => new Date().toISOString().slice(0, 10);

/* { allowed: bool, left: segundos restantes | null si ilimitado } */
function chatAccess(user) {
  if (user.is_admin === 1 || user.subscribed === 1)
    return { allowed: true, left: null };
  const today = utcDate();
  const row = db
    .prepare("SELECT seconds_used FROM chat_usage WHERE user_id = ? AND date = ?")
    .get(user.id, today);
  const left = CHAT_FREE_SECONDS - (row ? row.seconds_used : 0);
  return { allowed: left > 0, left: Math.max(0, left) };
}

function chatBlockedPayload() {
  return {
    error:
      "Tu tiempo de chat de hoy se agotó ⏰ Vuelve mañana o desbloquea acceso ilimitado 💎",
    chatTimeLeft: 0,
    agotado: true,
  };
}

function validarTexto(raw) {
  const text = String(raw || "").trim();
  if (!text) return { error: "Escribe algo para compartir 💛" };
  if (text.length > MAX_CHARS)
    return { error: `Máximo ${MAX_CHARS} caracteres (tu mensaje tiene ${text.length})` };
  // Nota: correos/teléfonos/redes se detectan en el filtro anti-spam
  // (api/spam.js) con sistema de strikes, no aquí.
  return { text };
}

/* --- Expiración de mensajes por plan del autor ---
 * Mensual → 5 horas · anual/admin → 24 horas · gratuito → 28 horas.
 * Las fotos temporales usan su propia lógica de 30 segundos
 * (se guardan con expires_at = NULL). Formato UTC 'YYYY-MM-DD HH:MM:SS'. */
const EXPIRY_HOURS = { monthly: 5, annual: 24, free: 28 };
function messageExpiresAt(user, msgType) {
  if (msgType === "photo") return null;
  const h = EXPIRY_HOURS[getPlanType(user)] || 28;
  return new Date(Date.now() + h * 3600 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}

/* Republicación automática de links pagados con RV 🔁
 * Se ejecuta al cargar el chat, en cada heartbeat y en un intervalo
 * periódico del servidor: publica los reposts vencidos (máx 10 por
 * pasada). Si el usuario fue muteado, se cancelan sus republicaciones
 * pendientes. Las repeticiones son gratis (ya pagadas). */
function processDueReposts() {
  try {
    const due = db
      .prepare(
        `SELECT id, user_id, text, msg_type, photo_data, expires_at FROM scheduled_reposts
         WHERE scheduled_at <= datetime('now') ORDER BY scheduled_at ASC LIMIT 10`
      )
      .all();
    for (const s of due) {
      const muted = db.prepare("SELECT chat_muted FROM users WHERE id = ?").get(s.user_id);
      db.prepare("DELETE FROM scheduled_reposts WHERE id = ?").run(s.id);
      if (muted && Number(muted.chat_muted) === 1) continue; // muteado: se cancela
      db.prepare(
        `INSERT INTO community_comments (user_id, text, msg_type, photo_data, is_promo, is_repost, expires_at)
         VALUES (?, ?, ?, ?, 1, 1, ?)`
      ).run(s.user_id, s.text, s.msg_type, s.photo_data, s.expires_at);
    }
  } catch (e) {
    /* no bloquea */
  }
}

/* GET /api/community → lista pública, anónima, newest first.
 * Incluye chatTimeLeft (segundos restantes hoy; null = ilimitado).
 * Sin tiempo restante → 403 con mensaje en español.
 * Fotos temporales: si msg_type='photo' y tiene más de 30 segundos, se
 * devuelve texto "📷 Foto eliminada" sin los datos de la imagen. */
router.get("/", requireAuth, (req, res) => {
  const acc = chatAccess(req.user);
  if (!acc.allowed) return res.status(403).json(chatBlockedPayload());
  // Presencia: el usuario está viendo el chat ahora mismo.
  markOnline(req.user.id);
  // Republicaciones automáticas pendientes de links pagados con RV.
  processDueReposts();
  // Limpieza: borra mensajes de texto vencidos (las fotos usan su lógica de 30s).
  try {
    db.prepare(
      "DELETE FROM community_comments WHERE msg_type != 'photo' AND expires_at IS NOT NULL AND expires_at <= datetime('now')"
    ).run();
  } catch (e) { /* no bloquea la lectura */ }
  const rows = db
    .prepare(
      `SELECT c.id, c.user_id, c.text, c.created_at, c.msg_type, c.photo_data, c.is_promo, c.is_repost,
              CASE WHEN c.msg_type = 'photo' THEN NULL
                   ELSE CAST((julianday(c.expires_at) - julianday('now')) * 24 AS INTEGER) END AS horas_restantes,
              u.name, u.photo, u.subscribed, u.is_admin, u.country_code
       FROM community_comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.hidden = 0
         AND (c.msg_type = 'photo' OR c.expires_at IS NULL OR c.expires_at > datetime('now'))
         AND NOT EXISTS (SELECT 1 FROM hidden_messages h WHERE h.user_id = ? AND h.message_id = c.id)
       ORDER BY c.created_at DESC
       LIMIT 100`
    )
    .all(req.user.id);
  // Reacciones 👍👎: conteos por mensaje + mi reacción, en una sola consulta.
  const ids = rows.map((c) => c.id);
  const reacMap = {};
  if (ids.length) {
    const ph = ids.map(() => "?").join(",");
    const reacRows = db
      .prepare(
        `SELECT message_id, reaction, COUNT(*) AS n
         FROM message_reactions
         WHERE message_type = 'community' AND message_id IN (${ph})
         GROUP BY message_id, reaction`
      )
      .all(...ids);
    for (const r of reacRows) {
      const e = reacMap[r.message_id] || (reacMap[r.message_id] = { likes: 0, dislikes: 0 });
      if (r.reaction === "like") e.likes = r.n;
      else if (r.reaction === "dislike") e.dislikes = r.n;
    }
    const misRows = db
      .prepare(
        `SELECT message_id, reaction FROM message_reactions
         WHERE message_type = 'community' AND user_id = ? AND message_id IN (${ph})`
      )
      .all(req.user.id, ...ids);
    for (const r of misRows) {
      const e = reacMap[r.message_id] || (reacMap[r.message_id] = { likes: 0, dislikes: 0 });
      e.mi_reaccion = r.reaction;
    }
  }
  res.json({
    chatTimeLeft: acc.left,
    muted: mutedPayload(req.user.id) !== null,
    rv: req.user.is_admin === 1 ? -1 : getRV(req.user.id),
    onlineCount: onlineCount(),
    comentarios: rows.map((c) => {
      // Regla de visualización: con plan → INICIALES nombre + país (ej. "MG · MX") + foto;
      // sin plan → "Guest" + foto. NUNCA: nombres reales, email o IP.
      // El uid (id interno del autor) se expone solo a usuarios autenticados
      // para permitir abrir mensajes privados al hacer clic; no revela identidad.
      const paid = c.subscribed === 1 || c.is_admin === 1;
      const pais = String(c.country_code || "").toUpperCase();
      const nombre = paid
        ? (pais ? iniciales(c.name) + " · " + pais : iniciales(c.name))
        : "Guest";
      // Foto temporal: a los 30 segundos se "elimina".
      let texto = c.text;
      let fotoMsg = null;
      let tipo = c.msg_type || "text";
      let eliminada = false;
      let fotoSegundos = 0;
      if (tipo === "photo") {
        const edadMs = Date.now() - new Date(String(c.created_at).replace(" ", "T") + "Z").getTime();
        if (isNaN(edadMs) || edadMs > 30000) {
          texto = "📷 Foto eliminada";
          fotoMsg = null;
          eliminada = true;
        } else {
          fotoMsg = c.photo_data || null;
          fotoSegundos = Math.max(1, Math.ceil((30000 - edadMs) / 1000));
        }
      }
      return {
        id: c.id,
        uid: c.user_id,
        texto,
        fecha: fechaCorta(c.created_at),
        nombre,
        foto: c.photo || null,
        avatar: avatarFor(c.user_id), // emoji de respaldo si no tiene foto
        msg_type: tipo,
        promo: Number(c.is_promo) === 1,
        repost: Number(c.is_repost) === 1,
        expira_en_horas: c.horas_restantes == null ? null : Number(c.horas_restantes),
        foto_msg: fotoMsg,
        foto_eliminada: eliminada,
        foto_segundos: fotoSegundos,
        likes: (reacMap[c.id] && reacMap[c.id].likes) || 0,
        dislikes: (reacMap[c.id] && reacMap[c.id].dislikes) || 0,
        mi_reaccion: (reacMap[c.id] && reacMap[c.id].mi_reaccion) || null,
      };
    }),
  });
});

/* Límite de tamaño para fotos temporales del chat: 1 MB en base64. */
const PHOTO_MAX_BYTES = 1024 * 1024;

function validarFoto(raw) {
  const s = String(raw || "");
  if (!s.startsWith("data:image/")) return { error: "Formato de imagen no válido." };
  // Solo jpeg, png, webp, gif.
  if (!/^data:image\/(jpeg|png|webp|gif);base64,/.test(s))
    return { error: "Formato de imagen no válido (usa JPG, PNG o WebP)." };
  if (s.length > PHOTO_MAX_BYTES)
    return { error: "La foto es muy grande (máximo 1 MB)." };
  return { photo: s };
}

/* POST /api/community → publicar (validado + rate limit + límite de tiempo).
 * Acepta topic_id opcional: si el tema existe y sigue activo, el mensaje
 * se publica con "#NombreDelTema " antepuesto.
 * Acepta photo opcional (base64 data URL): solo usuarios con plan. La foto
 * es temporal: se elimina a los 30 segundos. */
router.post("/", requireAuth, (req, res) => {
  // Bandera roja: cuenta deshabilitada para chatear/publicar.
  if (req.user.chat_disabled === 1)
    return res.status(403).json({ error: "Tu cuenta está deshabilitada para chatear por múltiples advertencias. 🚩" });
  const acc = chatAccess(req.user);
  if (!acc.allowed) return res.status(403).json(chatBlockedPayload());
  // Presencia: el usuario está activo en el chat.
  markOnline(req.user.id);

  const isPaid = req.user.is_admin === 1 || req.user.subscribed === 1;
  const photoRaw = req.body && req.body.photo;

  /* --- Bloqueo de audios y video: NO se permiten notas de voz ni
   * archivos mp3/mp4 (ni ningún audio/video). Aplica a TODOS los planes,
   * sin excepción y sin opción de pagar con RV. --- */
  const MSG_SIN_AUDIO = "No se permiten audios ni archivos de audio/video 🚫";
  if (photoRaw && /^data:(audio|video)\//i.test(String(photoRaw))) {
    return res.status(400).json({ error: MSG_SIN_AUDIO });
  }

  // Fotos: solo con plan pagado.
  let photoData = null;
  let msgType = "text";
  if (photoRaw) {
    // Usuarios gratuitos: solo texto plano (sin fotos, links ni temas).
    if (!isPaid)
      return res
        .status(403)
        .json({ error: "💎 Esta función es para miembros con plan" });
    const vf = validarFoto(photoRaw);
    if (vf.error) return res.status(400).json({ error: vf.error });
    photoData = vf.photo;
    msgType = "photo";
  }

  // Tema opcional: solo si existe y sigue activo (no expirado).
  let prefix = "";
  const topicId = req.body && req.body.topic_id;
  if (topicId !== undefined && topicId !== null && topicId !== "") {
    const topicName = temaActivoPorId(topicId);
    if (!topicName)
      return res.status(400).json({ error: "Ese tema ya expiró o no existe ⏰" });
    prefix = "#" + topicName + " ";
  }

  // El texto es opcional si hay foto; si hay texto se valida igual.
  const rawText = req.body && req.body.text ? String(req.body.text).trim() : "";
  if (!rawText && !photoData)
    return res.status(400).json({ error: "Escribe algo o envía una foto 💛" });

  let finalText = "";
  if (rawText) {
    const v = validarTexto(prefix + rawText);
    if (v.error) return res.status(400).json({ error: v.error });
    finalText = v.text;
  } else if (prefix) {
    // Solo tema + foto: el prefijo igual se guarda.
    finalText = prefix.trim();
  }

  // Bloqueo de archivos de audio/video en el texto (ej. "escucha.mp3").
  // Aplica a todos los planes, sin excepción.
  if (/\.(mp3|mp4|wav|ogg|m4a|webm|aac|opus)(\s|$|[?#.,;:!])/i.test(finalText)) {
    return res.status(400).json({ error: MSG_SIN_AUDIO });
  }

  /* --- Filtro anti-spam: correos, teléfonos y redes sociales ---
   * Usuarios GRATUITOS: solo texto plano, PERO pueden gastar RV para
   * publicar enlaces (3 RV por mensaje, 10 RV = 3 publicaciones).
   * No pueden enviar fotos ni temas.
   * Usuarios CON PLAN: pueden gastar RV para publicar contenido promocional:
   *   - Mensaje de texto con enlaces: 2 RV por mensaje (10 RV = 5 links).
   *   - Imagen con contenido promocional: bloque de 10 RV = 8 envíos.
   * Las fotos normales (sin contenido promocional) siguen siendo gratis. */
  let isPromo = 0;
  const muteado = mutedPayload(req.user.id);
  if (muteado)
    return res.status(403).json({ error: muteado.code, message: muteado.message });
  const violacion = detectSpam(finalText);
  // El admin publica sin restricciones: sin verificación de enlaces ni cobro de RV.
  const esAdmin = req.user.is_admin === 1;
  if (violacion && !esAdmin) {
    const conPlan = req.user.subscribed === 1 || req.user.is_admin === 1;
    // Gratuitos: no pueden enviar fotos promocionales (solo texto con RV).
    if (!conPlan && msgType === "photo") {
      return res.status(403).json({
        error: "SOLO_PLAN",
        message: "💎 Las fotos son para miembros con plan. Actualiza tu plan para enviar fotos.",
      });
    }
    /* Con plan O gratuito con RV: verificar enlaces y descontar.
     * Gratuitos pagan 3 RV por mensaje (10 RV = 3 publicaciones). */
    /* Todos pueden gastar RV (con plan o sin plan). La tasa depende del plan. */
    {
      /* --- Verificación de enlaces 🔒 ---
       * Antes de descontar RV: el enlace debe ser de una página
       * verificada (anti-phishing/hackers). Si no pasa, se bloquea
       * SIN descontar RV y se registra para revisión del admin. */
      const verif = verifyLinks(finalText);
      if (!verif.ok) {
        try {
          db.prepare(
            `INSERT INTO chat_violations (user_id, attempted_text, violation_type, detail, created_at)
             VALUES (?, ?, 'link no verificado', ?, datetime('now'))`
          ).run(req.user.id, String(finalText || "").slice(0, 500), "motivo: " + verif.motivo + " (" + verif.url + ")");
        } catch (e) { /* no bloquea */ }
        return res.status(403).json({
          error: "LINK_NO_VERIFICADO",
          message: mensajeBloqueo(verif),
        });
      }
      if (msgType === "photo") {
        // Imagen promocional: bloque de 10 RV = 8 envíos.
        const r = trySpendImageSend(req.user.id, req.user);
        if (r.ok) {
          isPromo = 1;
        } else {
          return res.status(402).json({
            error: "NO_RV",
            tipo: "imagen",
            message:
              "💰 Necesitas RV para compartir imágenes promocionales. Recarga aquí (10 RV = 8 imágenes).",
            needsRecharge: true,
          });
        }
      } else {
        // Mensaje de texto promocional: 2 RV por mensaje.
        if (trySpendRV(req.user.id, req.user)) {
          isPromo = 1;
        } else {
          const tasa = conPlan ? "10 RV = 5 publicaciones" : "10 RV = 3 publicaciones";
          return res.status(402).json({
            error: "NO_RV",
            tipo: "texto",
            message: `💰 Necesitas RV para compartir enlaces. Recarga aquí (${tasa}).`,
            needsRecharge: true,
          });
        }
      }
    }
  }

  const recent = db
    .prepare(
      `SELECT COUNT(*) AS n FROM community_comments
       WHERE user_id = ? AND created_at >= datetime('now', '-1 hour')`
    )
    .get(req.user.id).n;
  if (recent >= RATE_PER_HOUR)
    return res
      .status(429)
      .json({ error: "Publicaste muchos comentarios seguidos. Intenta en un rato 💛" });

  const r = db
    .prepare("INSERT INTO community_comments (user_id, text, msg_type, photo_data, is_promo, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(req.user.id, finalText, msgType, photoData, isPromo, messageExpiresAt(req.user, msgType));

  // Republicación automática: los links pagados con RV se republican
  // 2 veces más (a las 2 y 4 horas), marcados como 🔁 repost. Son gratis.
  // El expires_at se desplaza por el mismo intervalo para que el repost
  // expire igual que el mensaje original (las fotos tienen expires_at NULL
  // porque se eliminan a los 30 segundos por antigüedad).
  if (isPromo === 1) {
    try {
      const baseExp = messageExpiresAt(req.user, msgType);
      const desplazar = (ms) =>
        baseExp
          ? new Date(new Date(baseExp.replace(" ", "T") + "Z").getTime() + ms)
              .toISOString()
              .slice(0, 19)
              .replace("T", " ")
          : null;
      const sched = db.prepare(
        `INSERT INTO scheduled_reposts (user_id, text, msg_type, photo_data, expires_at, scheduled_at)
         VALUES (?, ?, ?, ?, ?, datetime('now', ?))`
      );
      sched.run(req.user.id, finalText, msgType, photoData, desplazar(2 * 3600 * 1000), "+120 minutes");
      sched.run(req.user.id, finalText, msgType, photoData, desplazar(4 * 3600 * 1000), "+240 minutes");
    } catch (e) {
      /* no bloquea la publicación */
    }
  }

  res.status(201).json({ ok: true, id: Number(r.lastInsertRowid), promo: isPromo === 1, rv: req.user.is_admin === 1 ? -1 : getRV(req.user.id) });
});

/* GET /api/community/online → usuarios en línea ahora mismo.
 * Devuelve { count, usuarios: [{ nombre (iniciales+país o Guest), foto, avatar }] }.
 * Solo para mostrar en el botón "🟢 N en línea" del chat. Sin nombres reales. */
router.get("/online", requireAuth, (req, res) => {
  markOnline(req.user.id);
  const usuarios = onlineUsers();
  res.json({ count: usuarios.length, usuarios });
});

/* POST /api/community/hide → ocultar un mensaje SOLO para mí.
 * Solo usuarios con plan (mensual/anual) o admin. Ocultamiento personal:
 * el mensaje sigue visible para los demás. Devuelve { ok: true }. */
router.post("/hide", requireAuth, (req, res) => {
  const u = req.user;
  const isPaid = u.is_admin === 1 || u.subscribed === 1;
  if (!isPaid) return res.status(403).json({ error: "Esta función es para miembros con plan 💎" });
  const messageId = Number(req.body && req.body.message_id);
  if (!messageId) return res.status(400).json({ error: "Falta el mensaje." });
  const msg = db.prepare("SELECT id FROM community_comments WHERE id = ?").get(messageId);
  if (!msg) return res.status(404).json({ error: "Mensaje no encontrado." });
  db.prepare("INSERT OR IGNORE INTO hidden_messages (user_id, message_id) VALUES (?, ?)")
    .run(u.id, messageId);
  res.json({ ok: true });
});

/* POST /api/community/unhide → volver a mostrar un mensaje oculto.
 * Solo usuarios con plan o admin. */
router.post("/unhide", requireAuth, (req, res) => {
  const u = req.user;
  const isPaid = u.is_admin === 1 || u.subscribed === 1;
  if (!isPaid) return res.status(403).json({ error: "Esta función es para miembros con plan 💎" });
  const messageId = Number(req.body && req.body.message_id);
  if (!messageId) return res.status(400).json({ error: "Falta el mensaje." });
  db.prepare("DELETE FROM hidden_messages WHERE user_id = ? AND message_id = ?")
    .run(u.id, messageId);
  res.json({ ok: true });
});

/* GET /api/community/hidden → mensajes que YO oculté (para "ver ocultos").
 * Solo usuarios con plan o admin. Devuelve los mismos campos públicos. */
router.get("/hidden", requireAuth, (req, res) => {
  const u = req.user;
  const isPaid = u.is_admin === 1 || u.subscribed === 1;
  if (!isPaid) return res.status(403).json({ error: "Esta función es para miembros con plan 💎" });
  const rows = db
    .prepare(
      `SELECT c.id, c.user_id, c.text, c.created_at, c.msg_type, c.photo_data,
              u.name, u.photo, u.subscribed, u.is_admin, u.country_code
       FROM hidden_messages h
       JOIN community_comments c ON c.id = h.message_id
       JOIN users u ON u.id = c.user_id
       WHERE h.user_id = ?
       ORDER BY h.hidden_at DESC
       LIMIT 50`
    )
    .all(u.id);
  res.json({
    ocultos: rows.map((c) => {
      const paid = c.subscribed === 1 || c.is_admin === 1;
      const pais = String(c.country_code || "").toUpperCase();
      const nombre = paid
        ? (pais ? iniciales(c.name) + " · " + pais : iniciales(c.name))
        : "Guest";
      return {
        id: c.id,
        texto: c.msg_type === "photo" ? "📷 Foto" : c.text,
        fecha: fechaCorta(c.created_at),
        nombre,
        foto: c.photo || null,
        avatar: avatarFor(c.user_id),
      };
    }),
  });
});

/* POST /api/community/heartbeat → el frontend lo llama cada 60s mientras
 * la pestaña de comunidad está abierta. Acumula segundos de uso del día.
 * Devuelve { chatTimeLeft } para que el frontend muestre el temporizador.
 * Plan pagado / admin: { chatTimeLeft: null } (ilimitado). */
router.post("/heartbeat", requireAuth, (req, res) => {
  const u = req.user;
  // Presencia: el usuario tiene la pestaña de comunidad abierta. Va ANTES
  // del retorno temprano para que los usuarios con plan también cuenten.
  markOnline(u.id);
  // Republicaciones automáticas pendientes de links pagados con RV.
  processDueReposts();
  if (u.is_admin === 1 || u.subscribed === 1)
    return res.json({ chatTimeLeft: null });

  const today = utcDate();
  const now = Math.floor(Date.now() / 1000);
  let row = db
    .prepare("SELECT seconds_used, last_heartbeat FROM chat_usage WHERE user_id = ? AND date = ?")
    .get(u.id, today);

  if (!row) {
    db.prepare(
      "INSERT INTO chat_usage (user_id, date, seconds_used, last_heartbeat) VALUES (?, ?, 0, ?)"
    ).run(u.id, today, now);
    return res.json({ chatTimeLeft: CHAT_FREE_SECONDS });
  }

  // Solo se suma el tiempo real entre heartbeats (huecos > 3 min = pestaña
  // cerrada, no se cuentan).
  const delta = now - (row.last_heartbeat || now);
  const add = delta > 0 && delta <= 180 ? delta : 0;
  const used = Math.min(CHAT_FREE_SECONDS, row.seconds_used + add);
  db.prepare(
    "UPDATE chat_usage SET seconds_used = ?, last_heartbeat = ? WHERE user_id = ? AND date = ?"
  ).run(used, now, u.id, today);

  res.json({ chatTimeLeft: Math.max(0, CHAT_FREE_SECONDS - used) });
});

module.exports = { router, avatarFor, validarTexto, chatAccess, CHAT_FREE_SECONDS, processDueReposts };
