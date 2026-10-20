/* Reaviva — envío de correos (verificación de cuenta y bienvenida).
 *
 * Proveedor: Resend (https://resend.com) vía su API REST — sin dependencias
 * extra, solo fetch. La API key se lee de RESEND_API_KEY.
 *
 * Si RESEND_API_KEY no está configurada, NO se crashea: el correo se
 * registra en el log del servidor y el panel de administrador muestra el
 * link de verificación manualmente (ver /api/admin/users).
 */
"use strict";

const SITE_URL = (process.env.SITE_URL || "https://www.reavivaapp.com").replace(/\/$/, "");
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const FROM = "Reaviva <noreply@reavivaapp.com>";

function isEmailConfigured() {
  return !!RESEND_API_KEY;
}

function verificationUrl(token) {
  return SITE_URL + "/api/auth/verify?token=" + encodeURIComponent(token);
}

/* Plantilla base del correo: cálida, con la marca Reaviva. */
function emailShell(title, bodyHtml) {
  return (
    `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1.0"></head>` +
    `<body style="margin:0;padding:0;background:#faf6f1;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;">` +
    `<div style="max-width:560px;margin:0 auto;padding:32px 20px;">` +
    `<div style="text-align:center;margin-bottom:24px;">` +
    `<div style="font-size:1.6rem;font-weight:800;color:#4a3728;">Reaviva<span style="color:#c4704f;">.</span></div>` +
    `<div style="font-size:.8rem;color:#7a6252;">30 días para soltar el dolor y recuperar tu paz</div>` +
    `</div>` +
    `<div style="background:#ffffff;border-radius:20px;padding:32px 28px;box-shadow:0 4px 20px rgba(74,55,40,.08);">` +
    `<h1 style="color:#4a3728;font-size:1.35rem;margin:0 0 16px;">${title}</h1>` +
    bodyHtml +
    `</div>` +
    `<p style="text-align:center;font-size:.75rem;color:#7a6252;margin-top:20px;">` +
    `Reaviva — tu proceso de sanación, un día a la vez 💛</p>` +
    `</div></body></html>`
  );
}

function buttonHtml(url, label) {
  return (
    `<div style="text-align:center;margin:26px 0;">` +
    `<a href="${url}" style="display:inline-block;background:#c4704f;color:#ffffff;` +
    `text-decoration:none;font-weight:700;padding:14px 34px;border-radius:12px;font-size:1rem;">${label}</a>` +
    `</div>`
  );
}

/* Envía un correo vía Resend. No bloquea: devuelve una promesa que
 * nunca rechaza de forma fatal (los errores se registran en el log). */
async function sendEmail({ to, subject, html }) {
  if (!isEmailConfigured()) {
    console.log(`[email] RESEND_API_KEY no configurada — correo NO enviado a ${to} (asunto: "${subject}")`);
    return { sent: false, reason: "no-api-key" };
  }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + RESEND_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM, to, subject, html }),
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      console.error(`[email] Resend devolvió ${r.status}: ${t.slice(0, 200)}`);
      return { sent: false, reason: "resend-" + r.status };
    }
    const j = await r.json().catch(() => ({}));
    console.log(`[email] enviado a ${to} (id: ${j.id || "?"})`);
    return { sent: true, id: j.id };
  } catch (e) {
    console.error(`[email] error enviando a ${to}: ${e.message}`);
    return { sent: false, reason: e.message };
  }
}

