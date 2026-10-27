/* Disparo alternativo de la notificación diaria del programa.
 *
 * Uso recomendado en producción: POST /api/admin/daily-notifications
 * con JWT admin (ver api/DAILY_NOTIFICATIONS.md) — el cron externo
 * del agente principal llama a ese endpoint, no a este script.
 *
 * Este script existe para pruebas locales y corridas controladas.
 * ATENCIÓN: usa la misma base de datos que el servidor (Turso si
 * TURSO_DATABASE_URL y TURSO_AUTH_TOKEN están en el entorno, SQLite
 * local si no). NO lo ejecutes con variables de producción salvo que
 * quieras generar el aviso real de ese día en producción.
 *
 *   node api/scripts/send-daily-notifications.js --dry-run
 *     → solo calcula y muestra cuántos avisos generaría, sin insertar
 *       ni mandar correos.
 *   node api/scripts/send-daily-notifications.js --yes [--day=YYYY-MM-DD]
 *     → genera los avisos y manda los correos. Sin --yes, no hace nada.
 */
"use strict";

const db = require("../db");
const { generateDailyNotifications } = require("../daily-notifications");

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const confirmed = args.includes("--yes");
  const dayArg = args.find((a) => a.startsWith("--day="));
  const dayKey = dayArg ? dayArg.slice("--day=".length) : undefined;
  if (!dryRun && !confirmed) {
    console.log("Sin --dry-run ni --yes: no se genera nada. Ver el encabezado del script.");
    return;
  }
  await db.ready;
  const summary = await generateDailyNotifications({ dayKey, dryRun });
  console.log(JSON.stringify(summary, null, 2));
}

main().then(
  () => process.exit(0),
  (e) => { console.error("[daily-notifications] error:", e.message); process.exit(1); }
);
