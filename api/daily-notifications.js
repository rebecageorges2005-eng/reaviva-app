/* Reaviva — notificación DIARIA por día del programa (correo + aviso en app).
 *
 * Idea de Georges (25 oct 2026): cada día, cada usuario recibe un aviso
 * personalizado con su día actual del programa, cuántos días lleva
 * completados, su racha y la tarea de ese día, con enlace a la app.
 *
 * Canales (los dos, como eligió Georges):
 *   1. Correo diario (Resend, mismo patrón de api/email.js).
 *   2. Aviso dentro de la app al entrar (tabla user_notifications +
 *      banner en la pantalla principal, que se cierra y marca leído).
 *
 * Reglas:
 *   - Destinatarios: usuarios VERIFICADOS, no admin (is_admin = 1
 *     excluido), no baneados y sin bloqueo de cuenta vigente
 *     (disabled_until / locked_until en el futuro). Incluye usuarios
 *     en prueba (7 días gratis) y con plan: el aviso es de progreso,
 *     no de cobro.
 *   - Idempotencia: la tabla user_notifications tiene UNIQUE
 *     (user_id, day_key). Un mismo usuario NUNCA recibe dos veces el
 *     aviso del mismo día: si el INSERT se ignora, no se manda correo.
 *   - El "día" es calendario en America/La_Paz, NO en UTC: un aviso
 *     generado a las 8am de Bolivia es del día boliviano, aunque en
 *     UTC ya sea otro día.
 *   - Día del programa: MISMA lógica que el backend existente
 *     (api/routes/progress.js y api/routes/admin.js): días desde
 *     program_start + 1, sin tope en 30 (Fase 2 sigue contando).
 *     Si el usuario aún no tiene program_start, se usa su fecha de
 *     registro (created_at) SIN modificar la base: no se escribe
 *     program_start aquí, eso lo hace /api/progress al entrar.
 *   - Tarea del día: se lee en tiempo de ejecución desde los mismos
 *     archivos que usa el frontend (web/program.js para la Fase 1 y
 *     web/program2.js para la Fase 2), así el título nunca se
 *     desincroniza de lo que ve el usuario dentro de la app. Si la
 *     lectura falla, se usa un título genérico ("Tu día X") y el
 *     enlace a la app, que siempre muestra el contenido completo.
 *   - Contenido 100% secular. No se tocan las formas referidas a la
 *     expareja ni el género de los personajes de los casos: solo se
 *     usan título y parte del día, con el marcador {a/b} resuelto
 *     según el género del usuario (igual que gtext() en el frontend).
 *
 * Disparo: NO hay cron dentro del servidor. Se dispara desde fuera
 *   con POST /api/admin/daily-notifications (JWT admin, ver
 *   api/routes/notifications.js) o con el script
 *   api/scripts/send-daily-notifications.js. El despliegue y el cron
 *   externo los hace el agente principal (ver DAILY_NOTIFICATIONS.md).
 */
"use strict";

const fs = require("fs");
const path = require("path");

const db = require("./db");
const { sendDailyProgressEmail } = require("./email");

const TZ = "America/La_Paz";
const SITE_URL = (process.env.SITE_URL || "https://www.reavivaapp.com").replace(/\/$/, "");

/* Fecha YYYY-MM-DD en America/La_Paz para un instante dado. */
function dayKeyLaPaz(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

/* Convierte una fecha YYYY-MM-DD a día UTC (medianoche) para restar días. */
function utcDay(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ""));
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/* Fecha de inicio del programa en La Paz: program_start si existe;
 * si no, la fecha de registro (created_at, que viene en UTC) pasada
 * a fecha de La Paz. Nunca devuelve null: sin datos, día 1. */
function startKeyFor(user, todayKey) {
  if (user.program_start) return String(user.program_start).slice(0, 10);
  if (user.created_at) {
    const d = new Date(String(user.created_at).replace(" ", "T") + "Z");
    if (!isNaN(d)) return dayKeyLaPaz(d);
  }
  return todayKey;
}

/* Día actual del programa (misma fórmula que progress.js: diff + 1,
 * mínimo 1, sin tope en 30). */
function programDayFor(user, todayKey) {
  const start = utcDay(startKeyFor(user, todayKey));
  const today = utcDay(todayKey);
  if (start === null || today === null) return 1;
  return Math.max(1, Math.floor((today - start) / 86400000) + 1);
}

/* Racha: misma fórmula que admin.js (calcularRacha): consecutivos
 * terminando en el mayor día completado <= día actual. */
function streakFor(doneDays, currentDay) {
  const arr = doneDays.slice().sort((a, b) => a - b);
  let max = 0;
  for (const x of arr) if (x <= currentDay) max = Math.max(max, x);
  let n = 0;
  while (arr.includes(max - n)) n++;
  return n;
}