/* Correo 1: verificación de cuenta tras el registro. */
function sendVerificationEmail({ to, name, token }) {
  const url = verificationUrl(token);
  const safeName = String(name || "amigo/a").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
  if (!isEmailConfigured()) {
    console.log(`[email] link de verificación para ${to}: ${url}`);
  }
  const html = emailShell(
    `Hola ${safeName} 💛`,
    `<p style="color:#4a3728;line-height:1.6;">Gracias por crear tu cuenta en <b>Reaviva</b>. ` +
    `Estás a un clic de empezar tu programa de 30 días para soltar el dolor y recuperar tu paz.</p>` +
    `<p style="color:#4a3728;line-height:1.6;">Confirma tu correo para activar tu cuenta:</p>` +
    buttonHtml(url, "Confirmar mi cuenta") +
    `<p style="font-size:.85rem;color:#7a6252;line-height:1.6;">Si el botón no funciona, copia y pega este link en tu navegador:<br>` +
    `<a href="${url}" style="color:#c4704f;word-break:break-all;">${url}</a></p>` +
    `<p style="font-size:.85rem;color:#7a6252;">Si no creaste esta cuenta, ignora este correo.</p>`
  );
  // Fire-and-forget: el registro no debe esperar al correo.
  sendEmail({ to, subject: "Confirma tu cuenta en Reaviva 💛", html }).catch(() => {});
}

/* Correo 2: bienvenida tras confirmar la cuenta. */
function sendWelcomeEmail({ to, name }) {
  const safeName = String(name || "amigo/a").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
  const loginUrl = SITE_URL + "/";
  const html = emailShell(
    `¡Tu cuenta Reaviva está activa! 🎉`,
    `<p style="color:#4a3728;line-height:1.6;">Hola ${safeName},</p>` +
    `<p style="color:#4a3728;line-height:1.6;">Tu correo quedó confirmado y tu cuenta ya está <b>activa</b>. ` +
    `Ya puedes entrar con tu correo y tu contraseña cuando quieras.</p>` +
    `<p style="color:#4a3728;line-height:1.6;">Esto es lo que te espera:</p>` +
    `<ul style="color:#4a3728;line-height:1.8;">` +
    `<li>🎁 <b>7 días gratis</b> para empezar sin compromiso</li>` +
    `<li>📅 Un <b>programa guiado de 30 días</b>, un paso a la vez</li>` +
    `<li>📓 Tu diario emocional y tu progreso personal</li>` +
    `</ul>` +
    buttonHtml(loginUrl, "Entrar a mi cuenta") +
    `<p style="font-size:.85rem;color:#7a6252;">Nos alegra que estés aquí. Un día a la vez 💛</p>`
  );
  // Fire-and-forget.
  sendEmail({ to, subject: "¡Tu cuenta Reaviva está activa! 🎉", html }).catch(() => {});
}

/* Correo: el administrador asignó/cambió/quitó el plan manualmente.
 * El usuario recibe TODOS los beneficios del plan (acceso vía
 * users.plan_type) + el bono RV (+50 mensual / +200 anual) y este aviso. */
