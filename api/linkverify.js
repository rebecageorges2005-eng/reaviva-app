/* Reaviva API — verificación de enlaces para mensajes promocionales 🔒
 *
 * Cuando un usuario paga RV para compartir un enlace en el chat, el
 * enlace debe ser de una página VERIFICADA, para prevenir phishing
 * y hackers.
 *
 * Estrategia (conservadora: ante la duda, se bloquea el enlace):
 * 1. Se extraen todas las URLs del texto.
 * 2. Chequeos de peligro (bloquean SIEMPRE, aunque el dominio esté
 *    en la lista de verificados):
 *    - Acortadores de URL (ocultan el destino real).
 *    - Direcciones IP como dominio.
 *    - "@" en la URL (phishing tipo http://legit.com@evil.com).
 *    - Punycode (xn--) — ataques homógrafos.
 *    - Esquemas peligrosos (javascript:, data:).
 *    - Demasiados subdominios (sospechoso).
 * 3. El dominio (o su dominio padre) debe estar en la tabla
 *    verified_domains, gestionada por el administrador.
 * 4. Si alguna URL no pasa → se bloquea el mensaje, SIN descontar RV.
 */
"use strict";

const db = require("./db");

/* Acortadores conocidos: ocultan el destino real → siempre bloqueados. */
const SHORTENERS = [
  "bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "buff.ly",
  "cutt.ly", "rb.gy", "shorturl.at", "rebrand.ly", "s.id", "tiny.cc",
  "shorte.st", "adf.ly", "bc.vc", "bit.do", "t.ly", "clicky.me", "lnkd.in",
];

const URL_HTTP_RE = /\bhttps?:\/\/[^\s<>"']+/gi;
// URLs sin protocolo (ej. "mitienda.com", "www.ejemplo.com/x").
const URL_BARE_RE =
  /\b(?:www\.[a-z0-9][a-z0-9\-.]*\.[a-z]{2,}|[a-z0-9][a-z0-9\-]*\.(?:com|net|org|io|co|mx|es|app|store|shop|online|site|link|bio|me|tv|dev|info|biz|ly|cc|at|st|vc|do)(?:\/[^\s]*)?)/gi;

/* Extrae todas las URLs del texto (con y sin protocolo). */
function extractUrls(text) {
  const urls = [];
  const seen = new Set();
  const add = (u) => {
    const k = u.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      urls.push(u);
    }
  };
  for (const m of String(text || "").matchAll(URL_HTTP_RE)) add(m[0]);
  for (const m of String(text || "").matchAll(URL_BARE_RE)) {
    const u = m[0];
    // Evitar duplicados con las ya extraídas con protocolo.
    if (![...seen].some((x) => x.includes(u.toLowerCase()))) add("http://" + u);
  }
  return urls;
}

/* Parsea el dominio de una URL. Devuelve null si no es parseable. */
function domainOf(urlStr) {
  try {
    const u = new URL(urlStr);
    let h = u.hostname.toLowerCase().trim();
    if (h.startsWith("www.")) h = h.slice(4);
    if (!h) return null;
    return { host: h, url: u };
  } catch (e) {
    return null;
  }
}

/* Dominios verificados (caché en memoria; se invalida al modificar). */
let cacheDominios = null;
async function dominiosVerificados() {
  if (cacheDominios) return cacheDominios;
  try {
    const rows = await db.all("SELECT domain FROM verified_domains");
    cacheDominios = new Set(rows.map((r) => String(r.domain).toLowerCase().trim()));
  } catch (e) {
    cacheDominios = new Set();
  }
  return cacheDominios;
}
function invalidarCache() {
  cacheDominios = null;
}

/* ¿El dominio (o alguno de sus dominios padre) está verificado?
 * Ej. si "youtube.com" está verificado, "music.youtube.com" también pasa. */
function dominioVerificado(host) {
  const lista = dominiosVerificados();
  let h = host;
  while (h) {
    if (lista.has(h)) return true;
    const i = h.indexOf(".");
    if (i < 0) break;
    h = h.slice(i + 1);
  }
  return false;
}

/* Normaliza un dominio ingresado por el admin (quita protocolo, www,
 * ruta y espacios). */
function normalizarDominio(input) {
  let d = String(input || "").trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "").replace(/^www\./, "");
  d = d.split("/")[0].split("?")[0].split("#")[0].split(":")[0].trim();
  return d;
}

/* verifyLinks(text) → { ok: true } | { ok: false, url, motivo }
 * motivo: "acortador" | "ip" | "phishing" | "punycode" |
 *         "sospechosa" | "no_verificada" | "invalida" */
function verifyLinks(text) {
  const urls = extractUrls(text);
  for (const raw of urls) {
    // 0. Esquemas peligrosos.
    if (/^\s*(javascript|data|vbscript)\s*:/i.test(raw)) {
      return { ok: false, url: raw.slice(0, 60), motivo: "phishing" };
    }
    const d = domainOf(raw);
    if (!d) return { ok: false, url: raw.slice(0, 60), motivo: "invalida" };
    const { host } = d;

    // 1. Acortadores → bloqueados siempre (ocultan el destino real).
    if (SHORTENERS.includes(host) || SHORTENERS.some((s) => host === s || host.endsWith("." + s))) {
      return { ok: false, url: host, motivo: "acortador" };
    }
    // 2. IP como dominio → bloqueado.
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
      return { ok: false, url: host, motivo: "ip" };
    }
    // 3. "@" en la URL → posible phishing → bloqueado.
    if (raw.includes("@")) {
      return { ok: false, url: host, motivo: "phishing" };
    }
    // 4. Punycode (ataques homógrafos) → bloqueado.
    if (host.includes("xn--")) {
      return { ok: false, url: host, motivo: "punycode" };
    }
    // 5. Demasiados subdominios → sospechoso.
    if (host.split(".").length > 5) {
      return { ok: false, url: host, motivo: "sospechosa" };
    }
    // 6. Debe estar en la lista de dominios verificados.
    if (!dominioVerificado(host)) {
      return { ok: false, url: host, motivo: "no_verificada" };
    }
  }
  return { ok: true };
}

/* Mensaje amigable según el motivo del bloqueo. */
function mensajeBloqueo(verif) {
  const base = "🔒 Por tu seguridad, solo se permiten links de páginas verificadas.";
  switch (verif.motivo) {
    case "acortador":
      return "🔒 Los acortadores de enlaces no están permitidos (ocultan el destino real). " + base;
    case "ip":
    case "phishing":
    case "punycode":
      return "🔒 Este enlace parece peligroso y fue bloqueado por seguridad.";
    case "no_verificada":
      return base + " (" + verif.url + " no está verificada).";
    default:
      return base;
  }
}

module.exports = {
  extractUrls,
  domainOf,
  verifyLinks,
  mensajeBloqueo,
  dominiosVerificados,
  invalidarCache,
  normalizarDominio,
};