/* Info de Fase 2: MISMA fórmula que program.js / program2.js. */
function phase2Info(day) {
  if (day <= 30) return null;
  const f2 = day - 30;
  const cyc0 = Math.floor((f2 - 1) / 7);
  return {
    cycle: cyc0 + 1,
    cycleDay: ((f2 - 1) % 7) + 1,
    vuelta: Math.floor(cyc0 / 8) + 1,
    themeIndex: cyc0 % 8,
  };
}

/* Resuelve {a/b} según género, igual que gtext() del frontend. */
function gtext(str, gender) {
  return String(str || "").replace(/\{([^\/}]+)\/([^}]+)\}/g, (_, a, b) => (gender === "F" ? b : a));
}

/* Lee los títulos desde los archivos del frontend (única fuente).
 * Devuelve { fase1: [{day, part, title}], f2Themes: [nombre],
 * f2Titles: [titulo x 56 en orden de temas] } o null si no se pudo. */
function loadDayTitles() {
  try {
    const dir = process.env.FRONTEND_DIR
      ? path.resolve(process.env.FRONTEND_DIR)
      : path.join(__dirname, "../web");
    const p1 = fs.readFileSync(path.join(dir, "program.js"), "utf8");
    const p2 = fs.readFileSync(path.join(dir, "program2.js"), "utf8");
    const fase1 = [...p1.matchAll(/\{ day: (\d+), part: "([^"]+)", title: "([^"]+)"/g)]
      .map((m) => ({ day: Number(m[1]), part: m[2], title: m[3] }));
    const f2Themes = [...p2.matchAll(/nombre: "([^"]+)"/g)].map((m) => m[1]);
    const f2Titles = [...p2.matchAll(/titulo: "([^"]+)"/g)].map((m) => m[1]);
    if (fase1.length < 30 || f2Themes.length < 8 || f2Titles.length < 56) return null;
    return { fase1, f2Themes, f2Titles };
  } catch (e) {
    return null;
  }
}

/* Título y parte de la tarea de un día dado (o genérico si no se leyó). */
function taskFor(day, gender, titles) {
  if (day <= 30 && titles) {
    const p = titles.fase1.find((x) => x.day === day);
    if (p) return { part: p.part, title: gtext(p.title, gender) };
  }
  if (day > 30 && titles) {
    const info = phase2Info(day);
    const title = titles.f2Titles[info.themeIndex * 7 + (info.cycleDay - 1)];
    const theme = titles.f2Themes[info.themeIndex];
    if (title && theme) {
      return {
        part: "Fase 2 · Ciclo " + info.cycle + " — " + theme +
          (info.vuelta > 1 ? " · Vuelta " + info.vuelta : ""),
        title: gtext(title, gender),
      };
    }
  }
  return { part: day <= 30 ? "Programa de 30 días" : "Fase 2 · Seguir sanando", title: null };
}

/* Primer día pendiente: menor día no completado <= día de
 * calendario, o null si todos los días hasta el calendario están
 * completados. La cadena es la misma que en progress.js: TODOS los
 * anteriores deben estar completados, no solo el inmediato. */
function pendingDayFor(doneDays, calendarDay) {
  const done = new Set(doneDays.map(Number));
  for (let d = 1; d <= calendarDay; d++) if (!done.has(d)) return d;
  return null;
}

/* Construye el aviso personalizado de un usuario para un día dado.
 * REGLA DE SECUENCIA (26 oct 2026, Georges): si hay un día
 * pendiente, el aviso (correo + banner en app) se refiere a ESE día
 * pendiente y a su tarea ("Tienes pendiente el día X: <tarea>"),
 * NO al día de calendario, aunque el calendario ya haya avanzado.
 * Sin pendiente, comportamiento anterior (día de calendario). */
function buildNotification(user, doneDays, todayKey, titles) {
  const calendarDay = programDayFor(user, todayKey);
  const pending = pendingDayFor(doneDays, calendarDay);
  const programDay = pending || calendarDay;
  const completed = doneDays.length;
  const streak = streakFor(doneDays, calendarDay);
  const task = taskFor(programDay, user.gender, titles);
  const name = String(user.name || "amigo/a").split(" ")[0];
  const title = pending
    ? `Tienes pendiente el día ${programDay} 💛`
    : (programDay <= 30
      ? `Tu día ${programDay} de 30 te espera 💛`
      : `Tu día ${programDay} · Seguir sanando 💛`);
  const lines = [
    `Hola ${name},`,
    pending
      ? `Tienes pendiente el día ${programDay}${programDay <= 30 ? " de 30" : ""} en Reaviva.`
      : (programDay <= 30
        ? `Hoy es tu día ${programDay} de 30 en Reaviva.`
        : `Hoy es tu día ${programDay} en Reaviva (${task.part}).`),
    `Llevas ${completed} día${completed === 1 ? "" : "s"} completado${completed === 1 ? "" : "s"}` +
      (streak > 0 ? ` y una racha de ${streak} día${streak === 1 ? "" : "s"} 🔥.` : "."),
  ];
  if (task.title) lines.push(pending ? `La tarea pendiente: “${task.title}”.` : `La tarea de hoy: “${task.title}”.`);
  lines.push(`Entra y continúa tu día ${programDay}: ${SITE_URL}`);
  lines.push("Un día a la vez 💛");
  return {
    dayKey: todayKey,
    programDay,
    calendarDay,
    pendingDay: pending,
    pending: pending !== null,
    phase: programDay <= 30 ? 1 : 2,
    part: task.part,
    taskTitle: task.title,
    completedCount: completed,
    streak,
    title,
    body: lines.join("\n"),
  };
}

async function ensureTable() {
  await db.exec(`CREATE TABLE IF NOT EXISTS user_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    day_key TEXT NOT NULL,
    program_day INTEGER NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    read_at TEXT,
    UNIQUE (user_id, day_key),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_user_notifications_user
    ON user_notifications(user_id, read_at)`);
}

/* Genera el aviso del día para todos los destinatarios elegibles.
 *   opts.dayKey: YYYY-MM-DD en La Paz (por defecto, hoy en La Paz).
 *   opts.dryRun: si es true, solo calcula y NO inserta ni manda correos.
 * Devuelve { dayKey, total, generated, emailed, skipped, failures }.
 *   total: usuarios elegibles. generated: avisos nuevos creados.
 *   emailed: correos enviados con éxito. skipped: ya tenían aviso hoy.
 *   failures: [{ userId, reason }] (correo fallido o error por usuario;
 *   el resto sigue: un fallo no detiene el lote). */
async function generateDailyNotifications(opts = {}) {
  const todayKey = opts.dayKey || dayKeyLaPaz(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(todayKey)) {
    throw new Error("dayKey inválido (esperado YYYY-MM-DD)");
  }
  await ensureTable();
  const titles = loadDayTitles();
  const users = await db.all(
    `SELECT id, email, name, gender, program_start, created_at
     FROM users
     WHERE email_verified = 1
       AND is_admin != 1
       AND banned != 1
       AND (disabled_until IS NULL OR disabled_until <= datetime('now'))
       AND (locked_until IS NULL OR locked_until <= datetime('now'))
     ORDER BY id ASC`
  );
  const summary = {
    dayKey: todayKey, total: users.length,
    generated: 0, emailed: 0, skipped: 0, failures: [],
  };
  for (const user of users) {
    try {
      const doneRows = await db.all(
        "SELECT day FROM progress WHERE user_id = ? ORDER BY day", user.id);
      const notif = buildNotification(user, doneRows.map((r) => r.day), todayKey, titles);
      /* Primero se consulta: así un reintento no consume IDs ni
       * intenta insertar, y el dry-run cuenta solo lo que de verdad
       * se generaría. El UNIQUE(user_id, day_key) queda como
       * red de seguridad ante dos disparos simultáneos. */
      const existing = await db.get(
        "SELECT id FROM user_notifications WHERE user_id = ? AND day_key = ?",
        user.id, todayKey);
      if (existing) { summary.skipped++; continue; }
      if (opts.dryRun) { summary.generated++; continue; }
      const r = await db.run(
        `INSERT OR IGNORE INTO user_notifications
         (user_id, day_key, program_day, title, body)
         VALUES (?, ?, ?, ?, ?)`,
        user.id, todayKey, notif.programDay, notif.title, notif.body);
      if (r.changes === 0) { summary.skipped++; continue; }
      summary.generated++;
      const sent = await sendDailyProgressEmail({
        to: user.email, name: user.name,
        programDay: notif.programDay, phase: notif.phase, part: notif.part,
        taskTitle: notif.taskTitle, completedCount: notif.completedCount,
        streak: notif.streak, pending: notif.pending,
      });
      if (sent && sent.sent) summary.emailed++;
      else summary.failures.push({ userId: user.id, reason: "email:" + (sent ? sent.reason : "desconocido") });
    } catch (e) {
      summary.failures.push({ userId: user.id, reason: e.message });
    }
  }
  return summary;
}

module.exports = {
  TZ, SITE_URL,
  dayKeyLaPaz, programDayFor, streakFor, phase2Info,
  pendingDayFor,
  buildNotification, generateDailyNotifications, ensureTable,
};
