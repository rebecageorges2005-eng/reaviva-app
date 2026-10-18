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

module.exports = {
  isEmailConfigured,
  verificationUrl,
  sendEmail,
  sendVerificationEmail,
  sendWelcomeEmail,
  SITE_URL,
};