function sendPlanChangedEmail({ to, name, plan, bonus }) {
  const safeName = String(name || "amigo/a").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
  const loginUrl = SITE_URL + "/";
  let subject, html;
  if (plan === "monthly" || plan === "annual") {
    const esAnual = plan === "annual";
    const beneficios = esAnual
      ? `<li>⭐ <b>Todo el programa de 30 días</b> sin límites</li>` +
        `<li>💬 Comunidad y <b>mensajes privados</b> con videollamada 📹 y archivos</li>` +
        `<li>🔗 Enlaces promocionales a solo 2 RV</li>` +
        `<li>⏰ Tus mensajes duran 24 horas</li>`
      : `<li>💳 <b>Todo el programa de 30 días</b> sin límites</li>` +
        `<li>💬 Comunidad y <b>mensajes privados</b></li>` +
        `<li>🔗 Enlaces promocionales a solo 2 RV</li>` +
        `<li>⏰ Tus mensajes duran 5 horas</li>`;
    subject = esAnual ? "¡Tu plan Anual está activo! ⭐" : "¡Tu plan Mensual está activo! 🎉";
    html = emailShell(
      subject,
      `<p style="color:#4a3728;line-height:1.6;">Hola ${safeName},</p>` +
      `<p style="color:#4a3728;line-height:1.6;">¡Buenas noticias! Tu cuenta ahora tiene el <b>plan ${esAnual ? "Anual" : "Mensual"}</b> de Reaviva activo, con todos sus beneficios:</p>` +
      `<ul style="color:#4a3728;line-height:1.8;">${beneficios}</ul>` +
      (bonus ? `<p style="color:#4a3728;line-height:1.6;">🎁 Además te regalamos <b>${bonus} RV</b>, que ya están en tu cuenta.</p>` : "") +
      buttonHtml(loginUrl, "Entrar a mi cuenta") +
      `<p style="font-size:.85rem;color:#7a6252;">Aprovéchalo al máximo. Un día a la vez 💛</p>`
    );
  } else {
    subject = "Tu plan de Reaviva fue actualizado";
    html = emailShell(
      `Tu plan fue actualizado`,
      `<p style="color:#4a3728;line-height:1.6;">Hola ${safeName},</p>` +
      `<p style="color:#4a3728;line-height:1.6;">Te informamos que tu plan de pago en <b>Reaviva</b> fue retirado y tu cuenta volvió al <b>plan gratuito</b>. Tu saldo de RV se conserva.</p>` +
      `<p style="color:#4a3728;line-height:1.6;">Cuando quieras, puedes volver a activar un plan desde la app.</p>` +
      buttonHtml(loginUrl, "Entrar a mi cuenta") +
      `<p style="font-size:.85rem;color:#7a6252;">Gracias por estar aquí 💛</p>`
    );
  }
  sendEmail({ to, subject, html }).catch(() => {});
}

module.exports = {
  isEmailConfigured,
  verificationUrl,
  sendEmail,
  sendVerificationEmail,
  sendWelcomeEmail,
  sendLoginAlertEmail,
  sendPlanChangedEmail,
  SITE_URL,
};

/* Correo 3: alerta de nuevo inicio de sesión.
 * Se envía SOLO si la IP es distinta a la del último login registrado
 * (para no spamear al usuario que entra todos los días desde su casa).
 * Fire-and-forget: nunca bloquea el login. */
function sendLoginAlertEmail({ to, name, ip, country, city, device }) {
  const safeName = String(name || "amigo/a").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
  const safeIp = String(ip || "desconocida").replace(/[<>&"]/g, "");
  const safeLoc = [city, country].filter(Boolean).join(", ") || "Ubicación desconocida";
  const fecha = new Date().toLocaleString("es-ES", {
    day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
  const html = emailShell(
    `🔐 Nuevo inicio de sesión en tu cuenta`,
    `<p style="color:#4a3728;line-height:1.6;">Hola ${safeName},</p>` +
    `<p style="color:#4a3728;line-height:1.6;">Detectamos un inicio de sesión en tu cuenta de <b>Reaviva</b> desde un lugar o dispositivo diferente al habitual:</p>` +
    `<div style="background:#faf6f1;border-radius:12px;padding:16px 20px;margin:16px 0;line-height:2;">` +
    `<div>📅 <b>Fecha:</b> ${fecha}</div>` +
    `<div>📍 <b>Ubicación:</b> ${safeLoc.replace(/[<>&"]/g, "")}</div>` +
    `<div>🌐 <b>Dirección IP:</b> ${safeIp}</div>` +
    `<div>📱 <b>Dispositivo:</b> ${String(device || "desconocido").replace(/[<>&"]/g, "")}</div>` +
    `</div>` +
    `<p style="color:#4a3728;line-height:1.6;"><b>¿Fuiste tú?</b> Si reconoces este acceso, no necesitas hacer nada.</p>` +
    `<p style="color:#a33;line-height:1.6;"><b>¿No fuiste tú?</b> Cambia tu contraseña inmediatamente desde tu perfil y avísanos.</p>`
  );
  sendEmail({ to, subject: "🔐 Nuevo inicio de sesión en tu cuenta Reaviva", html }).catch(() => {});
}
