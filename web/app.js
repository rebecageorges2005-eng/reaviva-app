/* ============================================================
   REAVIVA — app logic (Phase 1 MVP)
   ============================================================ */

/* ---------- PAYPAL ----------
 * Payments go through the backend (/api/paypal/*) — no keys in the frontend.
 * startCheckout(plan): creates a PayPal subscription on the server and
 * redirects the buyer to PayPal to approve. PayPal returns to ?paypal=ok
 * (or ?paypal=cancel); on return we refresh the subscription status.
 */

/* ---------- constants ---------- */
const LS = {
  user:    "reaviva_user",      // {email, name}
  start:   "reaviva_start",     // ISO date the program started
  done:    "reaviva_done",      // [dayNumbers completed]
  journal: "reaviva_journal"    // { "YYYY-MM-DD": {mood, text} }
};
const TRIAL_DAYS = 7;
const MOODS = [
  {e:"😞", l:"Muy mal"}, {e:"😟", l:"Mal"}, {e:"😐", l:"Más o menos"},
  {e:"🙂", l:"Bien"}, {e:"😄", l:"Muy bien"}
];

/* ---------- helpers ---------- */
const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const store = {
  get(k, d){ try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } },
  set(k, v){ localStorage.setItem(k, JSON.stringify(v)); }
};
const todayKey = () => new Date().toISOString().slice(0,10);
function toast(msg){
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(t._h); t._h = setTimeout(()=>t.classList.remove("show"), 2600);
}

/* ============================================================
   ALERTA ROJA DE ANTI-SPAM 🚩
   Banner grande y muy visible (no un toast sutil) cuando el servidor
   bloquea un mensaje por spam: strikes 1/2 o muteo definitivo.
   ============================================================ */
function showStrikeBanner(message){
  let b = $("#strike-banner");
  if(!b){
    b = document.createElement("div");
    b.id = "strike-banner";
    b.className = "strike-banner";
    const wrap = $("#community-wrap");
    if(wrap && wrap.parentNode) wrap.parentNode.insertBefore(b, wrap);
    else return toast(message);
  }
  b.innerHTML = `<span class="strike-flag">🚩</span><span>${esc(message)}</span>
    <button class="strike-close" onclick="hideStrikeBanner()" aria-label="Cerrar">✕</button>`;
  b.style.display = "flex";
  clearTimeout(b._h);
  b._h = setTimeout(hideStrikeBanner, 12000);
  b.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function hideStrikeBanner(){
  const b = $("#strike-banner");
  if(b) b.style.display = "none";
}

/* Deshabilita el compositor del chat (usuario muteado: solo lectura). */
function disableCommunityComposer(){
  const ta = $("#community-text");
  const btn = document.querySelector("#community-wrap .community-composer .btn-primary");
  const photoBtn = $("#photo-btn");
  const emojiBtn = $("#emoji-btn");
  const linkBtn = $("#link-btn");
  const topicBtn = $("#topic-add-btn");
  if(ta){ ta.disabled = true; ta.placeholder = "🚩 Solo puedes ver los mensajes (chat deshabilitado)"; }
  if(btn){ btn.disabled = true; btn.style.opacity = ".5"; }
  if(photoBtn) photoBtn.style.display = "none";
  if(emojiBtn) emojiBtn.style.display = "none";
  if(linkBtn) linkBtn.style.display = "none";
  if(topicBtn) topicBtn.style.display = "none";
  let note = $("#muted-note");
  if(!note){
    note = document.createElement("div");
    note.id = "muted-note";
    note.className = "muted-note";
    const comp = document.querySelector("#community-wrap .community-composer");
    if(comp) comp.appendChild(note);
  }
  if(note) note.textContent = "🚩 Tu capacidad de escribir está deshabilitada. Solo puedes ver los mensajes.";
}

/* Solo lectura: prueba culminada ("trial") o cobro vencido sin RV ("billing").
 * Se deshabilita todo el compositor (texto, fotos, links, temas, emojis):
 * el usuario solo puede VER el chat grupal hasta actualizar su plan/pago. */
function applyReadOnlyUI(kind){
  const esBilling = kind === "billing";
  const ta = $("#community-text");
  const btn = document.querySelector("#community-wrap .community-composer .btn-primary");
  const photoBtn = $("#photo-btn"), emojiBtn = $("#emoji-btn"), linkBtn = $("#link-btn"), topicBtn = $("#topic-add-btn");
  if(ta){ ta.disabled = true; ta.placeholder = esBilling
    ? "💳 Actualiza tu pago para seguir participando — solo puedes ver los mensajes"
    : "⏰ Tu prueba gratuita terminó — solo puedes ver los mensajes"; }
  if(btn){ btn.disabled = true; btn.style.opacity = ".5"; }
  if(photoBtn) photoBtn.style.display = "none";
  if(emojiBtn) emojiBtn.style.display = "none";
  if(linkBtn) linkBtn.style.display = "none";
  if(topicBtn) topicBtn.style.display = "none";
  let note = $("#trial-note");
  if(!note){
    note = document.createElement("div");
    note.id = "trial-note";
    note.className = "muted-note";
    note.style.cursor = "pointer";
    note.onclick = function(){ openUpgradeModal(esBilling ? "Actualiza tu método de pago 💎 para seguir participando" : "Actualiza tu plan 💎 para seguir participando"); };
    const comp = document.querySelector("#community-wrap .community-composer");
    if(comp) comp.appendChild(note);
  }
  if(note) note.textContent = esBilling
    ? "💳 Tu pago no pudo procesarse. Actualiza tu método de pago para seguir participando (tócalo aquí)"
    : "⏰ Tu prueba gratuita terminó. Actualiza a un plan pago para seguir participando 💎 (tócalo aquí)";
}

/* Inserta un link en el compositor de la comunidad. */
function insertChatLink(){
  const ta = $("#community-text");
  if(!ta || ta.disabled) return;
  let url = prompt("Pega tu link (https://…):", "");
  if(url === null) return;
  url = url.trim();
  if(!url) return;
  if(!/^https?:\/\//i.test(url)) url = "https://" + url;
  try{ new URL(url); }catch(e){ toast("Link inválido 🚫"); return; }
  const add = (ta.value.trim() ? " " : "") + url + " ";
  ta.value = (ta.value + add).slice(0, 500);
  ta.focus();
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}

/* Botón 🔗: habilitado con plan; sin plan solo si tiene RV suficiente (3 RV por mensaje con link);
 * bloqueado tras la prueba o sin RV. */
function refreshLinkBtn(rvBalance){
  const b = $("#link-btn");
  if(!b) return;
  const rv = rvBalance === -1 ? Infinity : (Number(rvBalance) || 0);
  const puede = isPaid() || rv >= 3;
  clearLockedTip(b);
  if(puede){
    b.classList.remove("locked-feature");
    b.style.opacity = "";
    b.onclick = insertChatLink;
  }else{
    b.classList.add("locked-feature");
    b.style.opacity = ".5";
    const msg = isPaid() ? "Publicar un link cuesta 2 RV 💰" : "Publicar un link cuesta 3 RV 💰 — consíguelos refiriendo amigos 🤝";
    b.onclick = function(){ toast(msg); };
    setLockedTip(b, msg);
  }
}

/* Maneja los códigos de error del filtro anti-spam del servidor. */
function handleSpamError(j){
  const code = j && j.error;
  const msg = (j && j.message) || "Contenido no permitido.";
  if(code === "TRIAL_ENDED" || code === "BILLING_BLOCKED"){
    openUpgradeModal(msg);
    return true;
  }
  if(code === "STRIKE_1" || code === "STRIKE_2" || code === "MUTED"){
    showStrikeBanner(msg);
    toast(msg); // también visible si el usuario está en otra pestaña
    if(code === "MUTED") disableCommunityComposer();
    return true;
  }
  if(code === "NO_RV"){
    // Sin RV suficientes: banner rojo EN EL CHAT con botón de recarga.
    showRVBanner(msg);
    return true;
  }
  if(code === "SOLO_PLAN"){
    // Gratuito intentando contenido no permitido: informativo, sin strikes.
    showPlanBanner(msg);
    return true;
  }
  if(code === "LINK_NO_VERIFICADO"){
    // Link de página no verificada: banner rojo con candado, sin descontar RV.
    showStrikeBanner(msg);
    toast(msg);
    return true;
  }
  return false;
}

/* Banner informativo para gratuitos: invita a ver los planes. */
function showPlanBanner(message){
  const b = $("#rv-error");
  if(!b){ toast(message); return; }
  b.innerHTML = `<span>💎</span><span>${esc(message)}</span>
    <button class="btn btn-primary btn-sm" onclick="openPaywall()">Ver planes 💎</button>
    <button class="strike-close" onclick="hideRVBanner()" aria-label="Cerrar">✕</button>`;
  b.style.display = "flex";
  clearTimeout(b._h);
  b._h = setTimeout(hideRVBanner, 15000);
  b.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* ============================================================
   RV — MONEDA PARA PROMOCIONES 💰 (todo dentro del chat)
   10 RV = 5 links · 10 RV = 8 imágenes. 1 link = 2 RV.
   ============================================================ */

/* Banner rojo de error RV con botón "Recargar RV" ahí mismo en el chat. */
function showRVBanner(message){
  const b = $("#rv-error");
  if(!b){ toast(message); return; }
  b.innerHTML = `<span>🚩</span><span>${esc(message)}</span>
    <button class="btn btn-primary btn-sm" onclick="openRVModal()">Recargar RV 💰</button>
    <button class="strike-close" onclick="hideRVBanner()" aria-label="Cerrar">✕</button>`;
  b.style.display = "flex";
  clearTimeout(b._h);
  b._h = setTimeout(hideRVBanner, 15000);
  b.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function hideRVBanner(){
  const b = $("#rv-error");
  if(b) b.style.display = "none";
}

/* --- Usuarios en línea 🟢🔴 ---
 * Botón en la cabecera del chat: verde con el conteo si hay gente en línea,
 * rojo si no hay nadie. Al hacer clic muestra la lista (iniciales + país,
 * sin nombres reales). */
function updateOnlineBtn(count){
  const btn = $("#online-btn");
  if(!btn) return;
  const n = Number(count) || 0;
  btn.classList.toggle("online-green", n > 0);
  btn.classList.toggle("online-red", n === 0);
  btn.innerHTML = n > 0 ? `🟢 ${n} en línea` : `🔴 0 en línea`;
  btn.title = n > 0 ? `${n} persona${n === 1 ? "" : "s"} en el chat ahora — clic para ver` : "Nadie en línea ahora mismo";
}
async function showOnlineList(){
  const modal = $("#online-modal");
  const list = $("#online-list");
  const title = $("#online-modal-title");
  if(!modal || !list) return;
  list.innerHTML = `<p style="color:var(--cocoa-soft)">Cargando…</p>`;
  modal.classList.add("open");
  try{
    const r = await fetch("/api/community/online", { headers: authHeaders() });
    if(!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    const usuarios = j.usuarios || [];
    if(title) title.textContent = usuarios.length > 0 ? `🟢 ${usuarios.length} en línea` : `🔴 Nadie en línea`;
    list.innerHTML = usuarios.length ? usuarios.map(u => {
      const av = (u.foto && String(u.foto).startsWith("data:image/"))
        ? `<img src="${esc(u.foto)}" class="online-avatar-img" alt="">`
        : esc(u.avatar || "💛");
      return `<div class="online-user"><span class="online-avatar">${av}</span><b>${esc(u.nombre)}</b><span class="online-dot">🟢</span></div>`;
    }).join("") : `<p style="text-align:center;color:var(--cocoa-soft)">No hay nadie en línea ahora mismo.<br>¡Vuelve en un rato! 💛</p>`;
  }catch(e){
    list.innerHTML = `<p style="text-align:center;color:#a33">No se pudo cargar la lista</p>`;
  }
}
function closeOnlineModal(){
  const modal = $("#online-modal");
  if(modal) modal.classList.remove("open");
}

/* Saldo de RV en la cabecera del chat (todos pueden comprar y usar RV).
 * Sin plan: el botón está habilitado para comprar RV (tasa 10 RV = 3 links).
 * Con plan: tasa 10 RV = 5 links. */
async function loadRVBalance(){
  const btn = $("#rv-btn");
  if(!btn) return;
  // Todos ven el botón habilitado: los gratuitos también pueden comprar RV.
  btn.style.display = "";
  btn.classList.remove("locked-feature");
  btn.onclick = function(){ openRVModal(); };
  clearLockedTip(btn);
  btn.style.display = "";
  btn.classList.remove("locked-feature");
  btn.onclick = function(){ openRVModal(); };
  clearLockedTip(btn);
  try{
    const r = await fetch("/api/rv/balance", { headers: authHeaders() });
    if(!r.ok) return;
    const j = await r.json();
    const bal = $("#rv-balance");
    // El admin tiene RV ilimitado: muestra ∞.
    if(bal) bal.textContent = (j.unlimited || isAdmin()) ? "∞" : (Number(j.rv) || 0);
  }catch(e){ /* sin conexión */ }
}

/* Envuelve un botón en .locked-wrap con tooltip "Actualiza tu plan 💎".
 * Al hacer clic abre el modal de actualización. */
function setLockedTip(btn, mensaje){
  if(!btn) return;
  if(btn.parentElement && btn.parentElement.classList.contains("locked-wrap")){
    const tip = btn.parentElement.querySelector(".locked-tip");
    if(tip) tip.textContent = mensaje;
    return;
  }
  const wrap = document.createElement("span");
  wrap.className = "locked-wrap";
  btn.parentNode.insertBefore(wrap, btn);
  wrap.appendChild(btn);
  const badge = document.createElement("span");
  badge.className = "lock-badge";
  badge.textContent = "🔒";
  btn.appendChild(badge);
  const tip = document.createElement("span");
  tip.className = "locked-tip";
  tip.textContent = mensaje;
  wrap.appendChild(tip);
}
/* Quita el envoltorio de candado y restaura el botón. */
function clearLockedTip(btn){
  if(!btn) return;
  const wrap = btn.parentElement;
  if(wrap && wrap.classList.contains("locked-wrap")){
    const badge = btn.querySelector(".lock-badge");
    if(badge) badge.remove();
    wrap.parentNode.insertBefore(btn, wrap);
    wrap.remove();
  }
  btn.classList.remove("locked-feature");
}

/* Modal de recarga de RV. */
async function openRVModal(){
  const modal = $("#rv-modal");
  if(!modal) return;
  modal.classList.add("open");
  const box = $("#rv-packs");
  const err = $("#rv-modal-err");
  if(err) err.textContent = "";
  if(box) box.innerHTML = `<p style="color:var(--cocoa-soft)">Cargando paquetes…</p>`;
  try{
    const r = await fetch("/api/rv/packs");
    const j = await r.json();
    const packs = j.packs || [];
    if(box) box.innerHTML = packs.map(p => `
      <div class="rv-pack${p.popular ? " rv-popular" : ""}">
        ${p.popular ? `<span class="rv-tag">Más popular</span>` : ""}
        <div class="rv-pack-rv">💰 ${esc(String(p.rv))} RV</div>
        <div class="rv-pack-detalle">${esc(p.detalle || "")}</div>
        <div class="rv-pack-precio">$${esc(String(p.precio))} USD</div>
        <button class="btn btn-primary btn-block" onclick="buyRV('${esc(String(p.pack))}')">Comprar 💳</button>
      </div>`).join("");
  }catch(e){
    if(box) box.innerHTML = `<p style="color:#a33">Error cargando paquetes.</p>`;
  }
}
function closeRVModal(){
  const modal = $("#rv-modal");
  if(modal) modal.classList.remove("open");
}

/* Comprar RV: crea la orden en PayPal y redirige a aprobar. */
async function buyRV(pack){
  const err = $("#rv-modal-err");
  if(err) err.textContent = "Conectando con PayPal…";
  try{
    const r = await fetch("/api/rv/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ pack: String(pack) }),
    });
    const j = await r.json().catch(() => ({}));
    if(!r.ok) throw new Error(j.error || "No se pudo crear la orden");
    if(j.approveUrl){
      location.href = j.approveUrl; // PayPal → regresa con ?rv=ok&token=ORDERID
    }else{
      throw new Error("PayPal no devolvió link de pago");
    }
  }catch(e){
    if(err) err.textContent = e.message;
    else toast(e.message);
  }
}

/* Al regresar de PayPal (?rv=ok&token=ORDERID): captura y acredita. */
async function handleRVReturn(){
  const q = new URLSearchParams(location.search);
  if(q.get("rv") === "cancel"){
    toast(t("t.payment_cancel"));
    history.replaceState(null, "", location.pathname + location.hash);
    return;
  }
  if(q.get("rv") !== "ok") return;
  const orderID = q.get("token");
  history.replaceState(null, "", location.pathname + location.hash);
  if(!orderID){ toast("No se encontró la orden de PayPal."); return; }
  toast("Confirmando tu pago… 💰");
  try{
    const r = await fetch("/api/rv/capture-order", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ orderID }),
    });
    const j = await r.json().catch(() => ({}));
    if(!r.ok) throw new Error(j.error || "No se pudo confirmar el pago");
    toast(`¡${j.rvAgregados} RV agregados! 💰 Tienes ${j.rv} RV.`);
    loadRVBalance();
    if(j.yaAcreditado) toast("Estos RV ya estaban en tu cuenta 💰");
  }catch(e){
    toast("Error: " + e.message);
  }
}
function esc(s){ return String(s||"").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

/* ---------- auth (placeholder) ----------
 * MVP: email stored locally only. Replace with real backend auth later.
 */
function currentUser(){ return store.get(LS.user, null); }
/* Sexo del usuario actual: "M", "F" o null. Se usa para adaptar textos y voz. */
function userGender(){
  const u = currentUser();
  const g = u && u.gender;
  return (g === "M" || g === "F") ? g : null;
}
/* Adapta un texto al género del usuario.
 * Usa marcadores {o/a}, {el/la}, {mismo/misma}, etc. en el contenido.
 * Ej: "hacia ti {mismo/misma}" → "hacia ti mismo" (M) / "hacia ti misma" (F). */
function gtext(text){
  const g = userGender();
  if(!g || !text) return text || "";
  return String(text).replace(/\{([^\/{}]+)\/([^\/{}]+)\}/g, function(m, masc, fem){
    return g === "F" ? fem : masc;
  });
}
function requireAuth(){
  if(currentUser()) return true;
  showView("auth"); return false;
}
/* ---------- auth con backend (email + contraseña) ---------- */
let authMode = "login"; // "login" (principal) | "signup"

function switchAuthMode(mode, fromHash){
  authMode = mode;
  $("#tab-login").classList.toggle("active", mode === "login");
  $("#tab-signup").classList.toggle("active", mode === "signup");
  $("#form-login").style.display = mode === "login" ? "" : "none";
  $("#form-signup").style.display = mode === "signup" ? "" : "none";
  $("#login-err").textContent = "";
  $("#signup-err").textContent = "";
  // Al cambiar de pestaña: limpiar todos los campos de ambas.
  ["login-email","login-password","signup-name","signup-email","signup-password","signup-password2"].forEach(id=>{
    const f = document.getElementById(id); if(f) f.value = "";
  });
  ["signup-day","signup-month","signup-year"].forEach(id=>{
    const s = document.getElementById(id); if(s) s.selectedIndex = 0;
  });
  document.querySelectorAll('input[name="signup-sexo"]').forEach(r=>{ r.checked = false; });
  const hg = $("#signup-gender"); if(hg) hg.value = "";
  document.querySelectorAll('input[name="signup-sexo"]').forEach(r => r.checked = false);
  const cs = $("#signup-country"); if(cs) cs.value = "";
  if(mode === "signup") populateBirthdateSelects();
  if(!fromHash) syncHash();
}

function togglePassword(id){
  const f = $("#" + id);
  f.type = f.type === "password" ? "text" : "password";
}

/* Guarda la sesión del backend y entra a la app. */
function saveSession(token, user){
  store.set("reaviva_token", token);
  // Marca de vida del navegador: vive en sessionStorage, que el navegador
  // borra al cerrarse. Si al cargar no está la marca, la sesión se cierra.
  try{ sessionStorage.setItem("reaviva_alive", "1"); }catch(e){}
  store.set(LS.user, {
    id: user.id, email: user.email, name: user.name,
    planType: user.planType || "free",
    photo: user.photo || null,
    coverPhoto: user.coverPhoto || null,
    gender: user.gender || null,
    bio: user.bio || null,
    pais: user.pais || null,
  });
  store.set("reaviva_admin", user.isAdmin === true);
  store.set("reaviva_paid", user.subscribed === true || user.isAdmin === true);
  if(!store.get(LS.start, null)) store.set(LS.start, todayKey());
}

/* ---------- verificación de correo ---------- */
/* Muestra la pantalla "revisa tu correo" tras registrarse o al intentar
 * entrar sin haber confirmado la cuenta. */
let pendingVerifyEmail = null;
function showVerifyEmail(email){
  pendingVerifyEmail = email || null;
  const addr = $("#verify-email-addr");
  if(addr) addr.textContent = email || "tu correo";
  const msg = $("#verify-resend-msg");
  if(msg){ msg.textContent = ""; msg.style.color = ""; }
  showView("verify-email");
}
async function resendVerification(){
  const msg = $("#verify-resend-msg");
  const email = (pendingVerifyEmail || $("#login-email")?.value || "").trim().toLowerCase();
  if(msg){ msg.style.color = ""; msg.textContent = ""; }
  if(!email || !email.includes("@")){
    if(msg){ msg.style.color = "#a33"; msg.textContent = "Escribe tu correo en la pantalla de Entrar e inténtalo de nuevo."; }
    return;
  }
  if(msg) msg.textContent = "Enviando…";
  try{
    const r = await fetch("/api/auth/resend-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });
    const j = await r.json();
    if(msg){
      msg.style.color = r.ok ? "#2e7d32" : "#a33";
      msg.textContent = j.message || j.error || "Listo.";
    }
  }catch(e){
    if(msg){ msg.style.color = "#a33"; msg.textContent = "Sin conexión con el servidor."; }
  }
}

async function doLogin(ev){
  ev.preventDefault();
  const email = $("#login-email").value.trim().toLowerCase();
  const password = $("#login-password").value;
  const errBox = $("#login-err");
  errBox.textContent = "";
  if(!email || !email.includes("@")){ errBox.textContent = "Escribe un correo válido."; return; }
  if(password.length < 6){ errBox.textContent = "La contraseña debe tener al menos 6 caracteres."; return; }
  errBox.textContent = "Entrando…";
  try{
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const j = await r.json();
    if(!r.ok){
      // Cuenta sin confirmar: mostrar la pantalla de verificación con reenvío.
      if(j.needsVerification){ showVerifyEmail(email); return; }
      // Cuenta desactivada 48h o deshabilitada 15 días.
      if(j.locked || j.disabled){
        errBox.innerHTML = `${esc(j.error)}<br><br><a href="#" onclick="showForgotPassword('${esc(email)}');return false;" style="color:var(--terra)">¿Olvidaste tu contraseña? Recupérala aquí 🔑</a>`;
        return;
      }
      errBox.textContent = j.error || "No se pudo entrar. Inténtalo de nuevo.";
      // Tras el 2do intento fallido: ofrecer "¿Olvidaste tu contraseña?".
      if((j.failedAttempts || 0) >= 2){
        const link = document.createElement("div");
        link.style.marginTop = "8px";
        link.innerHTML = `<a href="#" onclick="showForgotPassword('${esc(email)}');return false;" style="color:var(--terra)">¿Olvidaste tu contraseña? 🔑</a>`;
        errBox.appendChild(link);
      }
      return;
    }
    saveSession(j.token, j.user);
    // El login no es una "página" a la que volver con "atrás": reemplazar
    // la entrada #entrar por #hoy en vez de apilar una nueva.
    try{ history.replaceState(null, "", location.pathname + location.search + "#hoy"); }catch(e){}
    enterApp();
    toast(t("t.welcome_back"));
  }catch(e){
    errBox.textContent = "Sin conexión con el servidor. Revisa tu internet.";
  }
}

/* ---------- "Olvidé mi contraseña": código temporal de 10 segundos ----------
 * Tras el 2do intento fallido se ofrece este flujo. El código llega al
 * correo y vence en 10 segundos. Con el código se entra en modo
 * "solo cambiar contraseña". */
function showForgotPassword(email){
  const box = $("#login-err");
  box.innerHTML = `
    <div style="text-align:center;padding:8px 0;">
      <p><b>🔑 Recuperar acceso</b></p>
      <p style="font-size:.85rem">Te enviaremos un código de <b>10 segundos</b> a tu correo.</p>
      <button class="btn btn-primary btn-sm" onclick="sendResetCode('${esc(email)}')">Enviar código</button>
      <div id="forgot-status" style="margin-top:8px;font-size:.85rem"></div>
    </div>`;
}
async function sendResetCode(email){
  const st = $("#forgot-status");
  st.textContent = "Enviando…";
  try{
    const r = await fetch("/api/auth/forgot-password", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });
    const j = await r.json();
    if(!r.ok){ st.textContent = j.error || "No se pudo enviar."; return; }
    st.innerHTML = `Revisa tu correo <b>ahora mismo</b> ⏳ El código vence en 10 segundos.<br><br>
      <input id="reset-code" class="field" inputmode="numeric" maxlength="6"
        placeholder="Código de 6 dígitos" style="text-align:center;letter-spacing:6px;font-size:1.3rem;max-width:220px;margin:0 auto;">
      <div style="margin-top:8px"><button class="btn btn-primary btn-sm" onclick="doCodeLogin('${esc(email)}')">Entrar con código</button></div>
      <div id="code-status" style="margin-top:8px;font-size:.85rem"></div>`;
    const inp = $("#reset-code");
    if(inp) inp.focus();
  }catch(e){ st.textContent = "Sin conexión."; }
}
async function doCodeLogin(email){
  const code = ($("#reset-code") || {}).value || "";
  const st = $("#code-status");
  if(code.length < 6){ st.textContent = "Escribe el código de 6 dígitos."; return; }
  st.textContent = "Verificando…";
  try{
    const r = await fetch("/api/auth/login-with-code", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code: code.trim() })
    });
    const j = await r.json();
    if(!r.ok){ st.textContent = j.error || "Código inválido."; return; }
    // Entró con código temporal → modo "solo cambiar contraseña".
    saveSession(j.token, j.user);
    showMustChangePassword();
  }catch(e){ st.textContent = "Sin conexión."; }
}
/* Pantalla de cambio obligatorio de contraseña (única opción activa). */
function showMustChangePassword(){
  showView("auth");
  const card = document.querySelector("#view-auth .auth-card") || $("#view-auth");
  card.innerHTML = `
    <div style="text-align:center;padding:12px 0;">
      <div style="font-size:2.5rem">🔑</div>
      <h3>Cambia tu contraseña</h3>
      <p style="font-size:.9rem;color:var(--cocoa-soft)">Por seguridad, crea una contraseña nueva para seguir usando Reaviva.</p>
      <input id="new-pw1" type="password" class="field" placeholder="Nueva contraseña (mín. 6 caracteres)" style="margin-bottom:8px">
      <input id="new-pw2" type="password" class="field" placeholder="Repite la nueva contraseña" style="margin-bottom:8px">
      <div id="pw-change-err" style="color:#a33;font-size:.85rem;min-height:1.2em"></div>
      <button class="btn btn-primary" onclick="doMustChangePassword()">Guardar nueva contraseña</button>
    </div>`;
}
async function doMustChangePassword(){
  const p1 = ($("#new-pw1") || {}).value || "";
  const p2 = ($("#new-pw2") || {}).value || "";
  const err = $("#pw-change-err");
  if(!isStrongPassword(p1)){ err.textContent = strongPasswordMsg(); return; }
  if(p1 !== p2){ err.textContent = "Las contraseñas no coinciden."; return; }
  err.textContent = "Guardando…";
  try{
    const r = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ newPassword: p1 })
    });
    const j = await r.json();
    if(!r.ok){
      err.textContent = j.error || "No se pudo cambiar.";
      if(j.disabled) setTimeout(()=>location.reload(), 4000);
      return;
    }
    toast("Contraseña actualizada ✅");
    location.reload(); // recarga con sesión normal
  }catch(e){ err.textContent = "Sin conexión."; }
}

/* ---------- reCAPTCHA v2 ("No soy un robot") en el registro ----------
 * La site key se obtiene de GET /api/config. Si no hay key configurada,
 * el formulario funciona SIN captcha (no bloquea). */
let recaptchaWidgetId = null;
async function initRecaptcha(){
  try{
    const r = await fetch("/api/config");
    const j = await r.json();
    if(!j.recaptchaSiteKey) return; // sin captcha configurado
    window.RECAPTCHA_SITE_KEY = j.recaptchaSiteKey;
    const s = document.createElement("script");
    s.src = "https://www.google.com/recaptcha/api.js?onload=onRecaptchaLoad&render=explicit";
    s.async = true; s.defer = true;
    document.head.appendChild(s);
  }catch(e){ /* sin captcha: el registro sigue funcionando */ }
}
/* Callback global que llama el script de Google al cargar. */
function onRecaptchaLoad(){
  try{
    const box = $("#recaptcha-box");
    if(box && window.grecaptcha && window.RECAPTCHA_SITE_KEY){
      recaptchaWidgetId = grecaptcha.render(box, { sitekey: window.RECAPTCHA_SITE_KEY });
    }
  }catch(e){ recaptchaWidgetId = null; }
}
function getRecaptchaToken(){
  try{
    if(recaptchaWidgetId !== null && window.grecaptcha){
      return grecaptcha.getResponse(recaptchaWidgetId) || null;
    }
  }catch(e){}
  return null;
}

/* ---------- fecha de nacimiento en el registro (18+) ---------- */
/* Pobla los selects de día/mes/año. Meses con el nombre localizado del navegador. */
function populateBirthdateSelects(){
  const d = $("#signup-day"), m = $("#signup-month"), y = $("#signup-year");
  if(!d || !m || !y || d.options.length > 1) return; // ya poblados
  const lang = (typeof getLang === "function" ? getLang() : "es");
  for(let i = 1; i <= 31; i++){
    const o = document.createElement("option");
    o.value = i; o.textContent = i;
    d.appendChild(o);
  }
  for(let i = 0; i < 12; i++){
    const o = document.createElement("option");
    o.value = i + 1;
    let name = String(i + 1);
    try{ name = new Date(2000, i, 1).toLocaleString(lang, { month: "long" }); }catch(e){}
    o.textContent = name.charAt(0).toUpperCase() + name.slice(1);
    m.appendChild(o);
  }
  const thisYear = new Date().getFullYear();
  for(let yr = thisYear - 18; yr >= thisYear - 90; yr--){
    const o = document.createElement("option");
    o.value = yr; o.textContent = yr;
    y.appendChild(o);
  }
}

/* Edad en años cumplidos para una fecha YYYY-MM-DD. -1 si inválida. */
function calcAgeFromBirthdate(bd){
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(bd || ""));
  if(!m) return -1;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if(dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return -1;
  const today = new Date();
  let age = today.getFullYear() - y;
  const md = (today.getMonth() + 1) - mo;
  if(md < 0 || (md === 0 && today.getDate() < d)) age--;
  return age;
}

/* Selector de sexo en el registro (M/F) para adaptar contenido y voz. */
function pickGender(g){
  const hid = $("#signup-gender");
  if(hid) hid.value = g;
}
/* Contraseña fuerte: mín 8 caracteres, 1 mayúscula, 1 minúscula, 1 número y 1 carácter especial. */
function isStrongPassword(pw){
  return typeof pw === "string" &&
    pw.length >= 8 &&
    /[A-Z]/.test(pw) &&
    /[a-z]/.test(pw) &&
    /[0-9]/.test(pw) &&
    /[^A-Za-z0-9]/.test(pw);
}
function strongPasswordMsg(){
  return "La contraseña debe tener mínimo 8 caracteres, 1 mayúscula, 1 minúscula, 1 número y 1 carácter especial (ej: Reaviva#2026)";
}
async function doSignup(ev){
  ev.preventDefault();
  const name = $("#signup-name").value.trim();
  const email = $("#signup-email").value.trim().toLowerCase();
  const password = $("#signup-password").value;
  const password2 = $("#signup-password2").value;
  const errBox = $("#signup-err");
  errBox.textContent = "";
  if(!name){ errBox.textContent = "Escribe tu nombre."; return; }
  if(!email || !email.includes("@")){ errBox.textContent = "Escribe un correo válido."; return; }
  if(!isStrongPassword(password)){ errBox.textContent = strongPasswordMsg(); return; }
  if(password !== password2){ errBox.textContent = "Las contraseñas no coinciden."; return; }
  // Fecha de nacimiento: debe ser válida y 18+ años.
  populateBirthdateSelects();
  const bdDay = $("#signup-day") ? $("#signup-day").value : "";
  const bdMonth = $("#signup-month") ? $("#signup-month").value : "";
  const bdYear = $("#signup-year") ? $("#signup-year").value : "";
  let birthdate = null;
  if(bdDay && bdMonth && bdYear){
    birthdate = `${bdYear}-${String(bdMonth).padStart(2, "0")}-${String(bdDay).padStart(2, "0")}`;
  }
  if(!birthdate || calcAgeFromBirthdate(birthdate) < 0){
    errBox.textContent = t("auth.birthdate_invalid"); return;
  }
  if(calcAgeFromBirthdate(birthdate) < 18){
    errBox.textContent = t("auth.under18"); return;
  }
  if(calcAgeFromBirthdate(birthdate) > 90){
    errBox.textContent = "La edad máxima para registrarse es 90 años."; return;
  }
  // Sexo: requerido para adaptar el contenido.
  const gender = $("#signup-gender") ? $("#signup-gender").value : "";
  if(gender !== "M" && gender !== "F"){
    errBox.textContent = "Elige si eres hombre o mujer 👆"; return;
  }
  // País: requerido.
  const country = $("#signup-country") ? $("#signup-country").value : "";
  if(!country){
    errBox.textContent = "Elige tu país 🌎"; return;
  }
  // Si el captcha está visible, exigir que lo marquen.
  let recaptchaToken = null;
  if(recaptchaWidgetId !== null){
    recaptchaToken = getRecaptchaToken();
    if(!recaptchaToken){ errBox.textContent = "Marca la casilla «No soy un robot» 🤖"; return; }
  }
  errBox.textContent = "Creando tu cuenta…";
  try{
    const r = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password, birthdate, gender, country, recaptchaToken, referred_by: localStorage.getItem("reaviva_ref") || null })
    });
    const j = await r.json();
    if(!r.ok){ errBox.textContent = j.error || "No se pudo crear la cuenta. Inténtalo de nuevo."; return; }
    // La cuenta se crea SIN verificar: no se entra a la app hasta confirmar el correo.
    try{ if(recaptchaWidgetId !== null && window.grecaptcha) grecaptcha.reset(recaptchaWidgetId); }catch(e){}
    showVerifyEmail(j.email || email);
    toast(t("t.account_created"));
  }catch(e){
    errBox.textContent = "Sin conexión con el servidor. Revisa tu internet.";
  }
}

/* Valida la sesión guardada contra el backend.
 * Si el usuario no confirmó su correo, NO entra a la app: deja el email
 * en lastUnverifiedEmail para que quien llama muestre la pantalla de
 * verificación. */
let lastUnverifiedEmail = null;
async function restoreSession(){
  const token = store.get("reaviva_token", null);
  if(!token) return false;
  try{
    const r = await fetch("/api/auth/me", {
      headers: { "Authorization": "Bearer " + token }
    });
    if(!r.ok) throw new Error("401");
    const j = await r.json();
    if(j.user && j.user.emailVerified === false){
      lastUnverifiedEmail = j.user.email;
      return false;
    }
    saveSession(token, j.user);
    return true;
  }catch(e){
    // sesión inválida: limpiar
    localStorage.removeItem(LS.user);
    localStorage.removeItem("reaviva_token");
    localStorage.removeItem("reaviva_admin");
    localStorage.removeItem("reaviva_paid");
    return false;
  }
}
/* Muestra la vista correcta tras validar la sesión: app, verificación o auth. */
function afterRestore(ok){
  if(ok){ enterApp(); return; }
  if(lastUnverifiedEmail){ showVerifyEmail(lastUnverifiedEmail); return; }
  showView("auth");
}

/* ---------- program progress ---------- */
function startDate(){
  let s = store.get(LS.start, null);
  if(!s){ s = todayKey(); store.set(LS.start, s); }
  return new Date(s + "T12:00:00");
}
function currentDay(){
  const diff = Math.floor((Date.now() - startDate().getTime()) / 86400000) + 1;
  return Math.min(Math.max(diff, 1), 30);
}
function doneDays(){ return store.get(LS.done, []); }
function isDone(d){ return doneDays().includes(d); }
function markDone(d){
  const arr = doneDays();
  if(!arr.includes(d)){ arr.push(d); store.set(LS.done, arr); }
}
function isUnlocked(d){ return d <= Math.min(currentDay(), 30); }
function isPaid(){ return store.get("reaviva_paid", false); } // synced from /api/paypal/status
function isAdmin(){ return store.get("reaviva_admin", false); }
/* Tipo de plan: 'annual' | 'monthly' | 'free'. El admin cuenta como annual. */
function planType(){
  if(isAdmin()) return "annual";
  const u = currentUser();
  return (u && u.planType) || "free";
}
function isAnnual(){ return planType() === "annual"; }

/* Sync the paid flag with the backend (PayPal is the source of truth). */
async function refreshPaidStatus(){
  const u = currentUser();
  if(!u || !u.email) return;
  try{
    const r = await fetch("/api/paypal/status?email=" + encodeURIComponent(u.email));
    if(!r.ok) return; // backend sin PayPal o sin registro: conserva el valor local
    const j = await r.json();
    store.set("reaviva_paid", !!j.subscribed);
    if(j.planType){
      const cu = currentUser() || {};
      cu.planType = j.planType;
      store.set(LS.user, cu);
    }
  }catch(e){ /* sin conexión: conserva el valor local */ }
}
function canAccess(d){
  // Admin: full access to all 30 days, no paywall.
  if(isAdmin()) return true;
  // Freemium: days 1-7 free during trial; days 8-30 require paid membership.
  // Calendar pacing (isUnlocked) is enforced separately in renderPrograma.
  return d <= TRIAL_DAYS || isPaid();
}

/* ---------- admin login (URL secreta /admin/ingzoe) ---------- */
async function doAdminLogin(ev){
  ev.preventDefault();
  const code = $("#admin-code").value.trim();
  if(!code){ toast("Escribe el código de administrador"); return; }
  try{
    const r = await fetch("/api/auth/admin-login", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ code })
    });
    const j = await r.json();
    if(!r.ok){ toast(j.error || "Código incorrecto"); return; }
    store.set(LS.user, { email: j.user.email, name: j.user.name });
    store.set("reaviva_token", j.token);
    store.set("reaviva_admin", true);
    store.set("reaviva_paid", true); // admin nunca ve el paywall
    if(!store.get(LS.start, null)) store.set(LS.start, todayKey());
    try{ history.replaceState(null, "", location.pathname + location.search + "#hoy"); }catch(e){}
    enterApp();
    toast("¡Acceso de administrador! 👑");
  }catch(e){
    toast("Sin conexión con el servidor");
  }
}

/* ---------- ruteo con hash (URLs con nombre: #registro, #comunidad, etc.) ---------- */
const VIEW_HASHES = {
  "landing": "inicio", "admin-login": "admin", "verify-email": "verificar"
};
const TAB_HASHES = {
  "hoy": "hoy", "programa": "programa", "diario": "diario", "progreso": "progreso",
  "comunidad": "comunidad", "privados": "privados", "perfil": "perfil", "admin": "admin"
};
const AUTH_HASHES = { "login": "entrar", "signup": "registro" };
let suppressHashUpdate = false;

function hashForCurrent(){
  const visible = ["landing","auth","app","admin-login","verify-email"].find(v => {
    const el = $("#view-"+v);
    return el && el.style.display !== "none";
  });
  if(visible === "auth") return AUTH_HASHES[authMode] || "entrar";
  if(visible === "app"){
    const active = Array.prototype.find.call($$(".tab"), b => b.classList.contains("active"));
    const tab = active ? active.dataset.tab : "hoy";
    return TAB_HASHES[tab] || "hoy";
  }
  return VIEW_HASHES[visible] || "";
}

function syncHash(){
  if(suppressHashUpdate) return;
  const h = hashForCurrent();
  const cur = (location.hash || "").replace(/^#/, "");
  if(h === cur) return;
  suppressHashUpdate = true;
  try{
    if(h) location.hash = h;
    else history.replaceState(null, "", location.pathname + location.search);
  }catch(e){}
  setTimeout(() => { suppressHashUpdate = false; }, 0);
}

/* Aplica un hash de la URL a la vista/pestaña correspondiente. Devuelve true si lo manejó. */
function landingVisible(){
  const el = $("#view-landing");
  return el && el.style.display !== "none";
}
function applyHashRoute(){
  const h = (location.hash || "").replace(/^#/, "").toLowerCase();
  // Sin hash → página principal. (El botón "atrás" desde #entrar/#registro vuelve aquí.)
  if(!h){ showView("landing", true); return true; }
  // Vistas de auth — si ya hay sesión, ir directo a la app (no tiene sentido
  // mostrarle el login a alguien que ya entró).
  if(h === "entrar" || h === "registro"){
    if(currentUser()){
      try{ history.replaceState(null, "", location.pathname + location.search + "#hoy"); }catch(e){}
      enterApp();
      return true;
    }
    showView("auth", true);
    switchAuthMode(h === "registro" ? "signup" : "login", true);
    return true;
  }
  // Vistas sueltas
  if(h === "inicio"){ showView("landing", true); return true; }
  if(h === "verificar"){ showView("verify-email", true); return true; }
  // Pestañas de la app: si hay sesión, van a la app (aunque exista una
  // sección del landing con el mismo id, como #programa).
  const tabByHash = Object.keys(TAB_HASHES).find(t => TAB_HASHES[t] === h);
  if(tabByHash){
    if(currentUser()){ enterApp(tabByHash); return true; }
    // Sin sesión y sin sección del landing con ese id: pedir login.
    if(!document.getElementById(h)){ showView("auth", true); switchAuthMode("login", true); return true; }
    // Existe la sección del landing: seguir al scroll de abajo.
  }
  // Secciones del landing (Programa, Precios, Preguntas): scroll suave cuando
  // el landing está visible, en vez de mandar al login.
  if(landingVisible()){
    const sec = document.getElementById(h);
    if(sec){ try{ sec.scrollIntoView({behavior:"smooth"}); }catch(e){} return true; }
  }
  return false;
}

/* ---------- views ---------- */
function showView(name, fromHash){
  // Al salir de la vista de auth: limpiar los campos de entrar/crear cuenta.
  const prevAuth = $("#view-auth") && $("#view-auth").style.display !== "none";
  if(prevAuth && name !== "auth"){
    ["login-email","login-password","signup-name","signup-email","signup-password","signup-password2"].forEach(id=>{
      const f = document.getElementById(id); if(f) f.value = "";
    });
    ["signup-day","signup-month","signup-year"].forEach(id=>{
      const s = document.getElementById(id); if(s) s.selectedIndex = 0;
    });
    document.querySelectorAll('input[name="signup-sexo"]').forEach(r=>{ r.checked = false; });
    const hg = $("#signup-gender"); if(hg) hg.value = "";
    const err1 = $("#login-err"); if(err1) err1.textContent = "";
    const err2 = $("#signup-err"); if(err2) err2.textContent = "";
  }
  ["landing","auth","app","admin-login","verify-email"].forEach(v => {
    const el = $("#view-"+v);
    if(el) el.style.display = v===name ? "block" : "none";
  });
  const target = $("#view-"+name);
  if(target) target.style.display = "block";
  try{ window.scrollTo(0,0); }catch(e){}
  if(!fromHash) syncHash();
  // Tour de bienvenida: se muestra (una sola vez) al llegar a la página de registro.
  if(name === "auth"){
    setTimeout(()=>{ try{ maybeShowTour(); }catch(e){} }, 800);
  }
}
function enterApp(initialTab){
  showView("app", !!initialTab);
  const u = currentUser();
  const chip = $("#user-chip");
  if(chip && u) chip.textContent = "Hola, " + esc(u.name);
  // Mostrar pestaña Admin solo para administradores
  const adminTab = document.querySelector('[data-tab="admin"]');
  if(adminTab) adminTab.style.display = isAdmin() ? "" : "none";
  try{ switchTab(initialTab || "hoy", !!initialTab); }catch(e){ console.error("switchTab:", e); }
  try{ checkUserMessages(); }catch(e){}
  try{ startDmPoll(); }catch(e){}
  try{ startDmWinPoll(); }catch(e){}
  // Sondeo del chat grupal SIEMPRE activo con la sesión iniciada: alimenta el
  // contador rojo de mensajes sin leer aunque estés en otra pestaña.
  try{ loadGroupUnread(); updateGroupBadge(); startChatPoll(); }catch(e){}
}
function switchTab(tab, fromHash){
  // Al cambiar de pestaña, borrar el borrador del día si había uno abierto.
  try{ if(typeof openDayNum !== "undefined" && openDayNum) clearDayDraft(openDayNum); }catch(e){}
  $$(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab===tab));
  $$(".panel").forEach(p => p.classList.toggle("active", p.id==="panel-"+tab));
  // El sondeo de mensajes corre siempre con la sesión iniciada (contador de
  // no leídos); al ENTRAR a la comunidad, los mensajes quedan leídos (contador a 0).
  if(tab === "comunidad") markGroupRead();
  if(tab==="hoy") renderHoy();
  if(tab==="programa") renderPrograma();
  if(tab==="diario") renderDiario();
  if(tab==="progreso") renderProgreso();
  if(tab==="comunidad") renderComunidad();
  if(tab==="privados") renderDmList();
  if(tab==="perfil") renderPerfil();
  if(tab==="admin") renderAdmin();
  if(!fromHash) syncHash();
}

/* ---------- auth header helper ---------- */
function authHeaders(){
  const t = store.get("reaviva_token", null);
  return t ? { "Authorization": "Bearer " + t } : {};
}

/* ============================================================
   MENSAJES DEL ADMINISTRADOR (para usuarios normales)
   ============================================================ */
async function checkUserMessages(){
  if(isAdmin()) return; // el admin no recibe sus propios mensajes
  try{
    const r = await fetch("/api/messages", { headers: authHeaders() });
    if(!r.ok) return;
    const j = await r.json();
    const box = $("#user-messages");
    if(!box) return;
    if(!j.messages || !j.messages.length){ box.innerHTML = ""; box.style.display = "none"; return; }
    box.innerHTML = j.messages.map(m=>`
      <div class="admin-msg" data-mid="${m.id}">
        <div class="am-head"><b>📢 ${esc(m.titulo)}</b>
          <button class="am-close" onclick="dismissMessage(${m.id})" aria-label="Cerrar">✕</button></div>
        <p>${esc(m.cuerpo)}</p>
      </div>`).join("");
    box.style.display = "";
  }catch(e){ /* sin conexión: no mostrar nada */ }
}
async function dismissMessage(id){
  try{
    await fetch("/api/messages/" + id + "/read", { method: "POST", headers: authHeaders() });
  }catch(e){}
  const el = document.querySelector(`.admin-msg[data-mid="${id}"]`);
  if(el) el.remove();
  const box = $("#user-messages");
  if(box && !box.querySelector(".admin-msg")) box.style.display = "none";
}

/* ============================================================
   PANEL DE ADMINISTRADOR
   ============================================================ */
let adminUsersCache = [];
let adminGrowthDays = 30;

async function renderAdmin(){
  if(!isAdmin()){ switchTab("hoy"); return; }
  const wrap = $("#admin-content");
  wrap.innerHTML = `<p style="text-align:center;color:var(--cocoa-soft)">Cargando panel…</p>`;
  try{
    const r = await fetch("/api/admin/stats", { headers: authHeaders() });
    if(!r.ok) throw new Error("HTTP " + r.status);
    const s = await r.json();
    wrap.innerHTML = `
      <div class="greet">👑 Panel de administrador</div>
      <p class="greet-sub">Todo tu negocio de un vistazo.</p>
      <div class="admin-stats">
        <div class="stat-card"><b>${s.totalUsers}</b><span>👥 Usuarios registrados</span></div>
        <div class="stat-card ok"><b>${s.subscribedUsers}</b><span>💳 Con plan pagado</span></div>
        <div class="stat-card"><b>${s.trialUsers}</b><span>🆓 En prueba / sin plan</span></div>
        <div class="stat-card live"><b>${s.onlineNow}</b><span>🟢 Conectados ahora</span></div>
        <div class="stat-card"><b>${s.signupsToday}</b><span>📝 Registros hoy</span></div>
        <div class="stat-card money"><b>$${s.mrr}</b><span>💰 Ingreso mensual est.</span></div>
        <div class="stat-card"><b>${s.referredUsers || 0}</b><span>📤 Llegaron por referido</span></div>
      </div>
      <div class="admin-section">
        <h3>📤 Top invitadores</h3>
        <div class="table-wrap"><table class="admin-table">
          <thead><tr><th>Usuario</th><th>Referidos</th></tr></thead>
          <tbody>${(s.topReferrers || []).map(t => `<tr><td>${esc(t.nombre)}</td><td><b>${t.referidos}</b></td></tr>`).join("") || `<tr><td colspan="2" style="text-align:center">Aún no hay referidos</td></tr>`}</tbody>
        </table></div>
      </div>
      <div class="admin-section">
        <div class="admin-section-head">
          <h3>📈 Crecimiento</h3>
          <select id="growth-period" class="field field-inline" onchange="loadGrowth(this.value)">
            <option value="8">Últimos 8 días</option>
            <option value="15">Últimos 15 días</option>
            <option value="30" selected>Últimos 30 días</option>
            <option value="60">Últimos 60 días</option>
            <option value="90">Últimos 90 días</option>
            <option value="180">Últimos 6 meses</option>
            <option value="365">Último año</option>
          </select>
        </div>
        <div id="growth-chart" class="growth-chart"></div>
        <div class="table-wrap"><table class="admin-table">
          <thead><tr><th>Período</th><th>Nuevos usuarios</th><th>Nuevos con plan</th></tr></thead>
          <tbody id="growth-body"></tbody>
        </table></div>
      </div>
      <div class="admin-section">
        <h3>👥 Usuarios</h3>
        <div class="table-wrap"><table class="admin-table">
          <thead><tr><th>Nombre</th><th>Email</th><th>Plan</th><th>Última conexión</th></tr></thead>
          <tbody id="admin-users-body"><tr><td colspan="4" style="text-align:center">Cargando…</td></tr></tbody>
        </table></div>
      </div>
      <div class="admin-section">
        <h3>✉️ Enviar mensaje</h3>
        <div class="block">
          <select id="msg-user" class="field"><option value="all">📢 Todos los usuarios</option></select>
          <input id="msg-title" class="field" placeholder="Título del mensaje" maxlength="120">
          <textarea id="msg-body" class="field" rows="3" placeholder="Escribe tu mensaje…" style="resize:vertical"></textarea>
          <button class="btn btn-primary btn-block" onclick="sendAdminMessage()">Enviar mensaje</button>
        </div>
        <h3 style="margin-top:20px">📨 Mensajes enviados</h3>
        <div id="admin-sent-list"><p style="color:var(--cocoa-soft)">Cargando…</p></div>
      </div>
      <div class="admin-section">
        <h3>💬 Moderar comunidad</h3>
        <p class="greet-sub">Solo tú ves quién escribió cada comentario. Puedes ocultar los inapropiados o escribirle a la persona.</p>
        <div id="admin-community-list"><p style="color:var(--cocoa-soft)">Cargando…</p></div>
      </div>
      <div id="admin-user-detail"></div>`;
    await Promise.all([loadGrowth(adminGrowthDays), loadAdminUsers(), loadSentMessages(), loadAdminCommunity()]);
    // restaurar selector al período actual
    const sel = $("#growth-period");
    if(sel) sel.value = String(adminGrowthDays);
  }catch(e){
    wrap.innerHTML = `<p style="color:#a33;text-align:center">No se pudo cargar el panel: ${esc(e.message)}</p>`;
  }
}

async function loadGrowth(days){
  adminGrowthDays = Number(days) || 30;
  const chart = $("#growth-chart"), body = $("#growth-body");
  if(!chart || !body) return;
  chart.innerHTML = `<p style="color:var(--cocoa-soft)">Cargando…</p>`;
  try{
    const r = await fetch("/api/admin/growth?days=" + adminGrowthDays, { headers: authHeaders() });
    if(!r.ok) throw new Error("HTTP " + r.status);
    const g = await r.json();
    const periods = g.periods || [];
    const max = Math.max(1, ...periods.map(p=>p.nuevosUsuarios));
    // Mini gráfico de barras con divs/CSS (sin librerías)
    chart.innerHTML = `
      <div class="bars" title="Nuevos usuarios por período">
        ${periods.map(p=>{
          const h = Math.round((p.nuevosUsuarios / max) * 100);
          const cls = p.nuevosConPlan > 0 ? "bar has-plan" : "bar";
          return `<div class="${cls}" style="height:${Math.max(h,3)}%" title="${esc(p.etiqueta)}: ${p.nuevosUsuarios} usuarios, ${p.nuevosConPlan} con plan"><span>${p.nuevosUsuarios||""}</span></div>`;
        }).join("")}
      </div>
      <div class="bars-legend"><span><i class="dot"></i> Usuarios</span><span><i class="dot plan"></i> Con plan ese período</span>
      <span style="margin-left:auto">Total: ${g.totalSignups} usuarios · ${g.totalSubs} con plan</span></div>`;
    // Tabla (últimos 10 períodos para no alargar; el gráfico muestra todo)
    const rows = g.porSemana ? periods.slice(-10) : periods.slice(-14);
    body.innerHTML = rows.map(p=>`
      <tr><td>${esc(p.etiqueta)}</td><td><b>${p.nuevosUsuarios}</b></td><td>${p.nuevosConPlan>0?'<span class="tag-plan">'+p.nuevosConPlan+'</span>':'0'}</td></tr>`).join("")
      || `<tr><td colspan="3" style="text-align:center">Sin datos</td></tr>`;
  }catch(e){
    chart.innerHTML = `<p style="color:#a33">Error cargando crecimiento</p>`;
  }
}

async function loadAdminUsers(){
  const body = $("#admin-users-body");
  const sel = $("#msg-user");
  try{
    const r = await fetch("/api/admin/users", { headers: authHeaders() });
    if(!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    adminUsersCache = j.users || [];
    body.innerHTML = adminUsersCache.map(u=>`
      <tr onclick="openAdminUser(${u.id})" class="clickable">
        <td>${esc(u.nombre)} ${u.esAdmin?'👑':''} ${u.enLinea?'<span class="dot-online" title="En línea"></span>':''}</td>
        <td class="hide-s">${esc(u.email)}</td>
        <td>${u.conPlan?'<span class="tag-plan">CON PLAN</span>':'<span class="tag-free">SIN PLAN</span>'}</td>
        <td>${esc(u.ultimaConexion)}</td>
      </tr>`).join("") || `<tr><td colspan="4" style="text-align:center">Sin usuarios</td></tr>`;
    // Llenar selector del composer (conservar opción "todos")
    if(sel){
      sel.innerHTML = `<option value="all">📢 Todos los usuarios</option>` +
        adminUsersCache.filter(u=>!u.esAdmin).map(u=>`<option value="${u.id}">${esc(u.nombre)} (${esc(u.email)})</option>`).join("");
    }
  }catch(e){
    body.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#a33">Error cargando usuarios</td></tr>`;
  }
}

async function openAdminUser(id){
  const box = $("#admin-user-detail");
  box.innerHTML = `<p style="text-align:center">Cargando usuario…</p>`;
  box.scrollIntoView({ behavior: "smooth", block: "start" });
  try{
    const r = await fetch("/api/admin/users/" + id, { headers: authHeaders() });
    if(!r.ok) throw new Error("HTTP " + r.status);
    const u = await r.json();
    box.innerHTML = `
      <div class="admin-section">
        <div class="admin-section-head">
          <h3>👤 ${esc(u.nombre)}</h3>
          <button class="btn btn-ghost" style="padding:8px 16px;font-size:.85rem" onclick="document.querySelector('#admin-user-detail').innerHTML=''">Cerrar ✕</button>
        </div>
        <div class="user-detail-card ${u.conPlan?'has-plan':'no-plan'}">
          <div class="plan-badge">${u.conPlan ? "✅ TIENE PLAN" : "⚠️ SIN PLAN"}</div>
          <div class="ud-grid">
            <div><small>Email</small><b>${esc(u.email)}</b></div>
            <div><small>Estado suscripción</small><b>${esc(u.plan)}${u.planDetalle?` (${esc(u.planDetalle)})`:""}</b></div>
            <div><small>Próximo cobro</small><b>${esc(u.proximoCobro || "—")}</b></div>
            <div><small>Registrado</small><b>${esc(u.registrado)}</b></div>
            <div><small>Última conexión</small><b>${esc(u.ultimaConexion)} ${u.enLinea?'🟢':''}</b></div>
            <div><small>Inicio programa</small><b>${esc(u.inicioPrograma || "—")}</b></div>
            <div><small>Días completados</small><b>${u.diasCompletados}/30</b></div>
            <div><small>Entradas diario</small><b>${u.entradasDiario}</b></div>
          </div>
          <button class="btn btn-primary btn-block" style="margin-top:14px"
            onclick="prefillMessage(${u.id})">✉️ Enviarle un mensaje</button>
        </div>
      </div>`;
  }catch(e){
    box.innerHTML = `<p style="color:#a33;text-align:center">Error: ${esc(e.message)}</p>`;
  }
}

function prefillMessage(userId){
  const sel = $("#msg-user");
  if(sel) sel.value = String(userId);
  const title = $("#msg-title");
  if(title) title.focus();
  window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
}

async function sendAdminMessage(){
  const sel = $("#msg-user"), title = $("#msg-title"), bodyEl = $("#msg-body");
  const userId = sel ? sel.value : "all";
  const titleV = title ? title.value.trim() : "";
  const bodyV = bodyEl ? bodyEl.value.trim() : "";
  if(!titleV){ toast("Escribe un título"); return; }
  if(!bodyV){ toast("Escribe el mensaje"); return; }
  try{
    const r = await fetch("/api/admin/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ userId: userId === "all" ? "all" : Number(userId), title: titleV, body: bodyV })
    });
    const j = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(j.error || ("HTTP " + r.status));
    toast(j.para === "todos" ? `📢 Mensaje enviado a ${j.destinatarios} usuarios` : "✉️ Mensaje enviado");
    if(title) title.value = "";
    if(bodyEl) bodyEl.value = "";
    loadSentMessages();
  }catch(e){
    toast("Error: " + e.message);
  }
}

async function loadSentMessages(){
  const box = $("#admin-sent-list");
  if(!box) return;
  try{
    const r = await fetch("/api/admin/messages", { headers: authHeaders() });
    if(!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    box.innerHTML = (j.messages||[]).map(m=>`
      <div class="entry">
        <div class="ehead"><span>Para: <b>${esc(m.para)}</b> · ${esc(m.enviado)}</span><span>${m.leido?"👁️":""}</span></div>
        <p><b>${esc(m.titulo)}</b><br>${esc(m.cuerpo)}</p>
      </div>`).join("") || `<p style="color:var(--cocoa-soft)">Aún no enviaste mensajes.</p>`;
  }catch(e){
    box.innerHTML = `<p style="color:#a33">Error cargando mensajes</p>`;
  }
}

/* --- Moderación de la comunidad (solo admin: ve la identidad real) --- */
async function loadAdminCommunity(){
  const box = $("#admin-community-list");
  if(!box) return;
  try{
    const r = await fetch("/api/admin/community", { headers: authHeaders() });
    if(!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    const items = j.comentarios || [];
    box.innerHTML = items.map(c=>`
      <div class="comment-card admin-comment ${c.oculto?'hidden-comment':''}">
        <div class="comment-body">
          <div class="comment-head">
            <b>👤 ${esc(c.nombre)}</b><span>${esc(c.email)}</span><span>${esc(c.fecha)}</span>
            ${c.oculto?'<span class="tag-free">OCULTO</span>':''}
          </div>
          <p>${esc(c.texto)}</p>
          <div class="comment-actions">
            <button class="btn btn-ghost btn-sm" onclick="prefillMessage(${c.usuarioId})">✉️ Mensaje</button>
            ${c.oculto
              ? `<button class="btn btn-ghost btn-sm" onclick="toggleCommunityHide(${c.id},false)">👁️ Mostrar</button>`
              : `<button class="btn btn-ghost btn-sm" onclick="toggleCommunityHide(${c.id},true)">🚫 Ocultar</button>`}
          </div>
        </div>
      </div>`).join("") || `<p style="color:var(--cocoa-soft)">Aún no hay comentarios.</p>`;
  }catch(e){
    box.innerHTML = `<p style="color:#a33">Error cargando comunidad</p>`;
  }
}

async function toggleCommunityHide(id, hide){
  try{
    const r = await fetch(`/api/admin/community/${id}/${hide?"hide":"unhide"}`, {
      method: "POST", headers: authHeaders()
    });
    if(!r.ok) throw new Error("HTTP " + r.status);
    toast(hide ? "Comentario ocultado 🚫" : "Comentario visible 👁️");
    loadAdminCommunity();
  }catch(e){
    toast("Error: " + e.message);
  }
}

/* ---------- HOY ---------- */
function renderHoy(){
  const d = currentDay(), prog = window.REAVIVA_PROGRAM[d-1];
  const done = doneDays().length;
  $("#hoy-progress").innerHTML = `
    <div class="pill"><b>${done}/30</b><span>días completados</span></div>
    <div class="pill"><b>${streak()}</b><span>días de racha 🔥</span></div>
    <div class="pill"><b>${Math.round(done/30*100)}%</b><span>de tu sanación</span></div>`;
  $("#hoy-card").innerHTML = `
    <div class="today-card">
      <div class="kicker">Día ${d} de 30 · ${esc(prog.part)}</div>
      <h2>${esc(gtext(prog.title))}</h2>
      <p>${esc(gtext(prog.reflexion).slice(0,140))}…</p>
      <button class="btn btn-primary" onclick="openDay(${d})">Continuar mi día ${d} →</button>
    </div>`;
}
function streak(){
  const arr = doneDays().slice().sort((a,b)=>a-b);
  let s = 0;
  for(let i=arr.length-1; i>=0; i--){ if(arr[i] === currentDay()-s || (s===0 && arr[i] <= currentDay())){ s++; } else break; }
  // simpler: count consecutive completed days ending at max completed <= currentDay
  let max = 0; arr.forEach(x=>{ if(x<=currentDay()) max=Math.max(max,x); });
  let n=0; while(arr.includes(max-n)) n++;
  return n;
}

/* ---------- PROGRAMA ---------- */
let openDayNum = null;
function renderPrograma(){
  const wrap = $("#programa-list"); wrap.innerHTML = "";
  window.REAVIVA_PROGRAM.forEach(p=>{
    const unlocked = isUnlocked(p.day), gated = p.day > TRIAL_DAYS && !isPaid();
    const btn = document.createElement("button");
    btn.className = "prog-item" + (isDone(p.day)?" done":"") + (!unlocked||gated?" locked":"");
    btn.innerHTML = `
      <div class="check">✓</div>
      <div class="info"><b>Día ${p.day} · ${esc(gtext(p.title))}</b><small>${esc(p.part)}</small></div>
      <div class="lock">${gated ? "🔒" : (!unlocked ? "🔒" : (isDone(p.day)?"":"→"))}</div>`;
    if(unlocked && !gated) btn.onclick = ()=>openDay(p.day);
    else btn.onclick = ()=>openPaywall();
    wrap.appendChild(btn);
  });
  const gate = $("#programa-gate");
  if(!isPaid()){
    gate.innerHTML = `
      <div class="paywall">
        <h3>🔓 Desbloquea los 30 días</h3>
        <p>Los primeros ${TRIAL_DAYS} días son gratis. Continúa tu proceso completo con la membresía.</p>
        <button class="btn btn-primary" onclick="openPaywall()">Ver planes</button>
      </div>`;
  } else gate.innerHTML = "";
}

/* ---------- day detail ---------- */
function openDay(d){
  if(!canAccess(d)){ openPaywall(); return; }
  // Si había otro día abierto, borrar su borrador.
  try{
    if(typeof openDayNum !== "undefined" && openDayNum && openDayNum !== d) clearDayDraft(openDayNum);
  }catch(e){}
  openDayNum = d;
  const p = window.REAVIVA_PROGRAM[d-1];
  const savedEx = getExerciseText(d);
  const savedStory = getStoryText(d);
  const done = isDone(d);
  $("#day-detail").innerHTML = `
    <div class="day-hero">
      <div class="part">${esc(p.part)}</div>
      <h2>Día ${p.day} · ${esc(gtext(p.title))}</h2>
    </div>
    <div class="block audio-block"><h4>🎧 Escuchar</h4><audio controls preload="none" src="/audio/dia-${p.day}${userGender()==="F"?"-f":""}.mp3" style="width:100%"></audio></div>
    <div class="block case"><h4>📖 El caso</h4><p>${esc(gtext(p.caso))}</p></div>
    <div class="block"><h4>💭 Reflexión</h4><p>${esc(gtext(p.reflexion))}</p></div>
    <div class="block"><h4>📝 Su historia</h4><p>${esc(gtext(storyPrompt(p.day)))}</p>
      <textarea id="story-text" class="journal" rows="6" placeholder="Escribe aquí tu historia… (mínimo 500 caracteres)" ${done?"disabled":""}>${esc(savedStory)}</textarea>
      <div id="story-count" style="text-align:right;font-size:.8rem;color:var(--cocoa-soft);margin-top:4px"></div>
    </div>
    <div class="block"><h4>✍️ Ejercicio</h4><p>${esc(gtext(p.ejercicio))}</p>
      <textarea id="exercise-text" class="journal" rows="8" placeholder="Escribe aquí tu ejercicio… (mínimo 500 palabras para completar el día)" ${done?"disabled":""}>${esc(savedEx)}</textarea>
      <div id="exercise-count" style="text-align:right;font-size:.8rem;color:var(--cocoa-soft);margin-top:4px"></div>
    </div>
    <div class="block"><h4>✅ Acción de hoy</h4><p>${esc(gtext(p.accion))}</p></div>
    <div class="complete-row">
      <button id="complete-day-btn" class="btn ${done?"btn-ghost":"btn-primary"} btn-block" onclick="completeDay(${d})">
        ${done ? "✓ Día completado" : "Marcar día como completado"}
      </button>
      ${(!done)?'<p id="complete-hint" style="text-align:center;font-size:.8rem;color:var(--cocoa-soft);margin-top:6px"></p>':''}
    </div>
    <div class="day-nav">
      <button class="btn btn-ghost" ${d<=1?"disabled":""} onclick="openDay(${d-1})">← Anterior</button>
      <button class="btn btn-ghost" ${d>=30?"disabled":""} onclick="tryNextDay(${d})">Siguiente →</button>
    </div>
    <div style="margin-top:16px"><button class="btn btn-ghost btn-block" onclick="backToList()">← Volver al programa</button></div>`;
  $("#panel-programa-list").style.display = "none";
  $("#day-detail").style.display = "";
  window.scrollTo(0,0);
  if(!done){
    const ta = $("#exercise-text");
    const sta = $("#story-text");
    const updateStoryCount = ()=>{
      const el = document.getElementById("story-text");
      if(!el) return 0;
      const len = el.value.length;
      const scd = document.getElementById("story-count");
      if(scd) scd.innerHTML = `<b style="color:${len>=500?"#2e7d32":"var(--terra)"}">${len}</b> / 500 caracteres mínimos`;
      // Quitar el rojo automáticamente al llegar a 500.
      if(len >= 500) el.classList.remove("incomplete-red");
      return len;
    };
    const updateExCount = ()=>{
      const el = document.getElementById("exercise-text");
      if(!el) return 0;
      const n = countWords(el.value);
      const cd = document.getElementById("exercise-count");
      if(cd) cd.innerHTML = `<b style="color:${n>=500?"#2e7d32":"var(--terra)"}">${n}</b> / 500 palabras mínimas`;
      if(n >= 500) el.classList.remove("incomplete-red");
      return n;
    };
    if(sta) sta.addEventListener("input", ()=>{ saveStoryText(d, sta.value); updateStoryCount(); checkComplete(); });
    const update = ()=>{
      const n = updateExCount();
      saveExerciseText(d, ta.value);
      checkComplete();
    };
    const checkComplete = ()=>{
      const n = countWords(ta.value);
      const len = sta ? sta.value.length : 500;
      updateStoryCount();
      const hint = $("#complete-hint");
      const okStory = len >= 500, okEx = n >= 500;
      if(okStory && okEx){
        if(hint) hint.textContent = "";
      }else{
        const faltan = [];
        if(!okStory) faltan.push(`${500-len} caracteres en tu historia 📝`);
        if(!okEx) faltan.push(`${500-n} palabras en el ejercicio ✍️`);
        if(hint) hint.textContent = "Te faltan " + faltan.join(" y ");
      }
    };
    ta.addEventListener("input", update);
    update();
    updateStoryCount();
  }else{
    const cd = $("#exercise-count");
    if(cd){ const n = countWords(savedEx); cd.innerHTML = `<b>${n}</b> palabras`; }
  }
}
/* Cuenta palabras de un texto. */
function countWords(t){
  if(!t) return 0;
  return t.trim().split(/\s+/).filter(w=>w.length).length;
}
/* Guarda/lee el texto del ejercicio por día (local). */
function getExerciseText(d){
  const all = store.get("reaviva_exercises", {});
  return all[d] || "";
}
function saveExerciseText(d, text){
  const all = store.get("reaviva_exercises", {});
  all[d] = text;
  store.set("reaviva_exercises", all);
}
/* Historia personal del usuario por día (cómo empezó todo). */
/* Preguntas de "Su historia": una distinta por día, cada una sigue lo que
   contó en los días anteriores (cadena progresiva de reflexión). */
const STORY_PROMPTS = [
  "Cuéntanos tu historia: ¿cómo empezó todo? ¿Cómo se conocieron y cómo era al principio?",
  "Ayer contaste cómo empezó. Hoy: ¿cuándo sentiste por primera vez que algo había cambiado entre ustedes?",
  "Describe el momento exacto en que supiste que la relación ya no era la misma. ¿Qué pasó ese día?",
  "De todo lo que has contado, ¿qué es lo que más te duele hoy? Escríbelo sin filtros.",
  "Si pudieras hablar con esa persona hoy, sin miedo y sin que te interrumpa, ¿qué le dirías?",
  "¿Qué crees que cambió en tu relación en los últimos días juntos? ¿Qué fue distinto al principio?",
  "¿En qué momentos te sentías más {solo/sola} aun estando {acompañado/acompañada}? Cuéntalos.",
  "¿Qué señales viste y decidiste ignorar? ¿Por qué crees que las ignoraste?",
  "¿Qué parte de ti dejaste de lado para mantener esa relación? ¿Qué dejaste de hacer, de soñar, de ser?",
  "Escribe una carta que nunca enviarás: todo lo que guardaste y nunca dijiste.",
  "¿Hubo bromas, comentarios o actitudes que te herían disfrazados de algo normal? Cuéntalos con ejemplos.",
  "¿Alguna vez te hicieron sentir que exagerabas cuando algo te dolía? ¿Cómo fue y qué sentiste?",
  "¿Qué frases de esa persona se te quedaron grabadas? Escríbelas tal como las recuerdas y lo que te hacen sentir hoy.",
  "¿De qué formas te controlaban o te hacían dudar de ti? Pon ejemplos concretos, sin suavizarlos.",
  "Hoy escribe todo lo que reconoces como tóxico en esa relación. Todo. Sin excusas para nadie.",
  "¿Cuándo fue la última vez que hiciste algo solo por ti y para ti? ¿Qué se sintió? ¿Por qué dejaste de hacerlo?",
  "¿Qué límites no pusiste y hoy quisieras haber puesto? Escríbelos como reglas para tu vida desde hoy.",
  "¿Qué te mereces en una relación? Escríbelo sin modestia y sin pedir permiso.",
  "Si tu {mejor amigo/mejor amiga} viviera exactamente tu historia, ¿qué le aconsejarías? Ahora aplícalo a ti.",
  "Escribe cómo sería un día normal de tu vida si esto ya no doliera. En detalle: mañana, tarde y noche.",
  "Mirando hacia atrás: ¿qué patrón ves que se repite en tus relaciones? ¿De dónde crees que viene?",
  "¿Qué creencias sobre el amor aprendiste de {niño/niña} que hoy te hacen daño? Escríbelas y cuestiónalas.",
  "¿A quién necesitas perdonar para seguir: a esa persona, a ti, o a ambos? Escribe por qué y cómo empezaría ese perdón.",
  "Escribe la despedida que nunca pudiste dar. Di todo lo que quedó pendiente y cierra esa conversación.",
  "¿Qué harás diferente la próxima vez que alguien te trate como te trataron? Escribe tus nuevas reglas.",
  "Ya avanzaste mucho. ¿Qué aprendiste de ti en estos días? ¿Qué descubriste que no sabías de ti?",
  "Describe a la persona en la que te estás convirtiendo. ¿Cómo piensa, cómo actúa, qué ya no acepta?",
  "¿Qué sueños dejaste en pausa por esa relación? Haz la lista y marca cuál retomas primero y cuándo.",
  "Escribe tu plan para los próximos 30 días: ¿qué vas a construir, paso a paso?",
  "Tu historia continúa. Escribe el capítulo que empieza hoy: ¿cómo quieres que siga tu vida desde aquí?",
];
function storyPrompt(d){
  const day = Number(d) || 1;
  if(day <= 1) return STORY_PROMPTS[0];
  /* Desde el día 2, las preguntas son DISTINTAS para cada usuario: se arman
     con fragmentos reales de lo que escribió el DÍA 1 (su propia historia). */
  const day1 = (getStoryText(1) || "").trim();
  const sents = day1.split(/[.!?]+/).map(s=>s.trim()).filter(s=>s.length > 25);
  if(!sents.length) return STORY_PROMPTS[day - 1];
  sents.sort((a,b)=>b.length - a.length);
  const frag = (sents[(day - 2) % sents.length]).slice(0, 140);
  const T = {
    2:  `El día 1 escribiste: «${frag}…». A partir de eso: ¿cuándo sentiste por primera vez que algo había cambiado entre ustedes?`,
    3:  `En tu historia contaste: «${frag}…». Hoy profundiza: describe el momento exacto en que supiste que la relación ya no era la misma.`,
    4:  `Relee lo que escribiste el día 1: «${frag}…». ¿Qué parte de todo eso es lo que más te duele hoy?`,
    5:  `Pensando en tu historia («${frag}…»), si pudieras hablar con esa persona hoy, sin miedo, ¿qué le dirías?`,
    6:  `El día 1 dijiste: «${frag}…». ¿Qué crees que cambió en tu relación en los últimos días juntos, comparado con eso?`,
    7:  `Según lo que contaste («${frag}…»), ¿en qué momentos te sentías más {solo/sola} aun estando {acompañado/acompañada}?`,
    8:  `En tu historia aparece esto: «${frag}…». ¿Qué señales viste y decidiste ignorar? ¿Por qué las ignoraste?`,
    9:  `A raíz de lo que viviste («${frag}…»), ¿qué parte de ti dejaste de lado para mantener esa relación?`,
    10: `Escribe una carta que nunca enviarás. Empieza retomando esto que contaste el día 1: «${frag}…». Di todo lo que guardaste.`,
    11: `Piensa en tu historia («${frag}…»): ¿hubo bromas o comentarios que te herían disfrazados de algo normal? Cuéntalos.`,
    12: `Contaste que «${frag}…». ¿Te hicieron sentir que exagerabas cuando algo te dolía? ¿Cómo fue?`,
    13: `El día 1 escribiste «${frag}…». ¿Qué frases de esa persona se te quedaron grabadas desde entonces?`,
    14: `Con base en tu historia («${frag}…»): ¿de qué formas te controlaban o te hacían dudar de ti? Ejemplos concretos.`,
    15: `Hoy, mirando todo lo que contaste desde el día 1 («${frag}…»), escribe todo lo que reconoces como tóxico en esa relación.`,
    16: `Antes de esta historia («${frag}…»), ¿cuándo fue la última vez que hiciste algo solo por ti? ¿Qué se sintió?`,
    17: `Por cosas como esta que viviste («${frag}…»): ¿qué límites no pusiste y hoy quisieras haber puesto?`,
    18: `Después de vivir esto («${frag}…»): ¿qué te mereces en una relación? Escríbelo sin modestia.`,
    19: `Si tu {mejor amigo/mejor amiga} viviera tu historia («${frag}…»), ¿qué le aconsejarías? Ahora aplícalo a ti.`,
    20: `Tu historia empezó así: «${frag}…». Ahora escribe cómo sería un día normal de tu vida si esto ya no doliera.`,
    21: `Mirando tu historia completa («${frag}…»): ¿qué patrón se repite en tus relaciones? ¿De dónde viene?`,
    22: `Contaste el día 1 que «${frag}…». ¿Qué creencias sobre el amor aprendiste de {niño/niña} que hoy te hacen daño?`,
    23: `Sobre todo lo que pasó («${frag}…»): ¿a quién necesitas perdonar: a esa persona, a ti, o a ambos? ¿Por qué?`,
    24: `Escribe la despedida que nunca pudiste dar. Retoma el final de lo que contaste: «${frag}…» y cierra esa conversación.`,
    25: `Si alguien volviera a tratarte como en esta historia («${frag}…»), ¿qué harás diferente? Escribe tus nuevas reglas.`,
    26: `El día 1 escribiste «${frag}…». Hoy, ¿qué aprendiste de ti en este proceso que no sabías entonces?`,
    27: `Compárate con la persona de esta frase: «${frag}…». ¿En quién te estás convirtiendo? ¿Qué ya no aceptas?`,
    28: `Por esta relación («${frag}…») dejaste sueños en pausa. Haz la lista y marca cuál retomas primero.`,
    29: `Ya no eres la persona que escribió «${frag}…». Escribe tu plan para los próximos 30 días, paso a paso.`,
    30: `Tu historia empezó con «${frag}…». Hoy escribe el capítulo que empieza ahora: ¿cómo sigue tu vida desde aquí?`,
  };
  return T[day] || STORY_PROMPTS[day - 1];
}

function getStoryText(d){
  const all = store.get("reaviva_stories", {});
  return all[d] || "";
}
function saveStoryText(d, text){
  const all = store.get("reaviva_stories", {});
  all[d] = text;
  store.set("reaviva_stories", all);
}
function backToList(){
  // Borrar el borrador del día al salir de la vista.
  try{ if(typeof openDayNum !== "undefined" && openDayNum) clearDayDraft(openDayNum); }catch(e){}
  $("#day-detail").style.display = "none";
  $("#panel-programa-list").style.display = "";
  renderPrograma();
}
function completeDay(d){
  const storyLen = getStoryText(d).length;
  const exWords = countWords(getExerciseText(d));
  const okStory = storyLen >= 500, okEx = exWords >= 500;
  if(!isDone(d) && (!okStory || !okEx)){
    // Resaltar en rojo las partes incompletas.
    highlightIncomplete(okStory, okEx);
    const faltan = [];
    if(!okStory) faltan.push("tu historia 📝");
    if(!okEx) faltan.push("el ejercicio ✍️");
    toast("Completa " + faltan.join(" y ") + " para continuar");
    return;
  }
  markDone(d);
  // Cada 3 días: test de 25 preguntas basado en su historia y relación.
  if(d % 3 === 0 && !getTestResult(d)){
    renderProgressTest(d);
    return;
  }
  toast(t("t.day_done", {d: d}));
  openDay(d);
}

/* Resalta en rojo las secciones incompletas hasta que se completen. */
function highlightIncomplete(okStory, okEx){
  const sta = $("#story-text"), ta = $("#exercise-text");
  if(sta){
    sta.classList.toggle("incomplete-red", !okStory);
    if(!okStory){ sta.scrollIntoView({behavior:"smooth", block:"center"}); sta.focus(); }
  }
  if(ta){
    ta.classList.toggle("incomplete-red", !okEx);
    if(okStory && !okEx){ ta.scrollIntoView({behavior:"smooth", block:"center"}); ta.focus(); }
  }
}
/* Quita el rojo cuando el usuario completa la sección. */
document.addEventListener("input", function(e){
  if(e.target && e.target.id === "story-text" && e.target.value.length >= 500)
    e.target.classList.remove("incomplete-red");
  if(e.target && e.target.id === "exercise-text" && typeof countWords === "function" && countWords(e.target.value) >= 500)
    e.target.classList.remove("incomplete-red");
});
/* Botón Siguiente: bloqueado si el día actual no está completado. */
function tryNextDay(d){
  if(!isDone(d)){
    const okStory = getStoryText(d).length >= 500;
    const okEx = countWords(getExerciseText(d)) >= 500;
    highlightIncomplete(okStory, okEx);
    toast("Completa este día primero para avanzar 🔒");
    return;
  }
  openDay(d+1);
}

/* ---------- TEST DE PROGRESO (cada 3 días, 25 preguntas) ----------
 * Todo basado en la historia que el usuario escribió y su relación.
 * Escala 1-5. Puntaje mínimo para avanzar: 75/125. */
function getTestResult(d){
  const all = store.get("reaviva_tests", {});
  return all[d] || null;
}
function saveTestResult(d, score, passed){
  const all = store.get("reaviva_tests", {});
  all[d] = { score, passed, date: new Date().toISOString() };
  store.set("reaviva_tests", all);
}
/* Extrae fragmentos de su historia para personalizar las preguntas. */
function storyExcerpts(){
  const stories = store.get("reaviva_stories", {});
  const all = Object.values(stories).join(" ");
  if(!all.trim()) return [];
  // Divide en oraciones y toma las más largas (más contenido).
  const sentences = all.split(/[.!?]+/).map(s=>s.trim()).filter(s=>s.length > 20);
  sentences.sort((a,b)=>b.length - a.length);
  return sentences.slice(0, 5);
}
function buildTestQuestions(){
  const excerpts = storyExcerpts();
  const ex = (i)=> excerpts[i] ? `"<i>${esc(excerpts[i].slice(0,120))}${excerpts[i].length>120?"…":""}</i>"` : "tu historia";
  const Q = [];
  // Bloque 1: Su historia (1-8) — reflexión sobre lo que escribió.
  Q.push({t:`En tu historia contaste: ${ex(0)}. Del 1 al 5, ¿cuánto te duele recordarlo hoy? (1 = muchísimo, 5 = ya casi nada)`, scale:true, invert:true});
  Q.push({t:`Relee lo que escribiste: ${ex(1)}. ¿Sientes que has avanzado desde que lo escribiste? (1 = nada, 5 = muchísimo)`, scale:true});
  Q.push({t:`Pensando en cómo empezó todo según tu historia, ¿qué fue lo más bonito del inicio?`, open:true});
  Q.push({t:`¿Qué parte de tu historia te cuesta más aceptar hoy? (1 = me destruye, 5 = lo acepto)`, scale:true, invert:true});
  Q.push({t:`Si tu historia fuera un libro, ¿en qué capítulo sientes que estás ahora?`, open:true});
  Q.push({t:`${ex(2)}. ¿Esta parte de tu historia te genera enojo todavía? (1 = mucho enojo, 5 = paz)`, scale:true, invert:true});
  Q.push({t:`¿Hay algo de tu historia que hoy ves diferente a cuando la escribiste?`, open:true});
  Q.push({t:`Del 1 al 5, ¿cuánta claridad tienes hoy sobre lo que pasó en tu historia?`, scale:true});
  // Bloque 2: Su relación (9-17) — dinámica de la relación.
  Q.push({t:`¿Cómo describirías tu relación en una palabra hoy?`, open:true});
  Q.push({t:`Del 1 al 5, ¿cuánto extrañas a tu ex pareja hoy? (1 = muchísimo, 5 = casi nada)`, scale:true, invert:true});
  Q.push({t:`¿Qué fue lo mejor que te dio tu relación?`, open:true});
  Q.push({t:`¿Qué fue lo más doloroso de tu relación? (1 = insoportable, 5 = lo proceso bien)`, scale:true, invert:true});
  Q.push({t:`Del 1 al 5, ¿qué tan en paz estás con el final de tu relación?`, scale:true});
  Q.push({t:`Si pudieras decirle algo a tu ex hoy, ¿qué sería?`, open:true});
  Q.push({t:`¿Sientes que tu relación te enseñó algo valioso? (1 = nada, 5 = muchísimo)`, scale:true});
  Q.push({t:`Del 1 al 5, ¿cuánto has pensado en tu ex en los últimos 3 días? (1 = todo el tiempo, 5 = casi nada)`, scale:true, invert:true});
  Q.push({t:`¿Qué harías diferente si volvieras al inicio de tu historia?`, open:true});
  // Bloque 3: Estado mental (18-25) — cómo está hoy.
  Q.push({t:`Del 1 al 5, ¿cómo está tu ánimo hoy?`, scale:true});
  Q.push({t:`¿Dormiste bien anoche? (1 = nada, 5 = muy bien)`, scale:true});
  Q.push({t:`Del 1 al 5, ¿cuánta esperanza sientes por tu futuro?`, scale:true});
  Q.push({t:`¿Te sientes capaz de estar bien sin tu ex? (1 = no puedo, 5 = totalmente)`, scale:true});
  Q.push({t:`Del 1 al 5, ¿cuánto te quieres a ti mismo/a hoy?`, scale:true});
  Q.push({t:`¿Qué es lo que más te ilusiona de tu vida ahora?`, open:true});
  Q.push({t:`Del 1 al 5, ¿recomendarías este programa a alguien en tu situación?`, scale:true});
  return Q;
}
function renderProgressTest(d){
  const Q = buildTestQuestions();
  const g = userGender();
  $("#day-detail").innerHTML = `
    <div class="day-hero">
      <div class="part">Test de progreso</div>
      <h2>🧠 ¿Cómo estás realmente?</h2>
      <p style="margin-top:8px">Basado en <b>tu historia</b> y <b>tu relación</b>. Responde con honestidad — no hay respuestas correctas, solo tu verdad de hoy.</p>
    </div>
    <div id="test-questions">
      ${Q.map((q,i)=>`
        <div class="block test-q" data-qi="${i}">
          <p><b>${i+1}.</b> ${q.t}</p>
          ${q.scale ? `
            <div class="test-scale" style="display:flex;gap:8px;justify-content:center;margin-top:10px">
              ${[1,2,3,4,5].map(v=>`<button type="button" class="btn btn-ghost test-opt" data-val="${v}" onclick="pickTestOpt(${i},${v})" style="min-width:44px">${v}</button>`).join("")}
            </div>` : `
            <textarea class="journal test-open" rows="3" placeholder="Escribe tu respuesta…" style="margin-top:8px"></textarea>`}
        </div>`).join("")}
    </div>
    <div class="complete-row">
      <button id="test-submit-btn" class="btn btn-primary btn-block" onclick="submitProgressTest(${d})">Ver mi resultado 🧠</button>
      <p id="test-err" style="text-align:center;color:#a33;font-size:.85rem;margin-top:8px"></p>
    </div>`;
  window.scrollTo(0,0);
}
function pickTestOpt(qi, val){
  const block = document.querySelector(`.test-q[data-qi="${qi}"]`);
  if(!block) return;
  block.querySelectorAll(".test-opt").forEach(b=>{
    b.classList.toggle("btn-primary", Number(b.dataset.val) === val);
    b.classList.toggle("btn-ghost", Number(b.dataset.val) !== val);
  });
  block.dataset.answered = val;
}
function submitProgressTest(d){
  const Q = buildTestQuestions();
  let score = 0, answered = 0;
  const openAnswers = [];
  Q.forEach((q,i)=>{
    const block = document.querySelector(`.test-q[data-qi="${i}"]`);
    if(!block) return;
    if(q.scale){
      const v = Number(block.dataset.answered || 0);
      if(v >= 1 && v <= 5){
        answered++;
        score += q.invert ? (6 - v) : v; // invertidas: 1→5, 5→1
      }
    }else{
      const ta = block.querySelector(".test-open");
      const txt = ta ? ta.value.trim() : "";
      if(txt){ answered++; openAnswers.push(txt); }
      // Las abiertas suman 3 puntos base por responder con honestidad.
      if(txt) score += 3;
    }
  });
  const err = $("#test-err");
  if(answered < Q.length){
    err.textContent = `Responde las ${Q.length} preguntas (${answered}/${Q.length}) 💛`;
    return;
  }
  // Puntaje máximo: 17 escalas × 5 + 8 abiertas × 3 = 85 + 24 = 109. Mínimo para avanzar: 65.
  const passed = score >= 65;
  saveTestResult(d, score, passed);
  const g = userGender();
  if(passed){
    $("#day-detail").innerHTML = `
      <div class="day-hero"><div class="part">Test de progreso · Día ${d}</div>
        <h2>🎉 ¡Vas muy bien!</h2></div>
      <div class="block" style="text-align:center">
        <p style="font-size:2.5rem">💛</p>
        <p><b>Tu puntaje: ${score} puntos</b></p>
        <p>Tu historia muestra progreso real. Estás sanando${g==="F"?"":""} — sigue así.</p>
        <p style="color:var(--cocoa-soft);font-size:.9rem">Puedes continuar al siguiente día.</p>
      </div>
      <div class="complete-row">
        <button class="btn btn-primary btn-block" onclick="openDay(${d+1 > 30 ? 30 : d+1})">Continuar →</button>
        <div style="margin-top:12px"><button class="btn btn-ghost btn-block" onclick="backToList()">← Volver al programa</button></div>
      </div>`;
  }else{
    $("#day-detail").innerHTML = `
      <div class="day-hero"><div class="part">Test de progreso · Día ${d}</div>
        <h2>🤗 Tómate tu tiempo</h2></div>
      <div class="block" style="text-align:center">
        <p style="font-size:2.5rem">💛</p>
        <p><b>Tu puntaje: ${score} puntos</b></p>
        <p>Tu corazón todavía está procesando mucho. Eso está bien — sanar no es una carrera.</p>
        <p style="color:var(--cocoa-soft);font-size:.9rem">Te recomendamos repasar los últimos 3 días y volver a intentarlo cuando te sientas list${g==="F"?"a":"o"}.</p>
      </div>
      <div class="complete-row">
        <button class="btn btn-primary btn-block" onclick="renderProgressTest(${d})">Intentar de nuevo 🔄</button>
        <div style="margin-top:12px"><button class="btn btn-ghost btn-block" onclick="backToList()">← Volver al programa</button></div>
      </div>`;
  }
  window.scrollTo(0,0);
}

/* ---------- DIARIO ---------- */
let selMood = null;
function renderDiario(){
  selMood = null;
  $("#mood-row").innerHTML = MOODS.map((m,i)=>
    `<button class="mood" data-i="${i}" onclick="pickMood(${i})">${m.e}</button>`).join("");
  const j = store.get(LS.journal, {});
  const t = j[todayKey()];
  $("#journal-text").value = t ? t.text : "";
  if(t){ pickMood(MOODS.findIndex(m=>m.e===t.mood), true); }
  const keys = Object.keys(j).sort().reverse();
  $("#entries").innerHTML = keys.length ? keys.map(k=>`
    <div class="entry">
      <div class="ehead"><span>${fmtDate(k)}</span><span class="emood">${j[k].mood||""}</span></div>
      <p>${esc(j[k].text)}</p>
    </div>`).join("")
    : `<p style="color:var(--cocoa-soft);text-align:center">Aún no tienes entradas. Escribe tu primera hoy 💛</p>`;
}
function pickMood(i, silent){
  selMood = MOODS[i].e;
  $$("#mood-row .mood").forEach((b,bi)=>b.classList.toggle("sel", bi===i));
  if(!silent) toast(MOODS[i].l);
}
function saveJournal(){
  const text = $("#journal-text").value.trim();
  if(!selMood && !text){ toast("Elige un ánimo o escribe algo primero"); return; }
  const j = store.get(LS.journal, {});
  j[todayKey()] = { mood: selMood || "", text };
  store.set(LS.journal, j);
  toast(t("t.diary_saved"));
  renderDiario();
}
function fmtDate(k){
  const [y,m,d] = k.split("-");
  return `${d}/${m}/${y}`;
}

/* ---------- PROGRESO ---------- */
/* ============================================================
   PERFIL
   ============================================================ */
function renderPerfil(){
  const u = currentUser();
  const box = $("#perfil-content");
  if(!box) return;
  if(!u){ box.innerHTML = `<p style="text-align:center">Inicia sesión para ver tu perfil.</p>`; return; }
  const nombre = esc(u.name || "Usuario");
  const plan = planType();
  const planLabel = plan === "annual" ? "⭐ Plan Anual" : plan === "monthly" ? "Plan Mensual" : "Sin plan";
  const coverUrl = u.coverPhoto || "";
  const photoUrl = u.photo || "";
  box.innerHTML = `
    <div class="profile-cover-wrap">
      <div class="profile-cover" id="profile-cover" ${coverUrl?`style="background-image:url('${coverUrl}')"`:''}>
        ${!coverUrl?'<div class="profile-cover-empty">📷 Agrega una portada</div>':''}
        <button class="cover-edit-btn" onclick="document.getElementById('cover-input').click()" title="Cambiar portada">📷</button>
        <input type="file" id="cover-input" accept="image/jpeg,image/png" style="display:none" onchange="uploadCoverPhoto(this)">
      </div>
      <div class="profile-photo-row">
        <div class="profile-photo" id="profile-photo" ${photoUrl?`style="background-image:url('${photoUrl}')"`:''}>
          ${!photoUrl?'<span style="font-size:2rem">👤</span>':''}
          <button class="photo-edit-btn" onclick="document.getElementById('profile-photo-input').click()" title="Cambiar foto">📷</button>
          <input type="file" id="profile-photo-input" accept="image/jpeg,image/png" style="display:none" onchange="uploadProfilePhoto(this)">
        </div>
      </div>
    </div>
    <div style="text-align:center;padding:10px 0">
      <div style="font-size:1.3rem;font-weight:700">${nombre}</div>
      <div style="color:var(--cocoa-soft);font-size:.9rem;margin:4px 0">${planLabel}</div>
      <div id="perfil-bio-line" style="margin:6px 0;font-size:.95rem;color:var(--cocoa)"></div>
      <div id="perfil-meta-line" style="margin:4px 0;font-size:.85rem;color:var(--cocoa-soft)"></div>
    </div>
    <button class="btn btn-primary btn-block" onclick="openShareModal()" style="margin:14px 0 8px;font-size:1rem;padding:14px">📤 Compartir Reaviva</button>
    <button id="affiliate-btn" class="btn btn-ghost btn-block" onclick="openAffiliateModal()" style="margin:0 0 14px;font-size:1rem;padding:12px">🤝 Afiliado · Gana 5 RV por referido<span id="affiliate-count"></span></button>
    <p style="text-align:center;font-size:.85rem;color:var(--cocoa-soft)">¿Reaviva te está ayudando? Compártelo con alguien que lo necesite 💛</p>
    <div style="margin-top:18px;border-top:1px solid var(--hatch-widget-border);padding-top:14px">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <h3 style="margin:0;font-size:1.05rem">${t("alb.title")}</h3>
        <button class="btn btn-sm btn-primary" onclick="openCreateAlbumModal()">${t("alb.create")}</button>
      </div>
      <div id="perfil-albums" style="margin-top:10px"><p style="text-align:center;color:var(--cocoa-soft)">…</p></div>
    </div>
    <div style="margin-top:18px;border-top:1px solid var(--hatch-widget-border);padding-top:14px">
      <button class="btn btn-ghost btn-block" onclick="togglePwForm()">🔑 Cambiar contraseña</button>
      <div id="pw-form" style="display:none;margin-top:10px">
        <input id="pw-cur" type="password" class="field" placeholder="Contraseña actual" style="margin-bottom:8px">
        <input id="pw-new1" type="password" class="field" placeholder="Nueva contraseña (mín. 6)" style="margin-bottom:8px">
        <input id="pw-new2" type="password" class="field" placeholder="Repite la nueva" style="margin-bottom:8px">
        <div id="pw-form-err" style="color:#a33;font-size:.85rem;min-height:1.2em"></div>
        <button class="btn btn-primary btn-sm" onclick="doProfilePwChange()">Guardar</button>
      </div>
    </div>`;
  renderPerfilAlbums();
  renderPerfilBioMeta();
  loadAffiliateCount();
}

/* Muestra la descripción, el sexo y el país en el perfil. */
function renderPerfilBioMeta(){
  const u = currentUser();
  if(!u) return;
  const bioLine = document.getElementById("perfil-bio-line");
  const metaLine = document.getElementById("perfil-meta-line");
  const bio = (u.bio || "").trim();
  if(bioLine){
    bioLine.innerHTML = bio
      ? `${esc(bio)} <button onclick="editBio()" style="background:none;border:none;cursor:pointer;font-size:.85rem" title="Editar descripción">✏️</button>`
      : `<button onclick="editBio()" class="btn btn-ghost btn-sm">✏️ Agrega una descripción</button>`;
  }
  if(metaLine){
    const parts = [];
    if(u.gender === "M") parts.push("👨 Hombre");
    else if(u.gender === "F") parts.push("👩 Mujer");
    if(u.pais) parts.push("📍 " + esc(u.pais));
    metaLine.textContent = parts.join(" · ");
  }
}

/* Editar la descripción del perfil. */
function editBio(){
  const u = currentUser();
  if(!u) return;
  const actual = (u.bio || "").trim();
  openDynModal(`
    <div style="text-align:center">
      <h3 style="margin:0 0 10px">✏️ Tu descripción</h3>
      <textarea id="bio-input" class="journal" rows="3" maxlength="100"
        placeholder="Cuéntanos algo sobre ti… (10 a 100 caracteres)"
        style="width:100%;margin-bottom:6px">${esc(actual)}</textarea>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <button type="button" class="btn btn-ghost btn-sm" data-emoji-toggle onclick="toggleEmojiGrid('bio-emoji-panel')">😊</button>
        <div id="bio-count" style="font-size:.8rem;color:var(--cocoa-soft)">${actual.length}/100</div>
      </div>
      <div id="bio-emoji-panel" class="emoji-panel" data-target="#bio-input" style="display:none;margin-bottom:10px"></div>
      <div style="display:flex;gap:10px;justify-content:center">
        <button class="btn btn-ghost" onclick="closeDynModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="saveBio()">Guardar</button>
      </div>
    </div>`);
  const ta = document.getElementById("bio-input");
  const cd = document.getElementById("bio-count");
  if(ta && cd) ta.addEventListener("input", ()=>{ cd.textContent = ta.value.length + "/100"; });
}

async function saveBio(){
  const ta = document.getElementById("bio-input");
  const bio = ta ? ta.value.trim().slice(0, 100) : "";
  if(bio.length < 10){
    toast("La descripción debe tener mínimo 10 caracteres ✏️");
    return;
  }
  try{
    const r = await fetch("/api/auth/profile/bio", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ bio })
    });
    const j = await r.json();
    if(!r.ok) throw new Error(j.error || "Error");
    const u = currentUser();
    if(u) u.bio = bio;
    const su = store.get("reaviva_user", null);
    if(su){ su.bio = bio; store.set("reaviva_user", su); }
    closeDynModal();
    toast("Descripción actualizada ✏️");
    renderPerfilBioMeta();
  }catch(e){
    toast("Error: " + e.message);
  }
}

/* Subir foto de perfil (redimensionada a 400x400). */
async function uploadProfilePhoto(input){
  const f = input.files && input.files[0];
  if(!f) return;
  try{
    const dataUrl = await resizeImage(f, 400, 400);
    const r = await fetch("/api/auth/profile/photo", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ photo: dataUrl })
    });
    const j = await r.json();
    if(!r.ok) throw new Error(j.error || "Error");
    // Actualizar el usuario en memoria y re-renderizar.
    const u = currentUser();
    if(u) u.photo = dataUrl;
    const su = store.get("reaviva_user", null);
    if(su){ su.photo = dataUrl; store.set("reaviva_user", su); }
    toast("Foto de perfil actualizada 📷");
    renderPerfil();
  }catch(e){
    toast("Error: " + e.message);
  }
  input.value = "";
}

/* Subir foto de portada (redimensionada a 1200x400). */
/* Paso 1: al elegir la foto, abrir el editor para centrarla antes de publicar. */
async function uploadCoverPhoto(input){
  const f = input.files && input.files[0];
  if(!f) return;
  try{
    const dataUrl = await loadImageDataUrl(f);
    window._coverDraft = dataUrl;
    window._coverPos = 50; // posición vertical en % (50 = centrada)
    openCoverEditor();
  }catch(e){
    toast("Error: " + e.message);
  }
  input.value = "";
}
/* Carga una imagen como dataURL (con respaldo FileReader). */
function loadImageDataUrl(file){
  return new Promise((resolve, reject)=>{
    const fr = new FileReader();
    fr.onload = ()=>resolve(fr.result);
    fr.onerror = ()=>reject(new Error("No se pudo leer el archivo"));
    fr.readAsDataURL(file);
  });
}
/* Paso 2: editor de portada — arrastrar o usar los botones para centrar. */
function openCoverEditor(){
  if(!window._coverDraft) return;
  openDynModal(`
    <div style="text-align:center">
      <h3 style="margin:0 0 6px">🖼️ Ajusta tu portada</h3>
      <p style="color:var(--cocoa-soft);font-size:.85rem;margin:0 0 10px">Arrastra la imagen o usa los botones para centrarla</p>
      <div id="cover-edit-preview"
        style="width:100%;height:150px;border-radius:12px;background-image:url('${window._coverDraft}');background-size:cover;background-position:center ${window._coverPos}%;cursor:grab;touch-action:none;user-select:none"></div>
      <div style="display:flex;gap:10px;justify-content:center;margin:12px 0">
        <button class="btn btn-ghost btn-sm" onclick="nudgeCover(-10)">⬆️ Subir</button>
        <button class="btn btn-ghost btn-sm" onclick="nudgeCover(10)">⬇️ Bajar</button>
        <button class="btn btn-ghost btn-sm" onclick="window._coverPos=50;applyCoverPos()">🎯 Centrar</button>
      </div>
      <div style="display:flex;gap:10px;justify-content:center">
        <button class="btn btn-ghost" onclick="closeDynModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="publishCover()">✅ Publicar</button>
      </div>
    </div>`);
  // Arrastre con mouse o dedo para ajustar la posición vertical.
  const pv = document.getElementById("cover-edit-preview");
  if(pv){
    let dragging = false, startY = 0, startPos = 50;
    const start = (y)=>{ dragging = true; startY = y; startPos = window._coverPos; pv.style.cursor = "grabbing"; };
    const move = (y)=>{
      if(!dragging) return;
      const dh = pv.clientHeight || 150;
      const delta = ((y - startY) / dh) * 100;
      window._coverPos = Math.max(0, Math.min(100, startPos - delta));
      applyCoverPos();
    };
    const end = ()=>{ dragging = false; pv.style.cursor = "grab"; };
    pv.addEventListener("mousedown", e=>start(e.clientY));
    window.addEventListener("mousemove", e=>move(e.clientY));
    window.addEventListener("mouseup", end);
    pv.addEventListener("touchstart", e=>start(e.touches[0].clientY), { passive:true });
    pv.addEventListener("touchmove", e=>move(e.touches[0].clientY), { passive:true });
    pv.addEventListener("touchend", end);
  }
}
function applyCoverPos(){
  const pv = document.getElementById("cover-edit-preview");
  if(pv) pv.style.backgroundPosition = `center ${window._coverPos}%`;
}
function nudgeCover(d){
  window._coverPos = Math.max(0, Math.min(100, window._coverPos + d));
  applyCoverPos();
}
/* Paso 3: publicar la portada ya centrada (recorta según la posición elegida). */
async function publishCover(){
  if(!window._coverDraft) return;
  try{
    const dataUrl = await cropCoverImage(window._coverDraft, window._coverPos);
    const r = await fetch("/api/auth/profile/cover", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ cover: dataUrl })
    });
    const j = await r.json();
    if(!r.ok) throw new Error(j.error || "Error");
    const u = currentUser();
    if(u) u.coverPhoto = dataUrl;
    const su = store.get("reaviva_user", null);
    if(su){ su.coverPhoto = dataUrl; store.set("reaviva_user", su); }
    window._coverDraft = null;
    closeDynModal();
    toast("Portada publicada 📷");
    renderPerfil();
  }catch(e){
    toast("Error: " + e.message);
  }
}
/* Recorta la imagen a 1200x400 respetando la posición vertical elegida (0-100%). */
function cropCoverImage(dataUrl, posPct){
  return new Promise((resolve, reject)=>{
    const img = new Image();
    img.onload = ()=>{
      const TW = 1200, TH = 400;
      const scale = Math.max(TW / img.width, TH / img.height);
      const sw = TW / scale, sh = TH / scale; // ventana de recorte en la imagen original
      const sx = (img.width - sw) / 2;
      const sy = (img.height - sh) * (posPct / 100);
      const cv = document.createElement("canvas");
      cv.width = TW; cv.height = TH;
      cv.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, TW, TH);
      resolve(cv.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = ()=>reject(new Error("No se pudo procesar la imagen"));
    img.src = dataUrl;
  });
}

/* Redimensiona una imagen a maxW x maxH manteniendo proporción.
 * Intenta con objectURL y si falla, con FileReader como respaldo. */
function resizeImage(file, maxW, maxH){
  return new Promise((resolve, reject)=>{
    const viaReader = ()=>{
      const fr = new FileReader();
      fr.onload = ()=>{
        const img2 = new Image();
        img2.onload = ()=>finish(img2);
        img2.onerror = ()=>reject(new Error("No se pudo leer la imagen"));
        img2.src = fr.result;
      };
      fr.onerror = ()=>reject(new Error("No se pudo leer el archivo"));
      fr.readAsDataURL(file);
    };
    const finish = (img)=>{
      try{
        let w = img.width, h = img.height;
        if(!w || !h) return reject(new Error("Imagen sin dimensiones"));
        const ratio = Math.min(maxW / w, maxH / h, 1);
        w = Math.round(w * ratio); h = Math.round(h * ratio);
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/jpeg", 0.85));
      }catch(e){ reject(new Error("No se pudo procesar la imagen")); }
    };
    try{
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = ()=>{ URL.revokeObjectURL(url); finish(img); };
      img.onerror = ()=>{ URL.revokeObjectURL(url); viaReader(); };
      img.src = url;
    }catch(e){ viaReader(); }
  });
}

function togglePwForm(){
  const f = $("#pw-form");
  if(f) f.style.display = f.style.display === "none" ? "" : "none";
}

async function doProfilePwChange(){
  const cur = ($("#pw-cur") || {}).value || "";
  const p1 = ($("#pw-new1") || {}).value || "";
  const p2 = ($("#pw-new2") || {}).value || "";
  const err = $("#pw-form-err");
  if(!isStrongPassword(p1)){ err.textContent = strongPasswordMsg(); return; }
  if(p1 !== p2){ err.textContent = "No coinciden."; return; }
  err.textContent = "Guardando…";
  try{
    const r = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ currentPassword: cur, newPassword: p1 })
    });
    const j = await r.json();
    if(!r.ok){
      err.textContent = j.error || "No se pudo cambiar.";
      if(j.disabled) err.innerHTML += "<br>Tu saldo RV se perdió por la deshabilitación.";
      return;
    }
    err.style.color = "green";
    err.textContent = "Contraseña actualizada ✅";
    $("#pw-cur").value = $("#pw-new1").value = $("#pw-new2").value = "";
  }catch(e){ err.textContent = "Sin conexión."; }
}

function renderProgreso(){
  const done = doneDays();
  $("#prog-stats").innerHTML = `
    <div class="pill"><b>${done.length}/30</b><span>días</span></div>
    <div class="pill"><b>${streak()}</b><span>racha 🔥</span></div>
    <div class="pill"><b>${Math.round(done.length/30*100)}%</b><span>completado</span></div>`;
  const now = new Date(), y = now.getFullYear(), m = now.getMonth();
  const names = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  const first = new Date(y, m, 1).getDay();
  const days = new Date(y, m+1, 0).getDate();
  const sd = startDate();
  let html = `<div class="cal-title">${names[m]} ${y}</div><div class="cal">` +
    ["D","L","M","X","J","V","S"].map(d=>`<div class="dow">${d}</div>`).join("");
  const offset = (first+6)%7;
  for(let i=0;i<offset;i++) html += `<div class="cell empty"></div>`;
  for(let d=1; d<=days; d++){
    const dayNum = Math.floor((new Date(y,m,d,12).getTime() - sd.getTime())/86400000)+1;
    const cls = done.includes(dayNum) ? "done" : (d===now.getDate()?"today":"");
    html += `<div class="cell ${cls}">${d}</div>`;
  }
  html += "</div>";
  $("#cal").innerHTML = html;
}

/* ============================================================
   COMUNIDAD ANÓNIMA 💬
   ============================================================ */
/* HTML de un mensaje del chat grupal.
 * Se reutiliza en la vista completa (#panel-comunidad) y en la ventanita flotante.
 * Efecto lateral: actualiza communityUsers para abrir DMs al hacer clic en un usuario. */
function communityMsgHtml(c){
  // Mensaje de sistema (ej. "👑 El administrador se ha conectado"):
  // banner centrado, sin avatar ni acciones.
  if(c.msg_type === "system"){
    return `<div class="system-msg"><span>${esc(c.texto)}</span></div>`;
  }
  if(c.uid) communityUsers[c.uid] = { nombre: c.nombre, foto: c.foto, avatar: c.avatar };
  // Sin plan → "Guest" + foto; con plan → nombre real + foto.
  // La foto viene validada del servidor (data:image/...); esc() la protege.
  const avatar = (c.foto && String(c.foto).startsWith("data:image/"))
    ? `<img src="${esc(c.foto)}" class="comment-photo" alt="">`
    : esc(c.avatar || "💛");
  // Si el mensaje empieza con #Tema, se resalta en color acento.
  const [tag, resto] = splitTopicTag(c.texto);
  let body;
  if(c.msg_type === "photo" && !c.foto_eliminada && c.foto_msg && String(c.foto_msg).startsWith("data:image/")){
    const caption = tag
      ? `<p><b class="topic-tag">${esc(tag)}</b> ${esc(resto)}</p>`
      : (resto ? `<p>${esc(resto)}</p>` : "");
    body = `<div class="chat-photo-wrap" data-photo-msg="${c.id}">
              <img src="${esc(c.foto_msg)}" class="chat-photo" alt="Foto temporal">
              <span class="chat-photo-timer">⏳ ${c.foto_segundos || 30}s</span>
            </div>${caption}`;
    // Armar la cuenta regresiva para eliminarla visualmente a tiempo.
    setTimeout(()=>armPhotoCountdown(c.id, c.foto_segundos || 30), 0);
  }else{
    body = tag
      ? `<p><b class="topic-tag">${esc(tag)}</b> ${esc(resto)}</p>`
      : `<p>${esc(c.texto)}</p>`;
  }
  // Avatar y nombre clicables → mensaje privado (usuarios con plan).
  // Tooltip al pasar el mouse: "💬 Chat privado".
  const tipText = planType() === "free" ? "" : "💬 Chat privado";
  const clickAttr = c.uid ? ` onclick="onCommunityUserClick(${Number(c.uid)})" style="cursor:pointer"${tipText ? ` title="${tipText}"` : ""}` : "";
  // Indicador sutil de expiración del mensaje (según el plan del autor).
  const expiryTag = (c.msg_type !== "photo" && c.expira_en_horas != null)
    ? `<span class="msg-expiry" title="Este mensaje se elimina automáticamente">⏳ ${Number(c.expira_en_horas) < 1 ? "menos de 1h" : Math.round(c.expira_en_horas) + "h"}</span>`
    : "";
  // Icono 👁️ para ocultar la publicación (solo usuarios con plan).
  // El ocultamiento es personal: el mensaje sigue visible para los demás.
  const hideBtn = isPaid()
    ? `<button class="hide-msg-btn" title="Ocultar esta publicación" onclick="hideCommunityMsg(event, ${Number(c.id)})">👁️</button>`
    : "";
  return `
  <div class="comment-card" data-msg-id="${Number(c.id)}">
    <div class="comment-avatar"${clickAttr}>${avatar}</div>
    <div class="comment-body">
      <div class="comment-head"><b${clickAttr}>${esc(c.nombre || "Guest")}</b>${flagHtml(c.uid)}${c.promo ? `<span class="promo-badge" title="Mensaje promocional">📢</span>` : ""}${c.repost ? `<span class="repost-badge" title="Republicación automática">🔁</span>` : ""}${expiryTag}<span>${esc(c.fecha)}</span>${hideBtn}</div>
      ${body}
      ${reactionHtml(c.id, "community", c.likes, c.dislikes, c.mi_reaccion)}
    </div>
  </div>`;
}

/* ---------- Chat comunitario 💬 (fuerza bajar al final tras publicar) ---------- */
let forceChatBottom = false;

async function renderComunidad(){
  const list = $("#community-list");
  list.innerHTML = `<p style="text-align:center;color:var(--cocoa-soft)">Cargando comentarios…</p>`;
  // Los temas se cargan en paralelo (solo visibles con plan).
  loadTopics().catch(()=>{});
  // Saldo de RV en la cabecera del chat (solo con plan).
  loadRVBalance().catch(()=>{});
  // Botón "Ver ocultos" 👁️‍🗨️: solo visible para usuarios con plan.
  const hiddenBtn = $("#hidden-toggle-btn");
  if(hiddenBtn) hiddenBtn.style.display = isPaid() ? "" : "none";
  // El botón de foto: habilitado con plan, bloqueado (visible) sin plan.
  const photoBtn = $("#photo-btn");
  if(photoBtn){
    if(isPaid()){
      photoBtn.style.display = "";
      clearLockedTip(photoBtn);
      photoBtn.onclick = function(){ pickChatPhoto(); };
    }else{
      photoBtn.style.display = "";
      photoBtn.classList.add("locked-feature");
      photoBtn.onclick = function(){ openUpgradeModal("Actualiza tu plan 💎 para enviar fotos"); };
      setLockedTip(photoBtn, "Actualiza tu plan 💎 para enviar fotos");
    }
  }
  try{
    const r = await fetch("/api/community", { headers: authHeaders() });
    if(!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    // Si el usuario está muteado por spam, deshabilitar el compositor (solo lectura).
    if(j.muted) disableCommunityComposer();
    // Prueba culminada o cobro vencido sin RV: solo lectura (ver sin publicar).
    if(j.trialEnded || j.billingBlocked) applyReadOnlyUI(j.billingBlocked ? "billing" : "trial");
    refreshLinkBtn(j.rv);
    // Botón de usuarios en línea 🟢🔴.
    if(j.onlineCount != null) updateOnlineBtn(j.onlineCount);
    const items = (j.comentarios || []).slice().reverse(); // cronológico: lo nuevo ABAJO
    const wasNearBottom = forceChatBottom || !list.dataset.loaded ||
      (list.scrollHeight - list.scrollTop - list.clientHeight < 140);
    forceChatBottom = false;
    // Mapa uid → datos para abrir DMs al hacer clic (sin exponer nada extra).
    communityUsers = {};
    list.innerHTML = items.map(c=>communityMsgHtml(c)).join("") ||
      `<div class="empty-state"><div style="font-size:2.5rem">💛</div>
       <p><b>Sé la primera persona en compartir</b></p>
       <p style="font-size:.85rem;color:var(--cocoa-soft)">Tu historia puede ayudar a alguien que lo necesita.</p></div>`;
    list.dataset.loaded = "1";
    if(wasNearBottom) list.scrollTop = list.scrollHeight;
    // Banderitas 🚩: cargar niveles de los usuarios visibles y pintar cada bandera.
    refreshFlagLevels(Object.keys(communityUsers).map(Number)).catch(()=>{});
  }catch(e){
    list.innerHTML = `<p style="text-align:center;color:#a33">Error cargando la comunidad</p>`;
  }
}

/* ---------- reacciones 👍👎 (chat grupal y mensajes privados) ----------
 * Todos los usuarios autenticados pueden reaccionar. Un clic alterna:
 * sin reacción → la pone; misma reacción → la quita; opuesta → la cambia. */
function reactionHtml(msgId, msgType, likes, dislikes, miReaccion, handler){
  msgId = Number(msgId);
  handler = handler || "toggleReaction";
  const l = Number(likes) || 0, d = Number(dislikes) || 0;
  const likeOn = miReaccion === "like" ? " on" : "";
  const disOn = miReaccion === "dislike" ? " on" : "";
  return `<div class="reactions" data-reactions="${msgType}:${msgId}">
    <button class="react-btn${likeOn}" title="${esc(t("react.like"))}"
      onclick="${handler}(event, ${msgId}, '${esc(msgType)}', 'like')">👍 <span class="react-n">${l}</span></button>
    <button class="react-btn${disOn}" title="${esc(t("react.dislike"))}"
      onclick="${handler}(event, ${msgId}, '${esc(msgType)}', 'dislike')">👎 <span class="react-n">${d}</span></button>
  </div>`;
}

/* Versión para ventanas flotantes de DM (actualiza dentro de la ventana). */
function reactionHtmlDm(msgId, likes, dislikes, miReaccion){
  return reactionHtml(msgId, "dm", likes, dislikes, miReaccion, "toggleReactionDm");
}

async function toggleReaction(ev, msgId, msgType, reaction){
  if(ev){ ev.stopPropagation(); ev.preventDefault(); }
  return doToggleReaction(msgId, msgType, reaction, document);
}
async function toggleReactionDm(ev, msgId, msgType, reaction){
  if(ev){ ev.stopPropagation(); ev.preventDefault(); }
  const win = ev.target.closest(".dm-win");
  return doToggleReaction(msgId, msgType, reaction, win || document);
}
async function doToggleReaction(msgId, msgType, reaction, root){
  msgId = Number(msgId);
  const sel = `[data-reactions="${msgType}:${msgId}"]`;
  const box = (root || document).querySelector(sel);
  // UI optimista: actualiza al instante, el servidor confirma.
  let prevState = null;
  if(box){
    const btns = box.querySelectorAll(".react-btn");
    prevState = box.innerHTML;
    const likeBtn = btns[0], disBtn = btns[1];
    const likeN = likeBtn.querySelector(".react-n"), disN = disBtn.querySelector(".react-n");
    const likeOn = likeBtn.classList.contains("on"), disOn = disBtn.classList.contains("on");
    if(reaction === "like"){
      if(likeOn){ likeBtn.classList.remove("on"); likeN.textContent = Math.max(0, Number(likeN.textContent) - 1); }
      else{
        likeBtn.classList.add("on"); likeN.textContent = Number(likeN.textContent) + 1;
        if(disOn){ disBtn.classList.remove("on"); disN.textContent = Math.max(0, Number(disN.textContent) - 1); }
      }
    }else{
      if(disOn){ disBtn.classList.remove("on"); disN.textContent = Math.max(0, Number(disN.textContent) - 1); }
      else{
        disBtn.classList.add("on"); disN.textContent = Number(disN.textContent) + 1;
        if(likeOn){ likeBtn.classList.remove("on"); likeN.textContent = Math.max(0, Number(likeN.textContent) - 1); }
      }
    }
  }
  try{
    const r = await fetch("/api/reactions", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ message_id: msgId, message_type: msgType, reaction })
    });
    const j = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(j.error || ("HTTP " + r.status));
    // Confirma con los conteos reales del servidor.
    if(box){
      const btns = box.querySelectorAll(".react-btn");
      btns[0].querySelector(".react-n").textContent = Number(j.likes) || 0;
      btns[1].querySelector(".react-n").textContent = Number(j.dislikes) || 0;
      btns[0].classList.toggle("on", j.mi_reaccion === "like");
      btns[1].classList.toggle("on", j.mi_reaccion === "dislike");
    }
  }catch(e){
    // Revierte la UI optimista si falló.
    if(box && prevState != null) box.innerHTML = prevState;
    toast(e.message || "No se pudo registrar tu reacción.");
  }
}

/* ---------- banderas de advertencia 🚩 (moderación comunitaria) ----------
 * Junto a cada nombre: banderita blanca pequeña. Hover → tooltip explicativo.
 * Click → confirm() → POST /api/flags. Nivel = nº de usuarios distintos que
 * banderearon: 1=azul, 2=amarilla, 3=negra, 4=roja (deshabilita el chat). */
const FLAG_COLORS = ["#ffffff", "#2b7fff", "#e6a800", "#1a1a1a", "#e02424"];
let flagLevels = {}; // uid -> level (0..4)

function flagStyleFor(level){
  level = Math.min(4, Math.max(0, Number(level) || 0));
  const shadow = (level === 0 || level === 2) ? ";text-shadow:0 0 2px rgba(0,0,0,.5)" : "";
  return `color:${FLAG_COLORS[level]}${shadow}`;
}

/* HTML de la banderita junto a un nombre. Vacío para uno mismo. */
function flagHtml(uid){
  uid = Number(uid);
  if(!uid) return "";
  const me = currentUser();
  if(me && Number(me.id) === uid) return "";
  const level = flagLevels[uid] || 0;
  return `<span class="flag-btn" data-flag-uid="${uid}" title="${esc(t("flag.tip"))}" ` +
    `style="${flagStyleFor(level)};cursor:pointer" onclick="flagUser(event, ${uid})">⚑</span>`;
}

/* Carga los niveles de los uids visibles y repinta las banderitas. */
async function refreshFlagLevels(uids){
  uids = [...new Set((uids || []).map(Number).filter(n => n > 0))].slice(0, 100);
  if(!uids.length) return;
  try{
    const r = await fetch("/api/flags/levels?ids=" + uids.join(","), { headers: authHeaders() });
    const j = await r.json();
    if(j && j.levels) Object.assign(flagLevels, j.levels);
    document.querySelectorAll("[data-flag-uid]").forEach(el => {
      const id = Number(el.dataset.flagUid);
      el.setAttribute("style", flagStyleFor(flagLevels[id] || 0) + ";cursor:pointer");
    });
  }catch(e){ /* las banderas quedan blancas por defecto */ }
}

async function flagUser(ev, uid){
  if(ev){ ev.stopPropagation(); ev.preventDefault(); }
  uid = Number(uid);
  const me = currentUser();
  if(me && Number(me.id) === uid){ toast(t("flag.self")); return; }
  if(!confirm(t("flag.confirm"))) return;
  try{
    const r = await fetch("/api/flags", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ target_user_id: uid })
    });
    const j = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(j.error || ("HTTP " + r.status));
    flagLevels[uid] = j.level;
    document.querySelectorAll(`[data-flag-uid="${uid}"]`).forEach(el => {
      el.setAttribute("style", flagStyleFor(j.level) + ";cursor:pointer");
    });
    toast(t("flag.sent"));
  }catch(e){
    toast(e.message);
  }
}

/* ---------- ocultar publicaciones (personal, solo con plan) ---------- */
/* El ojo 👁️ oculta el mensaje SOLO para mí; los demás lo siguen viendo. */
async function hideCommunityMsg(ev, msgId){
  if(ev) ev.stopPropagation();
  msgId = Number(msgId);
  try{
    const r = await fetch("/api/community/hide", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ message_id: msgId })
    });
    const j = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(j.error || ("HTTP " + r.status));
    const card = document.querySelector(`.comment-card[data-msg-id="${msgId}"]`);
    if(card){
      card.style.transition = "opacity .4s";
      card.style.opacity = "0";
      setTimeout(()=>card.remove(), 400);
    }
    toast("Publicación oculta 👁️");
  }catch(e){
    toast(e.message || "No se pudo ocultar.");
  }
}

/* Volver a mostrar un mensaje que oculté. */
async function unhideCommunityMsg(msgId){
  msgId = Number(msgId);
  try{
    const r = await fetch("/api/community/unhide", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ message_id: msgId })
    });
    const j = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(j.error || ("HTTP " + r.status));
    const card = document.querySelector(`.hidden-card[data-msg-id="${msgId}"]`);
    if(card) card.remove();
    toast("Publicación visible de nuevo 👁️");
  }catch(e){
    toast(e.message || "No se pudo mostrar.");
  }
}

/* Mostrar/ocultar la lista de publicaciones que oculté. */
let showingHidden = false;
async function toggleHiddenMsgs(){
  const btn = $("#hidden-toggle-btn");
  const list = $("#hidden-list");
  if(!list) return;
  showingHidden = !showingHidden;
  if(!showingHidden){
    list.style.display = "none";
    list.innerHTML = "";
    if(btn) btn.classList.remove("active");
    return;
  }
  if(btn) btn.classList.add("active");
  list.innerHTML = `<p style="text-align:center;color:var(--cocoa-soft)">Cargando…</p>`;
  list.style.display = "";
  try{
    const r = await fetch("/api/community/hidden", { headers: authHeaders() });
    const j = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(j.error || ("HTTP " + r.status));
    const items = j.ocultos || [];
    list.innerHTML = items.map(m => `
      <div class="comment-card hidden-card" data-msg-id="${Number(m.id)}">
        <div class="comment-avatar">${m.foto ? `<img src="${esc(m.foto)}" alt="">` : esc(m.avatar || "💛")}</div>
        <div class="comment-body">
          <div class="comment-head"><b>${esc(m.nombre || "Guest")}</b><span>${esc(m.fecha)}</span>
            <button class="hide-msg-btn" title="Volver a mostrar" onclick="unhideCommunityMsg(${Number(m.id)})">👁️‍🗨️</button>
          </div>
          <p>${esc(m.texto)}</p>
        </div>
      </div>`).join("") ||
      `<p style="text-align:center;color:var(--cocoa-soft)">No tienes publicaciones ocultas.</p>`;
  }catch(e){
    list.innerHTML = `<p style="text-align:center;color:#a33">${esc(e.message)}</p>`;
  }
}

async function postCommunity(){
  const box = $("#community-text");
  const text = box ? box.value.trim() : "";
  if(!text){ toast(t("t.write_something")); return; }
  try{
    const body = { text };
    if(selectedTopicId) body.topic_id = selectedTopicId;
    const r = await fetch("/api/community", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body)
    });
    const j = await r.json().catch(()=>({}));
    if(!r.ok){
      if(handleSpamError(j)) return;
      throw new Error(j.error || ("HTTP " + r.status));
    }
    if(j.id){ myMsgIds.add(j.id); seenMsgIds.add(j.id); }
    if(box) box.value = "";
    hideRVBanner();
    if(typeof j.rv === "number") loadRVBalance();
    toast(j.promo ? "¡Publicado con RV! 📢 Gracias por compartir 💛" : "¡Publicado! Gracias por compartir 💛");
    forceChatBottom = true; // tras publicar, bajar al mensaje nuevo
    renderComunidad();
  }catch(e){
    toast(e.message);
  }
}

/* ============================================================
   TEMAS TEMPORALES DEL CHAT 💬 (solo con plan pagado)
   Cada tema dura 2 horas. Al publicarlo, el mensaje sale como
   "#NombreDelTema tu mensaje".
   ============================================================ */
let selectedTopicId = null;
let cachedTopics = [];

function formatTopicTime(min){
  min = Math.max(0, Math.round(min || 0));
  if (min >= 60) return Math.floor(min / 60) + "h " + (min % 60) + "m";
  return min + "m";
}

/* Extrae el hashtag inicial del texto: "#Ansiedad Hola" → ["#Ansiedad", "Hola"] */
function splitTopicTag(texto){
  const m = String(texto || "").match(/^(#[^\s#]{1,40})\s([\s\S]*)$/);
  return m ? [m[1], m[2]] : [null, String(texto || "")];
}

async function loadTopics(){
  const bar = $("#topics-bar");
  const scroll = $("#topics-scroll");
  if(!bar || !scroll) return;
  const topicBtn = $("#topic-add-btn");
  // Sin plan: la barra se muestra con el botón bloqueado (visible pero deshabilitado).
  if(!isPaid()){
    bar.style.display = "flex";
    scroll.innerHTML = `<span class="topics-empty">Los temas son para miembros con plan 💎</span>`;
    if(topicBtn){
      topicBtn.classList.add("locked-feature");
      topicBtn.onclick = function(){ openUpgradeModal("Actualiza tu plan 💎 para crear temas"); };
      setLockedTip(topicBtn, "Actualiza tu plan 💎 para crear temas");
    }
    selectedTopicId = null;
    return;
  }
  if(topicBtn){
    clearLockedTip(topicBtn);
    topicBtn.onclick = function(){ openTopicModal(); };
  }
  bar.style.display = "flex";
  try{
    const r = await fetch("/api/topics", { headers: authHeaders() });
    if(!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    cachedTopics = j.temas || [];
    // Si el tema seleccionado expiró, deseleccionarlo.
    if(selectedTopicId && !cachedTopics.some(t => t.id === selectedTopicId)){
      selectedTopicId = null;
    }
    renderTopicPills();
  }catch(e){
    scroll.innerHTML = `<span class="topics-empty">No se pudieron cargar los temas</span>`;
  }
}

function renderTopicPills(){
  const scroll = $("#topics-scroll");
  if(!scroll) return;
  scroll.innerHTML = cachedTopics.map(t => `
    <button class="topic-pill${t.id === selectedTopicId ? " active" : ""}"
            onclick="selectTopic(${t.id})" title="Creado por ${esc(t.creador)}">
      #${esc(t.nombre)} <span class="topic-time">${formatTopicTime(t.minutosRestantes)}</span>
    </button>`).join("") ||
    `<span class="topics-empty">No hay temas activos. ¡Crea el primero! 🎉</span>`;
}

function selectTopic(id){
  selectedTopicId = (selectedTopicId === id) ? null : id;
  renderTopicPills();
  updateTopicHint();
}

function updateTopicHint(){
  let hint = $("#topic-hint");
  const composer = document.querySelector(".community-composer");
  const t = cachedTopics.find(x => x.id === selectedTopicId);
  if(t){
    if(!hint && composer){
      hint = document.createElement("div");
      hint.id = "topic-hint";
      hint.className = "topic-hint";
      composer.prepend(hint);
    }
    if(hint){
      hint.innerHTML = `Publicarás en <b>#${esc(t.nombre)}</b> <button type="button" class="topic-clear" onclick="selectTopic(${t.id})" title="Quitar tema">✕</button>`;
    }
  }else if(hint){
    hint.remove();
  }
}

function openTopicModal(){
  if(!isPaid()){ toast(t("chat.upgrade_topic")); return; }
  $("#topic-modal").classList.add("open");
  const inp = $("#topic-name");
  if(inp){ inp.value = ""; $("#topic-err").textContent = ""; setTimeout(()=>inp.focus(), 100); }
}
function closeTopicModal(){ $("#topic-modal").classList.remove("open"); }

async function createTopic(){
  const inp = $("#topic-name");
  const err = $("#topic-err");
  const name = inp ? inp.value.trim() : "";
  if(err) err.textContent = "";
  if(!name){ if(err) err.textContent = "Escribe un nombre para el tema."; return; }
  try{
    const r = await fetch("/api/topics", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ name })
    });
    const j = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(j.error || ("HTTP " + r.status));
    closeTopicModal();
    toast(j.mensaje || "Tema creado 🎉");
    selectedTopicId = j.id || null;
    await loadTopics();
    updateTopicHint();
  }catch(e){
    if(err) err.textContent = e.message;
  }
}

/* ============================================================
   FOTOS TEMPORALES (30s) 📷 + EMOJIS 😊 — solo con plan las fotos
   ============================================================ */
const EMOJIS = ["😊","😂","❤️","💛","🙏","😢","😮","😡","👏","🎉","💪","🌟","⭐","🔥","💫","🌈","☀️","🌙","🦋","🌻","🌷","🍀","🤗","😌","🥺","💔","❤️‍🩹","🧠","💭","✨","🕊️","🤍"];

/* Cierra todos los paneles de emojis al hacer clic fuera de ellos. */
document.addEventListener("click", (e)=>{
  if(e.target.closest(".emoji-panel")) return; // clic dentro del panel
  if(e.target.closest("[data-emoji-toggle]")) return; // clic en el botón 😊
  document.querySelectorAll(".emoji-panel").forEach(p=>{ p.style.display = "none"; });
});

function toggleEmojiPanel(){
  toggleEmojiGrid("emoji-panel");
}

function insertEmojiInto(sel, e){
  const box = typeof sel === "string"
    ? (document.getElementById(sel) || document.querySelector(sel))
    : sel;
  if(!box) return;
  const start = (box.selectionStart != null) ? box.selectionStart : box.value.length;
  const end = (box.selectionEnd != null) ? box.selectionEnd : box.value.length;
  box.value = box.value.slice(0, start) + e + box.value.slice(end);
  box.focus();
  box.selectionStart = box.selectionEnd = start + e.length;
  box.dispatchEvent(new Event("input", { bubbles: true }));
}
function insertEmoji(e){
  insertEmojiInto("#community-text", e);
}
/* Panel de emojis genérico: lo llena y lo muestra/oculta. */
function toggleEmojiGrid(panelId){
  const panel = document.getElementById(panelId);
  if(!panel) return;
  if(panel.style.display === "none" || !panel.innerHTML){
    const target = panel.dataset.target;
    panel.innerHTML = EMOJIS.map(e =>
      `<button type="button" class="emoji-btn" data-emoji="${e}">${e}</button>`
    ).join("");
    panel.querySelectorAll(".emoji-btn").forEach(b=>{
      b.onclick = ()=>insertEmojiInto(target, b.dataset.emoji);
    });
    panel.style.display = "grid";
  }else{
    panel.style.display = "none";
  }
}

/* Fotos temporales: solo usuarios con plan. */
function pickChatPhoto(){
  if(!isPaid()){ toast(t("chat.upgrade_photo")); return; }
  const inp = $("#chat-photo-input");
  if(inp) inp.click();
}

function sendChatPhoto(input){
  const file = input && input.files && input.files[0];
  input.value = "";
  if(!file) return;
  if(!file.type.startsWith("image/")){ toast("Elige una imagen válida."); return; }
  // Redimensionar a máx 800px en el cliente para no saturar el servidor.
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    URL.revokeObjectURL(url);
    const MAX = 800;
    let w = img.width, h = img.height;
    if(w > MAX || h > MAX){
      const k = MAX / Math.max(w, h);
      w = Math.round(w * k); h = Math.round(h * k);
    }
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    cv.getContext("2d").drawImage(img, 0, 0, w, h);
    const dataUrl = cv.toDataURL("image/jpeg", 0.75);
    postChatPhoto(dataUrl);
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast("No se pudo leer la imagen."); };
  img.src = url;
}

async function postChatPhoto(dataUrl){
  toast(t("chat.sending_photo"));
  try{
    const body = { photo: dataUrl };
    const box = $("#community-text");
    const caption = box ? box.value.trim() : "";
    if(caption) body.text = caption;
    if(selectedTopicId) body.topic_id = selectedTopicId;
    const r = await fetch("/api/community", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body)
    });
    const j = await r.json().catch(()=>({}));
    if(!r.ok){
      if(handleSpamError(j)) return;
      throw new Error(j.error || ("HTTP " + r.status));
    }
    if(j.id){ myMsgIds.add(j.id); seenMsgIds.add(j.id); }
    if(box) box.value = "";
    toast(t("chat.photo_sent"));
    renderComunidad();
  }catch(e){
    toast(e.message);
  }
}

/* Cuenta regresiva de fotos temporales: reemplaza por "📷 Foto eliminada". */
const photoTimers = {};
function armPhotoCountdown(msgId, seconds){
  if(photoTimers[msgId]) clearTimeout(photoTimers[msgId]);
  const ms = Math.max(1000, (seconds || 30) * 1000);
  photoTimers[msgId] = setTimeout(() => {
    const el = document.querySelector(`[data-photo-msg="${msgId}"]`);
    if(el){
      el.innerHTML = `<p class="photo-deleted">📷 Foto eliminada</p>`;
    }
    delete photoTimers[msgId];
  }, ms);
}

/* ============================================================
   SONIDO DE NOTIFICACIONES DEL CHAT 🔔
   Suena un "ding" cuando llega un mensaje nuevo de otro usuario
   mientras el chat está abierto. Preferencia en localStorage.
   ============================================================ */
function chatSoundOn(){
  return localStorage.getItem("reaviva_chat_sound") !== "0";
}
function toggleChatSound(){
  const on = !chatSoundOn();
  localStorage.setItem("reaviva_chat_sound", on ? "1" : "0");
  updateSoundIcon();
  toast(on ? "Sonido activado 🔔" : "Sonido silenciado 🔕");
}
function updateSoundIcon(){
  const btn = $("#chat-sound-btn");
  if(btn) btn.textContent = chatSoundOn() ? "🔔" : "🔕";
}
/* Ding de dos tonos con Web Audio API (sin archivos externos). */
let audioCtx = null;
function playDing(){
  if(!chatSoundOn()) return;
  try{
    if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if(audioCtx.state === "suspended") audioCtx.resume();
    const t0 = audioCtx.currentTime;
    [[880, 0], [1320, 0.15]].forEach(([freq, dt]) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + dt);
      gain.gain.exponentialRampToValueAtTime(0.25, t0 + dt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.15);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t0 + dt);
      osc.stop(t0 + dt + 0.16);
    });
  }catch(e){ /* audio no disponible: silencioso */ }
}

/* IDs de mensajes ya vistos + IDs de mis propios mensajes (para no
 * sonar con mis publicaciones). El payload no trae user_id por anonimato. */
const seenMsgIds = new Set();
const myMsgIds = new Set();
let chatPollTimer = null;

/* Contador de mensajes del chat grupal SIN LEER: globito rojo con el número
 * que se va SUMANDO cada vez que alguien escribe y no lo has leído; solo
 * vuelve a 0 cuando abres el chat. Se guarda por usuario en el dispositivo. */
let groupUnread = 0;
function groupUnreadKey(){ const u = currentUser(); return "reaviva_group_unread_" + (u ? u.id : "0"); }
function loadGroupUnread(){ try{ groupUnread = parseInt(localStorage.getItem(groupUnreadKey()) || "0", 10) || 0; }catch(e){ groupUnread = 0; } }
function saveGroupUnread(){ try{ localStorage.setItem(groupUnreadKey(), String(groupUnread)); }catch(e){} }
function updateGroupBadge(){
  const txt = groupUnread > 99 ? "99+" : String(groupUnread);
  const b = $("#group-badge");
  if(b){ b.style.display = groupUnread > 0 ? "" : "none"; b.textContent = txt; }
  if(typeof groupWinOpen === "function" && groupWinOpen()){
    const wb = groupWin.el.querySelector(".group-win-unread");
    if(wb){ wb.style.display = groupUnread > 0 ? "" : "none"; wb.textContent = txt; }
  }
}
function markGroupRead(){ groupUnread = 0; saveGroupUnread(); updateGroupBadge(); }
function groupChatVisible(){
  if(document.hidden) return false;
  const active = document.querySelector(".tab.active");
  if(active && active.dataset.tab === "comunidad") return true;
  return (typeof groupWinOpen === "function") && groupWinOpen() && !groupWin.minimized;
}

function startChatPoll(){
  stopChatPoll();
  updateSoundIcon();
  // Registrar los IDs actuales como vistos (sin sonido inicial).
  fetch("/api/community", { headers: authHeaders() })
    .then(r => r.ok ? r.json() : null)
    .then(j => {
      if(!j) return;
      if(j.onlineCount != null) updateOnlineBtn(j.onlineCount);
      if(j.comentarios) j.comentarios.forEach(c => seenMsgIds.add(c.id));
    })
    .catch(()=>{});
  chatPollTimer = setInterval(async () => {
    if(document.hidden) return; // no gastar datos con la pestaña oculta
    try{
      const r = await fetch("/api/community", { headers: authHeaders() });
      if(!r.ok) return;
      const j = await r.json();
      // Actualizar el botón de en línea en cada ciclo 🟢🔴.
      if(j.onlineCount != null) updateOnlineBtn(j.onlineCount);
      const nuevos = (j.comentarios || []).filter(c => !seenMsgIds.has(c.id));
      if(nuevos.length){
        nuevos.forEach(c => seenMsgIds.add(c.id));
        // Suena solo por mensajes de OTROS usuarios.
        const deOtros = nuevos.filter(c => !myMsgIds.has(c.id));
        if(deOtros.length){
          playDing();
          // Si NO está mirando el chat, el contador rojo SUMA los no leídos.
          if(!groupChatVisible()){ groupUnread += deOtros.length; saveGroupUnread(); }
        }
        updateGroupBadge();
        // Refrescar la ventanita flotante si está abierta; si no, la vista completa.
        if(typeof groupWinOpen === "function" && groupWinOpen()) paintGroupWinMessages(j);
        else renderComunidad();
      }
    }catch(e){ /* reintentar en el próximo ciclo */ }
  }, 8000); // 8s: los mensajes nuevos aparecen casi al instante
}
function stopChatPoll(){
  if(chatPollTimer){ clearInterval(chatPollTimer); chatPollTimer = null; }
}

/* ============================================================
   MENSAJES PRIVADOS (DM) 💬 — usuarios con plan (mensual o anual)
   - Clic en un usuario de la comunidad → chat privado (sin ver su
     nombre real: solo iniciales + país + foto).
   - Límite diario de conversaciones únicas: anual 90/día, mensual 15/día.
     Al excederlo, el mensual ve el modal de actualización a anual.
   - Cada mensaje se elimina a las 48 horas.
   ============================================================ */
let communityUsers = {}; // uid → { nombre, foto, avatar }
let dmPollTimer = null;

function dmAvatarHtml(p){
  return (p.foto && String(p.foto).startsWith("data:image/"))
    ? `<img src="${esc(p.foto)}" class="comment-photo" alt="">`
    : esc(p.avatar || "💛");
}

/* ---------- lista de conversaciones (pestaña "Privados") ---------- */
/* Al tocar una conversación se abre la ventana flotante. */
async function renderDmList(){
  const list = $("#dm-list");
  const chat = $("#dm-chat");
  if(chat) chat.style.display = "none";
  if(list) list.style.display = "";
  if(planType() === "free"){
    if(list) list.innerHTML = `
      <div class="empty-state"><div style="font-size:2.5rem">💎</div>
      <p><b>${esc(t("dm.title"))}</b></p>
      <p style="font-size:.85rem;color:var(--cocoa-soft)">${esc(t("dm.only_plan"))}</p>
      <button class="btn btn-primary" onclick="openPaywall()" style="margin-top:10px">💎</button>
      </div>`;
    return;
  }
  if(list) list.innerHTML = `<p style="text-align:center;color:var(--cocoa-soft)">…</p>`;
  try{
    const r = await fetch("/api/dm/conversations", { headers: authHeaders() });
    if(!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    const convs = j.conversaciones || [];
    if(!convs.length){
      list.innerHTML = `
        <div class="empty-state"><div style="font-size:2.5rem">💬</div>
        <p><b>${esc(t("dm.title"))}</b></p>
        <p style="font-size:.85rem;color:var(--cocoa-soft)">${esc(t("dm.empty"))}</p></div>`;
      return;
    }
    list.innerHTML = convs.map(c => `
      <div class="dm-conv" onclick="openDmWindow(${Number(c.uid)})">
        <div class="comment-avatar">${dmAvatarHtml(c)}</div>
        <div class="dm-conv-body">
          <div class="dm-conv-head"><b>${esc(c.nombre)}</b><span>${esc(c.fecha || "")}</span></div>
          <p class="dm-preview">${esc(c.ultimo || "")}</p>
        </div>
        ${c.noLeidos ? `<span class="dm-unread">${c.noLeidos}</span>` : ""}
      </div>`).join("");
  }catch(e){
    if(list) list.innerHTML = `<p style="text-align:center;color:#a33">⚠️</p>`;
  }
}

/* Clic en avatar/nombre de la comunidad → ventana flotante de chat. */
function onCommunityUserClick(uid){
  uid = Number(uid);
  const me = currentUser();
  if(me && Number(me.id) === uid){ toast(t("dm.is_you")); return; }
  const target = communityUsers[uid] || { nombre: t("dm.win_user"), foto: null, avatar: "💛" };
  if(planType() !== "free"){
    openDmWindow(uid, target);
  }else{
    toast(t("dm.only_plan"));
  }
}

/* ============================================================
   VENTANAS FLOTANTES DE CHAT PRIVADO (estilo Messenger) 💬
   - Clic en un usuario → ventana flotante (sin salir de la pestaña).
   - Hasta 3 ventanas abiertas; la 4ª minimiza la más antigua.
   - Cada ventana: minimizar (—), cerrar (✕), insignia de no leídos.
   - La pestaña "Privados" sigue como lista de conversaciones.
   ============================================================ */
const dmWindows = {};   // uid → { el, target, minimized }
let dmWinOrder = [];    // uids por orden de foco (el último = más reciente)
const DM_MAX_OPEN = 3;
let dmWinPollTimer = null;
let dmWinCountdownTimer = null;
let dmVoiceUid = null;  // uid de la ventana que está grabando voz

function dmWinBox(){
  let box = $("#dm-windows");
  if(!box){
    box = document.createElement("div");
    box.id = "dm-windows";
    document.body.appendChild(box);
  }
  return box;
}

/* Abre (o enfoca) la ventana flotante de chat con un usuario. */
async function openDmWindow(uid, target){
  uid = Number(uid);
  if(planType() === "free"){ toast(t("dm.only_plan")); return; }
  if(!target){
    try{
      const r = await fetch("/api/dm/conversations", { headers: authHeaders() });
      const j = await r.json();
      const c = (j.conversaciones || []).find(x => Number(x.uid) === uid);
      if(c) target = c;
    }catch(e){}
  }
  target = target || communityUsers[uid] || { nombre: t("dm.win_user"), foto: null, avatar: "💛" };
  const me = currentUser();
  if(me && Number(me.id) === uid){ toast(t("dm.is_you")); return; }

  let w = dmWindows[uid];
  if(w){
    // Ya existe: restaurar y traer al frente.
    w.target = target;
    restoreDmWindow(uid);
    focusDmWindow(uid);
    updateDmWinHead(uid);
    await loadDmWinMessages(uid);
    return;
  }
  // Límite de ventanas abiertas: minimizar la más antigua.
  const abiertas = dmWinOrder.filter(id => dmWindows[id] && !dmWindows[id].minimized);
  if(abiertas.length >= DM_MAX_OPEN){
    minimizeDmWindow(abiertas[0]);
  }
  // Crear la ventana.
  const annual = isAnnual();
  const el = document.createElement("div");
  el.className = "dm-win";
  el.dataset.dmUid = uid;
  el.innerHTML = `
    <div class="dm-win-head" onclick="toggleMinDmWindow(${uid})">
      <div class="comment-avatar">${dmAvatarHtml(target)}</div>
      <div class="dm-win-title"><b>${esc(target.nombre)}</b>${flagHtml(uid)}<br><small class="dm-win-countdown">⏳ 48h</small></div>
      <span class="dm-win-unread" style="display:none"></span>
      <button class="dm-win-headbtn" title="📸" aria-label="Álbumes"
        onclick="event.stopPropagation();viewUserAlbums(${uid})">📸</button>
      <button class="dm-win-headbtn" title="${annual ? "📹" : esc(t("dm.video_only_annual"))}" aria-label="Videollamada"
        onclick="event.stopPropagation();startVideoCallWin(${uid})">${annual ? "📹" : "📹🔒"}</button>
      <button class="dm-win-headbtn" title="${esc(t("dm.win_min"))}" aria-label="${esc(t("dm.win_min"))}"
        onclick="event.stopPropagation();minimizeDmWindow(${uid})">—</button>
      <button class="dm-win-headbtn" title="${esc(t("dm.win_close"))}" aria-label="${esc(t("dm.win_close"))}"
        onclick="event.stopPropagation();closeDmWindow(${uid})">✕</button>
    </div>
    <div class="dm-win-body">
      <div class="dm-win-msgs"><p style="text-align:center;color:var(--cocoa-soft)">…</p></div>
      <div class="dm-win-rec" style="display:none">🔴 <span class="dm-win-rec-time">0:00</span>
        <button class="btn btn-sm" onclick="detenerDmVoiceWin()">⏹</button></div>
      <div id="dm-emoji-${uid}" class="emoji-panel" data-target="#dm-input-${uid}" style="display:none"></div>
      <div class="dm-win-composer">
        <input type="file" class="dm-win-file" accept=".pdf,.doc,.docx,.txt" style="display:none"
          onchange="sendDmFileWin(${uid}, this)">
        <button class="dm-icon-btn" title="Emojis" aria-label="Emojis" data-emoji-toggle
          onclick="toggleEmojiGrid('dm-emoji-${uid}')">😊</button>
        <button class="dm-icon-btn" title="${esc(t("dm.voice_msg"))}" aria-label="Voz"
          onclick="toggleDmVoiceWin(${uid})">🎤</button>
        <button class="dm-icon-btn ${annual ? "" : "locked-feature"}" title="${annual ? "📎" : esc(t("dm.file_only_annual"))}"
          aria-label="Archivo" onclick="dmWinFileClick(${uid})">${annual ? "📎" : "📎🔒"}</button>
        <input id="dm-input-${uid}" class="field dm-win-input" maxlength="1000" placeholder="${esc(t("dm.win_ph"))}"
          onkeydown="if(event.key==='Enter')sendDmWin(${uid})">
        <button class="dm-win-send" onclick="sendDmWin(${uid})" aria-label="Enviar">➤</button>
      </div>
    </div>`;
  dmWinBox().appendChild(el);
  dmWindows[uid] = { el, target, minimized: false };
  dmWinOrder = dmWinOrder.filter(id => id !== uid);
  dmWinOrder.push(uid);
  await loadDmWinMessages(uid);
  updateDmBadge();
}

/* Botón 📎: solo anual puede adjuntar. */
function dmWinFileClick(uid){
  if(!isAnnual()){ openUpgradeModal(t("dm.file_only_annual")); return; }
  const w = dmWindows[uid];
  const inp = w && w.el.querySelector(".dm-win-file");
  if(inp) inp.click();
}

function focusDmWindow(uid){
  dmWinOrder = dmWinOrder.filter(id => id !== uid);
  dmWinOrder.push(uid);
  const w = dmWindows[uid];
  if(w){
    dmWinBox().appendChild(w.el); // la trae al frente
    const inp = w.el.querySelector(".dm-win-input");
    if(inp && !w.minimized) inp.focus();
  }
}

function toggleMinDmWindow(uid){
  const w = dmWindows[uid];
  if(!w) return;
  if(w.minimized) restoreDmWindow(uid); else minimizeDmWindow(uid);
}

function minimizeDmWindow(uid){
  const w = dmWindows[uid];
  if(!w || w.minimized) return;
  w.minimized = true;
  w.el.classList.add("minimized");
}

function restoreDmWindow(uid){
  const w = dmWindows[uid];
  if(!w || !w.minimized) return;
  // Al restaurar, respetar el máximo de ventanas abiertas.
  const abiertas = dmWinOrder.filter(id => dmWindows[id] && !dmWindows[id].minimized && id !== uid);
  if(abiertas.length >= DM_MAX_OPEN) minimizeDmWindow(abiertas[0]);
  w.minimized = false;
  w.el.classList.remove("minimized");
  const badge = w.el.querySelector(".dm-win-unread");
  if(badge) badge.style.display = "none";
  focusDmWindow(uid);
  loadDmWinMessages(uid);
}

function closeDmWindow(uid){
  const w = dmWindows[uid];
  if(w){
    if(dmVoiceUid === uid) detenerDmVoiceWin();
    w.el.remove();
    delete dmWindows[uid];
  }
  dmWinOrder = dmWinOrder.filter(id => id !== uid);
}

/* ============================================================
   VENTANA FLOTANTE DEL CHAT GRUPAL (estilo Facebook) 💬
   - El botón "💬 Comunidad" abre esta ventanita en vez de una vista completa.
   - Vive en #dm-windows (fuera del sistema de vistas): sigue abierta y visible
     al cambiar de pestaña (inicio, programa, diario, progreso, perfil…).
   - Límite total: 1 grupal + 3 privadas = 4 ventanas como máximo.
   - Botones: minimizar (—), cerrar (✕) y ⛶ (abre la vista completa con fotos/temas/RV).
   - El sondeo de mensajes sigue activo mientras la ventana esté abierta.
   ============================================================ */
let groupWin = null; // { el, minimized } — solo una ventana grupal a la vez

function groupWinOpen(){
  return !!(groupWin && groupWin.el && groupWin.el.isConnected);
}

/* Punto de entrada del botón "💬 Comunidad" en la barra de navegación. */
function openGroupChat(){
  openGroupChatWindow();
}

function openGroupChatWindow(){
  markGroupRead(); // al abrir el chat, los mensajes quedan leídos
  if(groupWinOpen()){
    if(groupWin.minimized) restoreGroupChatWindow();
    else focusGroupChatWindow();
    loadGroupWinMessages();
    return;
  }
  const el = document.createElement("div");
  el.className = "dm-win group-win";
  el.innerHTML = `
    <div class="dm-win-head" onclick="toggleMinGroupChatWindow()">
      <div class="comment-avatar">💬</div>
      <div class="dm-win-title"><b>${esc(t("chat.group_win"))}</b><br><small class="group-win-online">🟢 …</small></div>
      <span class="dm-win-unread group-win-unread" style="display:none"></span>
      <button class="dm-win-headbtn" title="⛶" aria-label="Vista completa"
        onclick="event.stopPropagation();expandGroupChatWindow()">⛶</button>
      <button class="dm-win-headbtn" title="${esc(t("dm.win_min"))}" aria-label="${esc(t("dm.win_min"))}"
        onclick="event.stopPropagation();minimizeGroupChatWindow()">—</button>
      <button class="dm-win-headbtn" title="${esc(t("dm.win_close"))}" aria-label="${esc(t("dm.win_close"))}"
        onclick="event.stopPropagation();closeGroupChatWindow()">✕</button>
    </div>
    <div class="dm-win-body">
      <div class="dm-win-msgs group-win-msgs"><p style="text-align:center;color:var(--cocoa-soft)">…</p></div>
      <div id="group-emoji-panel" class="emoji-panel" data-target=".group-win-input" style="display:none"></div>
      <div class="dm-win-composer">
        <button class="dm-icon-btn" title="Emojis" aria-label="Emojis" data-emoji-toggle
          onclick="toggleEmojiGrid('group-emoji-panel')">😊</button>
        <input class="field group-win-input" maxlength="500" placeholder="${esc(t("chat.ph"))}"
          onkeydown="if(event.key==='Enter')sendGroupWin()">
        <button class="dm-win-send" onclick="sendGroupWin()" aria-label="${esc(t("chat.send"))}">➤</button>
      </div>
    </div>`;
  dmWinBox().appendChild(el);
  groupWin = { el, minimized: false };
  startChatPoll(); // el sondeo sigue activo mientras la ventana esté abierta
  loadGroupWinMessages();
}

function focusGroupChatWindow(){
  if(!groupWinOpen()) return;
  dmWinBox().appendChild(groupWin.el); // la trae al frente
  const inp = groupWin.el.querySelector(".group-win-input");
  if(inp && !groupWin.minimized) inp.focus();
}

function toggleMinGroupChatWindow(){
  if(!groupWin) return;
  if(groupWin.minimized) restoreGroupChatWindow(); else minimizeGroupChatWindow();
}

function minimizeGroupChatWindow(){
  if(!groupWin || groupWin.minimized) return;
  groupWin.minimized = true;
  groupWin.el.classList.add("minimized");
}

function restoreGroupChatWindow(){
  if(!groupWin || !groupWin.minimized) return;
  groupWin.minimized = false;
  groupWin.el.classList.remove("minimized");
  markGroupRead(); // al restaurar la ventanita, queda leído
  focusGroupChatWindow();
  loadGroupWinMessages();
}

function closeGroupChatWindow(){
  if(groupWin && groupWin.el) groupWin.el.remove();
  groupWin = null;
  // El sondeo SIGUE activo (sesión iniciada): el contador de no leídos continúa.
}

/* ⛶: abre la vista completa (con fotos, temas y RV) y cierra la ventanita. */
function expandGroupChatWindow(){
  closeGroupChatWindow();
  switchTab("comunidad");
}

/* Pinta los mensajes del chat grupal dentro de la ventanita. */
let forceGroupBottom = false;
function paintGroupWinMessages(j){
  if(!groupWinOpen()) return;
  const box = groupWin.el.querySelector(".group-win-msgs");
  if(!box) return;
  const prevTop = box.scrollTop;
  const nearBottom = forceGroupBottom ||
    box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  forceGroupBottom = false;
  const items = ((j && j.comentarios) || []).slice().reverse(); // lo nuevo ABAJO
  communityUsers = {};
  box.innerHTML = items.map(c=>communityMsgHtml(c)).join("") ||
    `<p style="text-align:center;color:var(--cocoa-soft)">💛</p>`;
  box.scrollTop = nearBottom ? box.scrollHeight : prevTop;
  const onEl = groupWin.el.querySelector(".group-win-online");
  if(onEl && j && j.onlineCount != null){
    const n = Number(j.onlineCount) || 0;
    onEl.textContent = n > 0 ? `🟢 ${n} en línea` : `🔴 0 en línea`;
  }
  if(j && j.muted) disableCommunityComposer();
  refreshFlagLevels(Object.keys(communityUsers).map(Number)).catch(()=>{});
}

async function loadGroupWinMessages(){
  if(!groupWinOpen()) return;
  try{
    const r = await fetch("/api/community", { headers: authHeaders() });
    if(!r.ok) throw new Error("HTTP " + r.status);
    paintGroupWinMessages(await r.json());
  }catch(e){
    const box = groupWin.el.querySelector(".group-win-msgs");
    if(box) box.innerHTML = `<p style="text-align:center;color:#a33">⚠️</p>`;
  }
}

/* Enviar mensaje al chat grupal desde la ventanita. */
async function sendGroupWin(){
  if(!groupWinOpen()) return;
  const inp = groupWin.el.querySelector(".group-win-input");
  const text = inp ? inp.value.trim() : "";
  if(!text){ toast(t("t.write_something")); return; }
  try{
    const r = await fetch("/api/community", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ text })
    });
    const j = await r.json().catch(()=>({}));
    if(!r.ok){
      if(handleSpamError(j)) return;
      throw new Error(j.error || ("HTTP " + r.status));
    }
    if(j.id){ myMsgIds.add(j.id); seenMsgIds.add(j.id); }
    inp.value = "";
    playDing();
    forceGroupBottom = true;
    loadGroupWinMessages();
  }catch(e){
    toast(e.message);
  }
}

/* Actualiza el encabezado (nombre/foto) de una ventana. */
function updateDmWinHead(uid){
  const w = dmWindows[uid];
  if(!w) return;
  const t = w.target;
  const head = w.el.querySelector(".dm-win-head");
  if(!head) return;
  const av = head.querySelector(".comment-avatar");
  if(av) av.innerHTML = dmAvatarHtml(t);
  const b = head.querySelector(".dm-win-title b");
  if(b) b.textContent = t.nombre || t("dm.win_user");
  // Refrescar la banderita junto al nombre.
  const title = head.querySelector(".dm-win-title");
  if(title){
    const old = title.querySelector("[data-flag-uid]");
    const html = flagHtml(uid);
    if(old){ if(html) old.outerHTML = html; else old.remove(); }
    else if(html && b) b.insertAdjacentHTML("afterend", html);
  }
  refreshFlagLevels([uid]).catch(()=>{});
}

/* HTML de un mensaje (texto, voz, video-invite, archivo). */
function dmMessageHtml(m){
  const tipo = m.tipo || "text";
  let cuerpo = "";
  if(tipo === "voice" && m.audio){
    cuerpo = `<audio controls preload="metadata" src="${esc(m.audio)}" style="max-width:100%"></audio>`;
  }else if(tipo === "video-invite" && m.texto){
    cuerpo = `<p>📹 <b>${esc(t("dm.join_call").replace(" 📹", ""))}</b></p>
      <button class="btn btn-primary btn-sm" onclick="window.open('${esc(m.texto)}','_blank')">${esc(t("dm.join_call"))}</button>`;
  }else if(tipo === "file" && m.archivo){
    const kb = m.archivo.tamano ? (m.archivo.tamano/1024).toFixed(0) + " KB" : "";
    cuerpo = `<a class="dm-file-card" href="${esc(m.archivo.data)}" download="${esc(m.archivo.nombre)}">
      <span class="dm-file-icon">📎</span>
      <span><b>${esc(m.archivo.nombre)}</b><br><small>${kb}</small></span>
    </a>`;
  }else{
    cuerpo = `<p>${esc(m.texto)}</p>`;
  }
  return `
    <div class="dm-msg ${m.mio ? "dm-mine" : "dm-theirs"}"${m.expira ? ` data-expira="${esc(m.expira)}"` : ""} data-dm-id="${Number(m.id)}">
      ${cuerpo}
      <span class="dm-meta">${esc(m.fecha)} · ${esc(t("dm.expires_in"))} 48h</span>
      ${reactionHtmlDm(m.id, m.likes, m.dislikes, m.mi_reaccion)}
    </div>`;
}

/* Carga los mensajes de una ventana (conserva la posición del scroll). */
async function loadDmWinMessages(uid){
  const w = dmWindows[uid];
  if(!w) return;
  const box = w.el.querySelector(".dm-win-msgs");
  if(!box) return;
  const prevTop = box.scrollTop;
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80
    || box.dataset.forceBottom === "1";
  box.dataset.forceBottom = "";
  try{
    const r = await fetch("/api/dm/" + uid, { headers: authHeaders() });
    if(!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    const msgs = (j.mensajes || []).slice().reverse(); // lo nuevo ABAJO
    box.innerHTML = msgs.map(dmMessageHtml).join("")
      || `<p style="text-align:center;color:var(--cocoa-soft)">${esc(t("dm.empty"))}</p>`;
    box.scrollTop = nearBottom ? box.scrollHeight : prevTop;
    updateDmWinCountdowns();
  }catch(e){
    box.innerHTML = `<p style="text-align:center;color:#a33">⚠️</p>`;
  }
}

/* Enviar texto desde una ventana. */
async function sendDmWin(uid){
  const w = dmWindows[uid];
  if(!w) return;
  const inp = w.el.querySelector(".dm-win-input");
  const text = inp ? inp.value.trim() : "";
  if(!text) return;
  try{
    const r = await fetch("/api/dm", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ to_user_id: uid, text })
    });
    const j = await r.json().catch(() => ({}));
    if(!r.ok){
      if(j.error === "UPGRADE_ANNUAL"){ openUpgradeModal(j.message); return; }
      if(handleSpamError(j)) return;
      throw new Error(j.message || j.error || ("HTTP " + r.status));
    }
    inp.value = "";
    playDing();
    const w2 = dmWindows[uid];
    if(w2 && w2.el) w2.el.querySelector(".dm-win-msgs").dataset.forceBottom = "1";
    await loadDmWinMessages(uid);
    updateDmBadge();
  }catch(e){
    toast(e.message);
  }
}

/* Videollamada (solo plan anual) desde una ventana. */
async function startVideoCallWin(uid){
  if(!isAnnual()){ openUpgradeModal(t("dm.video_only_annual")); return; }
  try{
    const r = await fetch("/api/dm/" + uid + "/video-call", {
      method: "POST", headers: authHeaders()
    });
    const j = await r.json().catch(() => ({}));
    if(!r.ok){
      if(j.error === "UPGRADE_ANNUAL"){ openUpgradeModal(j.message); return; }
      throw new Error(j.message || j.error || ("HTTP " + r.status));
    }
    window.open(j.roomUrl, "_blank");
    await loadDmWinMessages(uid);
  }catch(e){
    toast(e.message);
  }
}

/* ---------- mensajes de voz (plan anual y mensual), por ventana ---------- */
let dmRecorder = null, dmAudioChunks = [], dmRecTimer = null, dmRecSecs = 0;

async function toggleDmVoiceWin(uid){
  if(dmRecorder && dmRecorder.state === "recording"){
    if(dmVoiceUid === uid){ detenerDmVoiceWin(); return; }
    detenerDmVoiceWin(); // detiene la grabación de otra ventana antes de empezar
  }
  dmVoiceUid = uid;
  try{
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    dmRecorder = new MediaRecorder(stream);
    dmAudioChunks = [];
    dmRecorder.ondataavailable = e => { if(e.data && e.data.size) dmAudioChunks.push(e.data); };
    dmRecorder.onstop = enviarDmVoiceWin;
    dmRecorder.start();
    dmRecSecs = 0;
    const w = dmWindows[uid];
    const ind = w && w.el.querySelector(".dm-win-rec");
    const tm = w && w.el.querySelector(".dm-win-rec-time");
    if(ind) ind.style.display = "";
    dmRecTimer = setInterval(() => {
      dmRecSecs++;
      if(tm) tm.textContent = Math.floor(dmRecSecs/60) + ":" + String(dmRecSecs%60).padStart(2, "0");
      if(dmRecSecs >= 120) detenerDmVoiceWin(); /* máx 2 minutos */
    }, 1000);
  }catch(e){
    dmVoiceUid = null;
    toast(t("dm.mic_error"));
  }
}

function detenerDmVoiceWin(){
  if(dmRecTimer){ clearInterval(dmRecTimer); dmRecTimer = null; }
  const w = dmVoiceUid != null ? dmWindows[dmVoiceUid] : null;
  const ind = w && w.el.querySelector(".dm-win-rec");
  if(ind) ind.style.display = "none";
  if(dmRecorder && dmRecorder.state === "recording"){
    dmRecorder.stop();
  }else{
    dmRecorder = null;
    dmVoiceUid = null;
  }
  try{ dmRecorder && dmRecorder.stream && dmRecorder.stream.getTracks().forEach(tr => tr.stop()); }catch(e){}
}

async function enviarDmVoiceWin(){
  const rec = dmRecorder; dmRecorder = null;
  const uid = dmVoiceUid; dmVoiceUid = null;
  try{ rec && rec.stream && rec.stream.getTracks().forEach(tr => tr.stop()); }catch(e){}
  if(!dmAudioChunks.length || uid == null){ dmAudioChunks = []; return; }
  const blob = new Blob(dmAudioChunks, { type: (rec && rec.mimeType) || "audio/webm" });
  dmAudioChunks = [];
  const reader = new FileReader();
  reader.onload = async () => {
    try{
      const r = await fetch("/api/dm/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ to_user_id: uid, audio: reader.result })
      });
      const j = await r.json().catch(() => ({}));
      if(!r.ok){
        if(j.error === "UPGRADE_ANNUAL"){ openUpgradeModal(j.message); return; }
        throw new Error(j.message || j.error || ("HTTP " + r.status));
      }
      playDing();
      await loadDmWinMessages(uid);
      updateDmBadge();
    }catch(e){
      toast(e.message);
    }
  };
  reader.readAsDataURL(blob);
}

/* ---------- archivos adjuntos (solo plan anual), por ventana ---------- */
async function sendDmFileWin(uid, input){
  const f = input && input.files && input.files[0];
  if(input) input.value = "";
  if(!f) return;
  if(!isAnnual()){ openUpgradeModal(t("dm.file_only_annual")); return; }
  const permitidos = ["application/pdf", "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain"];
  if(!permitidos.includes(f.type)){
    toast(t("dm.file_types"));
    return;
  }
  if(f.size > 10 * 1024 * 1024){
    toast(t("dm.file_big"));
    return;
  }
  const reader = new FileReader();
  reader.onload = async () => {
    try{
      const r = await fetch("/api/dm/file", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ to_user_id: uid, file: reader.result, fileName: f.name })
      });
      const j = await r.json().catch(() => ({}));
      if(!r.ok){
        if(j.error === "UPGRADE_ANNUAL"){ openUpgradeModal(j.message); return; }
        throw new Error(j.message || j.error || ("HTTP " + r.status));
      }
      playDing();
      await loadDmWinMessages(uid);
    }catch(e){
      toast(e.message);
    }
  };
  reader.readAsDataURL(f);
}

/* ---------- cronómetro 48h: un solo intervalo para todas las ventanas ---------- */
function updateDmWinCountdowns(){
  Object.keys(dmWindows).forEach(uid => {
    const w = dmWindows[uid];
    const el = w && w.el.querySelector(".dm-win-countdown");
    if(!el) return;
    const msgs = w.el.querySelectorAll(".dm-win-msgs [data-expira]");
    if(!msgs.length){ el.textContent = "⏳ 48h"; return; }
    let proxima = Infinity;
    msgs.forEach(m => {
      const t = new Date(m.getAttribute("data-expira").replace(" ", "T") + "Z").getTime();
      if(!isNaN(t) && t < proxima) proxima = t;
    });
    if(proxima === Infinity){ el.textContent = "⏳ 48h"; return; }
    const restante = proxima - Date.now();
    if(restante <= 0){ el.textContent = "⏳…"; return; }
    const h = Math.floor(restante / 3600000);
    const m = Math.floor((restante % 3600000) / 60000);
    el.textContent = h >= 24 ? `⏳ ${Math.floor(h/24)}d ${h%24}h` : `⏳ ${h}h ${m}m`;
  });
}

/* ---------- sondeo de ventanas: mensajes nuevos + insignias ---------- */
async function refreshDmWindows(){
  const ids = Object.keys(dmWindows).map(Number);
  if(!ids.length) return;
  try{
    const r = await fetch("/api/dm/conversations", { headers: authHeaders() });
    if(!r.ok) return;
    const j = await r.json();
    const porUid = {};
    (j.conversaciones || []).forEach(c => { porUid[Number(c.uid)] = c; });
    for(const uid of ids){
      const w = dmWindows[uid];
      if(!w) continue;
      const c = porUid[uid];
      const badge = w.el.querySelector(".dm-win-unread");
      const n = c && c.noLeidos ? Number(c.noLeidos) : 0;
      if(badge){
        badge.style.display = n ? "" : "none";
        badge.textContent = n > 99 ? "99+" : n;
      }
      if(!w.minimized){
        await loadDmWinMessages(uid); // el GET marca como leídos
      }
      if(c){
        w.target = { ...w.target, nombre: c.nombre || w.target.nombre, foto: c.foto, avatar: c.avatar };
        updateDmWinHead(uid);
      }
    }
    updateDmWinCountdowns();
  }catch(e){ /* sin conexión: no hacer nada */ }
  updateDmBadge();
}

function startDmWinPoll(){
  stopDmWinPoll();
  refreshDmWindows();
  dmWinPollTimer = setInterval(refreshDmWindows, 10000);
  if(!dmWinCountdownTimer) dmWinCountdownTimer = setInterval(updateDmWinCountdowns, 60000);
}
function stopDmWinPoll(){
  if(dmWinPollTimer){ clearInterval(dmWinPollTimer); dmWinPollTimer = null; }
}

/* ---------- compatibilidad: la pestaña "Privados" ---------- */
/* La pestaña "Privados" muestra la lista de conversaciones; al tocar
 * una se abre la ventana flotante. Se conserva openDmChat como alias. */
function openDmChat(uid, target){
  openDmWindow(uid, target);
}


function stopDmPoll(){
  if(dmPollTimer){ clearInterval(dmPollTimer); dmPollTimer = null; }
}

/* ---------- modal de actualización mensual → anual ----------
 * mensaje (opcional): título personalizado, ej. el aviso de límite
 * diario de DMs ("Actualiza tu plan para conversar con más personas 💎"). */
async function openUpgradeModal(mensaje){
  const modal = $("#upgrade-modal");
  const body = $("#upgrade-body");
  if(!modal || !body) return;
  body.innerHTML = `<p style="text-align:center">Cargando…</p>`;
  modal.classList.add("open");
  try{
    const r = await fetch("/api/billing/upgrade-quote", { headers: authHeaders() });
    const j = await r.json();
    if(j.plan === "annual"){
      body.innerHTML = `<p style="text-align:center"><b>Ya tienes el plan anual 🎉</b></p>`;
      return;
    }
    body.innerHTML = `
      <div style="text-align:center;font-size:2.5rem">💎</div>
      <h3 style="text-align:center">${esc(mensaje || "Actualiza a un plan anual para enviar mensajes privados 💎")}</h3>
      <p style="text-align:center">${esc(j.mensaje || "")}</p>
      <div class="upgrade-quote">
        <div><span>Plan anual</span><b>$${esc(j.precioAnual || "39.99")}</b></div>
        ${j.pagadoEsteMes ? `<div><span>Ya pagado este mes</span><b>−$${esc(j.pagadoEsteMes)}</b></div>` : ""}
        <div class="upgrade-total"><span>Total a pagar hoy</span><b>$${esc(j.quote || j.precioAnual || "39.99")} ${esc(j.moneda || "USD")}</b></div>
      </div>
      <button class="btn btn-primary btn-block" onclick="upgradeToAnnual()">Actualizar mi plan →</button>
      <p style="font-size:.78rem;color:var(--cocoa-soft);text-align:center;margin-top:8px">
        Serás redirigido a PayPal para confirmar. Después puedes cancelar tu plan mensual.</p>`;
  }catch(e){
    body.innerHTML = `<p style="text-align:center;color:#a33">No se pudo cargar la cotización. Intenta de nuevo.</p>`;
  }
}
function closeUpgradeModal(){
  const modal = $("#upgrade-modal");
  if(modal) modal.classList.remove("open");
}

async function upgradeToAnnual(){
  const u = currentUser();
  if(!u || !u.email){ toast("Primero crea tu cuenta gratis 💛"); return; }
  toast("Conectando con PayPal…");
  try{
    const r = await fetch("/api/paypal/create-subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ plan: "yearly", email: u.email })
    });
    const j = await r.json();
    if(!r.ok) throw new Error(j.error || ("HTTP " + r.status));
    if(j.approveUrl){ window.location.href = j.approveUrl; return; }
    toast("No se pudo iniciar el pago.");
  }catch(e){
    toast(e.message);
  }
}

/* ---------- paywall / PayPal ---------- */
function openPaywall(){
  $("#paywall-modal").classList.add("open");
}
function closePaywall(){ $("#paywall-modal").classList.remove("open"); }

async function startCheckout(plan){
  closePaywall();
  const u = currentUser();
  if(!u || !u.email){
    toast("Primero crea tu cuenta gratis 💛");
    showView("auth");
    return;
  }
  toast("Conectando con PayPal…");
  try{
    const r = await fetch("/api/paypal/create-subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan, email: u.email })
    });
    const j = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(j.error || ("HTTP " + r.status));
    if(!j.approveUrl) throw new Error("sin enlace de aprobación");
    window.location.href = j.approveUrl; // el comprador aprueba en PayPal
  }catch(e){
    console.error("[Reaviva] checkout:", e.message);
    toast(e.message === "Pagos no configurados todavía"
      ? "Pagos próximamente — te avisaremos 💛"
      : "No se pudo iniciar el pago. Inténtalo de nuevo.");
  }
}

/* Handle the return from PayPal (?paypal=ok | ?paypal=cancel). */
async function handlePayPalReturn(){
  const qs = new URLSearchParams(location.search);
  const ret = qs.get("paypal");
  if(ret !== "ok" && ret !== "cancel") return;
  // limpia la URL para no reprocesar al recargar
  history.replaceState(null, "", location.pathname + "#app");
  if(ret === "cancel"){
    toast(t("t.payment_cancel"));
    return;
  }
  toast(t("t.payment_ok"));
  await refreshPaidStatus();
  if(isPaid()){
    toast(t("t.member_active"));
  } else {
    // el webhook puede tardar unos segundos: reintenta un par de veces
    setTimeout(async ()=>{ await refreshPaidStatus(); if(isPaid()) toast(t("t.member_active")); }, 4000);
  }
  if(currentUser()) enterApp(); else showView("auth");
}

/* ---------- init ---------- */

/* ============ TOUR DE BIENVENIDA (se muestra una vez) ============ */
const TOUR_STEPS = [
  { emoji: "🎉", key: "1" },
  { emoji: "📅", key: "2" },
  { emoji: "💬", key: "3" },
  { emoji: "💰", key: "4" },
  { emoji: "⭐", key: "5" },
];
let tourStep = 0;

function maybeShowTour(){
  try{
    if(localStorage.getItem("reaviva_tour_done")) return;
  }catch(e){ return; }
  // El tour SOLO se muestra en la página de registro (#registro / #entrar).
  // Nunca en el landing (precios, preguntas frecuentes) ni dentro de la app.
  const authView = document.getElementById("view-auth");
  if(!authView || authView.style.display === "none") return;
  tourStep = 0;
  renderTourStep();
  const m = document.getElementById("tour-modal");
  if(m) m.style.display = "flex";
}

function renderTourStep(){
  const s = TOUR_STEPS[tourStep];
  const c = document.getElementById("tour-content");
  if(c) c.innerHTML = `<div class="tour-emoji">${s.emoji}</div><h3>${t("tour."+s.key+"t")}</h3><p>${t("tour."+s.key+"d")}</p>`;
  const dots = document.getElementById("tour-dots");
  if(dots) dots.innerHTML = TOUR_STEPS.map((_, i) =>
    `<span class="tour-dot${i === tourStep ? " active" : ""}"></span>`).join("");
  const next = document.getElementById("tour-next");
  if(next) next.textContent = tourStep === TOUR_STEPS.length - 1 ? t("tour.done") : t("tour.next");
  const skip = document.getElementById("tour-skip");
  if(skip) skip.textContent = t("tour.skip");
}

function nextTourStep(){
  if(tourStep < TOUR_STEPS.length - 1){
    tourStep++;
    renderTourStep();
  }else{
    finishTour();
  }
}

function skipTour(){ finishTour(); }

function finishTour(){
  try{ localStorage.setItem("reaviva_tour_done", "1"); }catch(e){}
  const m = document.getElementById("tour-modal");
  if(m) m.style.display = "none";
}

document.addEventListener("DOMContentLoaded", ()=>{
  // Aplicar idioma guardado (o detectado) a toda la UI estática.
  try{ applyI18n(); }catch(e){}
  // landing CTAs
  $$("[data-go-app]").forEach(b=>b.addEventListener("click", async (e)=>{
    // Evitar la navegación nativa del <a href="#"> (creaba una entrada
    // fantasma "/#" en el historial que rompía el botón "atrás").
    if(e && e.preventDefault) e.preventDefault();
    afterRestore(await restoreSession());
  }));
  $("#logout-btn").addEventListener("click", ()=>{ doLogout(); });
  // PayPal return (?paypal=ok|cancel) + sync paid status with backend
  handlePayPalReturn();
  // Retorno de compra de RV (?rv=ok&token=ORDERID)
  handleRVReturn().catch(()=>{});
  refreshPaidStatus();
  // reCAPTCHA v2 en el formulario de registro (si hay site key configurada)
  initRecaptcha();
  // Lista de países en el registro.
  initCountrySelect();
  // Inactividad: 30 min sin actividad -> aviso 10 seg -> cierra sesion.
  initInactivityTimer();
  // Si el navegador se cerró, la sesión no debe seguir abierta: la marca
  // "reaviva_alive" vive en sessionStorage y desaparece al cerrar el
  // navegador. Si hay token pero no hay marca, cerrar la sesión guardada.
  try{
    if(store.get("reaviva_token", null) && !sessionStorage.getItem("reaviva_alive")){
      localStorage.removeItem(LS.user);
      localStorage.removeItem("reaviva_token");
      localStorage.removeItem("reaviva_admin");
      localStorage.removeItem("reaviva_paid");
    }
  }catch(e){}
  // URL secreta de admin: /admin/ingzoe
  if(location.pathname === "/admin/ingzoe"){
    restoreSession().then(ok => { if(ok && isAdmin()) enterApp(); else showView("admin-login"); });
    return;
  }
  // deep-link con nombre: #registro, #entrar, #comunidad, etc.
  if(applyHashRoute()){
    // Al terminar de restaurar la sesión: si hay sesión válida pero la vista
    // quedó en el landing o en auth (ej. al recargar), entrar a la app en la
    // pestaña del hash (o en Hoy) — sin sacar al usuario de donde estaba.
    restoreSession().then(ok => {
      if(ok && currentUser()){
        const lv = $("#view-landing"), av = $("#view-auth");
        const onLanding = lv && lv.style.display !== "none";
        const onAuth = av && av.style.display !== "none";
        if(onLanding || onAuth){
          const h = (location.hash || "").replace(/^#/, "").toLowerCase();
          const tabByHash = Object.keys(TAB_HASHES).find(t => TAB_HASHES[t] === h);
          enterApp(tabByHash || undefined);
        }
      }
    });
  }
  // deep-link legado: #app — valida la sesión contra el backend
  else if(location.hash === "#app"){
    restoreSession().then(afterRestore);
  }
  // Botones atrás/adelante del navegador.
  window.addEventListener("hashchange", ()=>{
    if(suppressHashUpdate) return;
    suppressHashUpdate = true;
    try{ applyHashRoute(); }finally{ setTimeout(()=>{ suppressHashUpdate = false; }, 0); }
  });
  // Referido: si llegó con ?ref= (ID o nombre), guardarlo para el registro.
  try{
    const refParam = new URLSearchParams(location.search).get("ref");
    if(refParam && refParam.trim()) localStorage.setItem("reaviva_ref", refParam.trim().slice(0, 60));
  }catch(e){}
  // Tour de bienvenida: se muestra una vez al primer ingreso.
  setTimeout(maybeShowTour, 1500);
});

/* Cierra la sesion y vuelve a la landing. */
function doLogout(){
  try{ stopDmPoll(); }catch(e){}
  try{ stopChatPoll(); }catch(e){}
  try{ hideInactivityWarning(); }catch(e){}
  if(typeof inactivityTimer !== "undefined" && inactivityTimer) clearTimeout(inactivityTimer);
  // Borrar los textos escritos (historia y ejercicios) al cerrar sesión.
  try{
    localStorage.removeItem("reaviva_stories");
    localStorage.removeItem("reaviva_exercises");
  }catch(e){}
  localStorage.removeItem(LS.user);
  localStorage.removeItem("reaviva_token");
  localStorage.removeItem("reaviva_admin");
  localStorage.removeItem("reaviva_paid");
  showView("landing");
}

/* Borra el borrador del día actual (historia + ejercicio) al salir de la vista. */
function clearDayDraft(d){
  try{
    const s = JSON.parse(localStorage.getItem("reaviva_stories") || "{}");
    delete s[d];
    localStorage.setItem("reaviva_stories", JSON.stringify(s));
    const e = JSON.parse(localStorage.getItem("reaviva_exercises") || "{}");
    delete e[d];
    localStorage.setItem("reaviva_exercises", JSON.stringify(e));
  }catch(err){}
}

/* ---------- Inactividad: 30 min sin actividad -> aviso de 10 seg -> cierra sesion ----------
 * Cualquier movimiento del mouse, tecla, toque o scroll reinicia el conteo
 * y cancela el aviso si esta visible. */
const INACTIVITY_LIMIT = 30 * 60 * 1000; // 30 minutos
const INACTIVITY_WARNING = 10; // segundos de aviso
let inactivityTimer = null, warningTimer = null, warningLeft = INACTIVITY_WARNING;
function initInactivityTimer(){
  const reset = ()=>resetInactivity();
  ["mousemove","mousedown","keydown","touchstart","scroll","click"].forEach(ev=>{
    document.addEventListener(ev, reset, {passive:true});
  });
  resetInactivity();
}
function resetInactivity(){
  if(warningTimer){ hideInactivityWarning(); }
  if(inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(showInactivityWarning, INACTIVITY_LIMIT);
}
function showInactivityWarning(){
  try{ if(!localStorage.getItem("reaviva_token")) return; }catch(e){ return; }
  warningLeft = INACTIVITY_WARNING;
  let modal = document.getElementById("inactivity-modal");
  if(!modal){
    modal = document.createElement("div");
    modal.id = "inactivity-modal";
    modal.innerHTML =
      '<div class="inactivity-box">' +
      '<div style="font-size:2.5rem">⏱️</div>' +
      "<h3>¿Sigues ahí?</h3>" +
      '<p>Tu sesión se cerrará en <b id="inactivity-count" style="font-size:1.4rem;color:#c0392b">' + warningLeft + "</b> segundos por inactividad.</p>" +
      '<p style="font-size:.85rem;color:var(--cocoa-soft)">Mueve el mouse o presiona cualquier tecla para seguir.</p>' +
      '<button class="btn btn-primary" onclick="resetInactivity()">Seguir aquí 💛</button>' +
      "</div>";
    document.body.appendChild(modal);
  }else{
    modal.style.display = "";
    const c = document.getElementById("inactivity-count");
    if(c) c.textContent = warningLeft;
  }
  warningTimer = setInterval(()=>{
    warningLeft--;
    const c = document.getElementById("inactivity-count");
    if(c) c.textContent = warningLeft;
    if(warningLeft <= 0){
      hideInactivityWarning();
      doLogout();
      toast("Sesión cerrada por inactividad ⏱️");
    }
  }, 1000);
}
function hideInactivityWarning(){
  if(warningTimer){ clearInterval(warningTimer); warningTimer = null; }
  const modal = document.getElementById("inactivity-modal");
  if(modal) modal.style.display = "none";
}

/* ============================================================
   COMPARTIR REAVIVA
   ============================================================ */

function myShareLink(){
  const u = currentUser();
  const base = "https://www.reavivaapp.com/";
  // Link personal con ref para rastrear referidos (solo si hay sesión).
  return (u && u.id) ? base + "?ref=" + encodeURIComponent(u.id) : base;
}

function openShareModal(){
  const link = myShareLink();
  const txt = t("share.msg") + " " + link;
  const el = $("#share-text");
  if(el) el.textContent = txt;
  const m = $("#share-modal");
  if(m) m.classList.add("open");
}

function closeShareModal(){
  const m = $("#share-modal");
  if(m) m.classList.remove("open");
}

function shareVia(canal){
  const link = myShareLink();
  const shareMsg = t("share.msg");
  const txt = shareMsg + " " + link;
  const msg = $("#share-copy-msg");
  const done = (tx) => { if(msg) msg.textContent = tx; };
  if(canal === "whatsapp"){
    window.open("https://wa.me/?text=" + encodeURIComponent(txt), "_blank");
  }else if(canal === "facebook"){
    window.open("https://www.facebook.com/sharer/sharer.php?u=" + encodeURIComponent(link) + "&quote=" + encodeURIComponent(shareMsg), "_blank");
  }else if(canal === "telegram"){
    window.open("https://t.me/share/url?url=" + encodeURIComponent(link) + "&text=" + encodeURIComponent(shareMsg), "_blank");
  }else if(canal === "x"){
    window.open("https://twitter.com/intent/tweet?text=" + encodeURIComponent(txt), "_blank");
  }else if(canal === "copy"){
    const copiar = async () => {
      try{
        await navigator.clipboard.writeText(txt);
        done(t("m.share_copied"));
      }catch(e){
        // Fallback para navegadores sin clipboard API.
        const ta = document.createElement("textarea");
        ta.value = txt;
        document.body.appendChild(ta);
        ta.select();
        try{ document.execCommand("copy"); done("✅ ¡Link copiado! Pégalo donde quieras 💛"); }
        catch(_){ done("Copia el link manualmente: " + link); }
        document.body.removeChild(ta);
      }
    };
    copiar();
  }
}

/* ============================================================
   ÁLBUMES DE FOTOS EN EL PERFIL 📸 (estilo Facebook)
   - Máx 6 álbumes por usuario, máx 50 fotos por álbum.
   - El dueño puede crear/eliminar álbumes y agregar/eliminar fotos.
   - Los álbumes de otros usuarios se ven en modo solo lectura.
   ============================================================ */
const ALB_MAX_ALBUMS = 6, ALB_MAX_PHOTOS = 50;

/* Modal dinámico reutilizable (usa .modal-bg de styles.css). */
function openDynModal(html){
  closeDynModal();
  const bg = document.createElement("div");
  bg.className = "modal-bg open";
  bg.id = "dyn-modal";
  bg.innerHTML = `<div class="modal" style="max-width:560px;width:100%;max-height:88vh;overflow-y:auto">
    <button class="modal-x" onclick="closeDynModal()" aria-label="Cerrar">✕</button>
    ${html}</div>`;
  bg.addEventListener("click", (e) => { if(e.target === bg) closeDynModal(); });
  document.body.appendChild(bg);
  return bg;
}
function closeDynModal(){
  const bg = document.getElementById("dyn-modal");
  if(bg) bg.remove();
}

/* ---------- Mis álbumes (perfil propio) ---------- */
async function renderPerfilAlbums(){
  const box = document.getElementById("perfil-albums");
  if(!box) return;
  try{
    const r = await fetch("/api/albums", { headers: authHeaders() });
    const j = await r.json();
    if(!r.ok) throw new Error(j.error || ("HTTP " + r.status));
    const albums = j.albums || [];
    if(!albums.length){
      box.innerHTML = `<p style="text-align:center;color:var(--cocoa-soft);font-size:.9rem">${esc(t("alb.empty"))}</p>`;
      return;
    }
    box.innerHTML = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">` +
      albums.map(albumCardHtml).join("") + `</div>`;
  }catch(e){
    box.innerHTML = `<p style="text-align:center;color:#a33;font-size:.9rem">${esc(e.message)}</p>`;
  }
}

function albumCardHtml(a){
  const cover = a.portada
    ? `<img src="${a.portada}" alt="" style="width:100%;height:100%;object-fit:cover">`
    : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:2rem;background:var(--bg-soft)">📸</div>`;
  return `<div onclick="openAlbumDetail(${a.id}, false)" style="cursor:pointer">
    <div style="aspect-ratio:1;border-radius:12px;overflow:hidden;border:1px solid var(--hatch-widget-border)">${cover}</div>
    <div style="font-size:.82rem;font-weight:600;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.title)}</div>
    <div style="font-size:.75rem;color:var(--cocoa-soft)">${a.fotos} ${esc(t("alb.photos"))}</div>
  </div>`;
}

function openCreateAlbumModal(){
  openDynModal(`
    <h3 style="margin-top:0">${esc(t("alb.create"))}</h3>
    <input id="alb-new-title" class="field" maxlength="80" placeholder="${esc(t("alb.new_ph"))}" style="margin-bottom:10px">
    <div id="alb-new-err" style="color:#a33;font-size:.85rem;min-height:1.2em"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn btn-ghost" onclick="closeDynModal()">${esc(t("alb.cancel"))}</button>
      <button class="btn btn-primary" onclick="doCreateAlbum()">${esc(t("alb.save"))}</button>
    </div>`);
  const inp = document.getElementById("alb-new-title");
  if(inp){ inp.focus(); inp.onkeydown = (e) => { if(e.key === "Enter") doCreateAlbum(); }; }
}

async function doCreateAlbum(){
  const inp = document.getElementById("alb-new-title");
  const err = document.getElementById("alb-new-err");
  const title = (inp && inp.value || "").trim();
  if(!title){ err.textContent = t("alb.new_title"); return; }
  err.textContent = "…";
  try{
    const r = await fetch("/api/albums", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ title })
    });
    const j = await r.json();
    if(!r.ok) throw new Error(j.error || ("HTTP " + r.status));
    closeDynModal();
    toast(t("alb.created"));
    renderPerfilAlbums();
  }catch(e){ err.textContent = e.message; }
}

/* ---------- Detalle del álbum (fotos) ---------- */
async function openAlbumDetail(albumId, readonly){
  openDynModal(`<div id="alb-detail"><p style="text-align:center;color:var(--cocoa-soft)">…</p></div>`);
  try{
    const r = await fetch(`/api/albums/${albumId}/photos`, { headers: authHeaders() });
    const j = await r.json();
    if(!r.ok) throw new Error(j.error || ("HTTP " + r.status));
    renderAlbumDetail(j.album, j.dueno && !readonly, j.fotos || []);
  }catch(e){
    const d = document.getElementById("alb-detail");
    if(d) d.innerHTML = `<p style="text-align:center;color:#a33">${esc(e.message)}</p>`;
  }
}

function renderAlbumDetail(album, isOwner, fotos){
  const d = document.getElementById("alb-detail");
  if(!d) return;
  const grid = fotos.length
    ? `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">` +
      fotos.map(f => `
        <div onclick="openPhotoLightbox(${album.id}, ${f.id}, ${isOwner ? 1 : 0})" style="cursor:pointer">
          <div style="aspect-ratio:1;border-radius:10px;overflow:hidden;border:1px solid var(--hatch-widget-border)">
            <img src="${f.photo}" alt="" style="width:100%;height:100%;object-fit:cover">
          </div>
        </div>`).join("") + `</div>`
    : `<p style="text-align:center;color:var(--cocoa-soft)">${esc(t("alb.empty"))}</p>`;
  d.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <h3 style="margin:0">${esc(album.title)} <small style="color:var(--cocoa-soft)">(${fotos.length}/${ALB_MAX_PHOTOS})</small></h3>
      ${isOwner ? `<button class="btn btn-ghost btn-sm" style="color:#a33" onclick="deleteAlbum(${album.id})">🗑 ${esc(t("alb.delete_album"))}</button>` : ""}
    </div>
    ${grid}
    ${isOwner ? `<div style="margin-top:12px;text-align:center">
      <button class="btn btn-primary btn-sm" onclick="pickAlbumPhotos(${album.id})">${esc(t("alb.add_photos"))}</button>
      <input type="file" id="alb-file-input" accept="image/jpeg,image/png" multiple style="display:none">
    </div>` : ""}`;
  // Guardar fotos en memoria para el lightbox.
  window._albFotos = {};
  fotos.forEach(f => { window._albFotos[f.id] = f; });
  window._albCtx = { albumId: album.id, isOwner };
}

function pickAlbumPhotos(albumId){
  let inp = document.getElementById("alb-file-input");
  if(!inp){
    inp = document.createElement("input");
    inp.type = "file"; inp.id = "alb-file-input";
    inp.accept = "image/jpeg,image/png"; inp.multiple = true;
    inp.style.display = "none";
    document.body.appendChild(inp);
  }
  inp.onchange = () => previewAlbumPhotos(inp, albumId);
  inp.click();
}

/* Paso 1: vista previa de las fotos seleccionadas + botón Subir. */
function previewAlbumPhotos(input, albumId){
  const files = Array.from(input.files || []);
  input.value = "";
  if(!files.length) return;
  const valid = files.filter(f => f.type === "image/jpeg" || f.type === "image/png");
  if(valid.length < files.length) toast("Solo se permiten fotos JPG o PNG 📷");
  if(!valid.length) return;
  // Guardar para el paso 2.
  window._albPending = { albumId, files: valid };
  const previews = valid.map((f, i) => {
    const url = URL.createObjectURL(f);
    return `<div style="position:relative">
      <div style="aspect-ratio:1;border-radius:10px;overflow:hidden;border:1px solid var(--hatch-widget-border)">
        <img src="${url}" style="width:100%;height:100%;object-fit:cover">
      </div>
      <button onclick="removePendingPhoto(${i})" style="position:absolute;top:4px;right:4px;background:rgba(0,0,0,.6);color:#fff;border:none;border-radius:50%;width:26px;height:26px;cursor:pointer;font-size:.85rem">✕</button>
    </div>`;
  }).join("");
  openDynModal(`
    <div style="text-align:center">
      <h3 style="margin:0 0 10px">📷 Fotos seleccionadas (${valid.length})</h3>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px">${previews}</div>
      <div style="display:flex;gap:10px;justify-content:center">
        <button class="btn btn-ghost" onclick="cancelPendingPhotos(${albumId})">Cancelar</button>
        <button class="btn btn-primary" id="alb-upload-btn" onclick="uploadPendingPhotos()">⬆️ Subir</button>
      </div>
    </div>`);
}

/* Quitar una foto de la vista previa. */
function removePendingPhoto(i){
  const p = window._albPending;
  if(!p) return;
  p.files.splice(i, 1);
  if(!p.files.length){ cancelPendingPhotos(p.albumId); return; }
  previewAlbumPhotos({ files: p.files, value: "" }, p.albumId);
}

/* Cancelar la selección. */
function cancelPendingPhotos(albumId){
  window._albPending = null;
  openAlbumDetail(albumId, false);
}

/* Paso 2: subir las fotos confirmadas. */
async function uploadPendingPhotos(){
  const p = window._albPending;
  if(!p || !p.files.length) return;
  const btn = document.getElementById("alb-upload-btn");
  if(btn){ btn.disabled = true; btn.textContent = "⏳ Subiendo…"; }
  const { albumId, files } = p;
  let ok = 0, failMsg = "";
  for(const file of files){
    try{
      const dataUrl = await resizeImageDataUrl(file);
      const r = await fetch(`/api/albums/${albumId}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ photo: dataUrl })
      });
      const j = await r.json();
      if(!r.ok) throw new Error(j.error || ("HTTP " + r.status));
      ok++;
    }catch(e){
      failMsg = e.message;
      break;
    }
  }
  window._albPending = null;
  if(ok) toast("✅ " + ok + " foto" + (ok > 1 ? "s" : "") + " en el álbum");
  else if(failMsg) toast("❌ " + failMsg);
  openAlbumDetail(albumId, false); // mostrar las fotos en el álbum
  // Refrescar la lista de álbumes (conteo de fotos).
  try{ if(typeof loadAlbums === "function") loadAlbums(); }catch(e){}
}

/* Redimensiona a máx 1280px (lado mayor), JPEG calidad 0.8.
 * Intenta con objectURL y si falla, con FileReader como respaldo. */
function resizeImageDataUrl(file){
  return new Promise((resolve, reject) => {
    if(!file.type.startsWith("image/")) return reject(new Error("No es una imagen válida"));
    // Respaldo: leer con FileReader si el objectURL falla.
    const viaReader = () => {
      const fr = new FileReader();
      fr.onload = () => {
        const img = new Image();
        img.onload = () => finish(img);
        img.onerror = () => reject(new Error("No se pudo leer la imagen"));
        img.src = fr.result;
      };
      fr.onerror = () => reject(new Error("No se pudo leer el archivo"));
      fr.readAsDataURL(file);
    };
    const finish = (img) => {
      try{
        const MAX = 1280;
        let w = img.width, h = img.height;
        if(!w || !h) return reject(new Error("Imagen sin dimensiones"));
        if(w > MAX || h > MAX){
          const k = MAX / Math.max(w, h);
          w = Math.round(w * k); h = Math.round(h * k);
        }
        const cv = document.createElement("canvas");
        cv.width = w; cv.height = h;
        cv.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(cv.toDataURL("image/jpeg", 0.8));
      }catch(e){ reject(new Error("No se pudo procesar la imagen")); }
    };
    try{
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(url); finish(img); };
      img.onerror = () => { URL.revokeObjectURL(url); viaReader(); };
      img.src = url;
    }catch(e){ viaReader(); }
  });
}

/* Lightbox: foto grande + caption + eliminar (dueño). */
function openPhotoLightbox(albumId, photoId, isOwner){
  const f = (window._albFotos || {})[photoId];
  if(!f) return;
  openDynModal(`
    <div style="text-align:center">
      <img src="${f.photo}" alt="" style="max-width:100%;max-height:60vh;border-radius:12px">
      ${f.caption ? `<p style="margin:10px 0 0;color:var(--cocoa-soft)">${esc(f.caption)}</p>` : ""}
      <div style="margin-top:12px;display:flex;gap:8px;justify-content:center">
        ${isOwner ? `<button class="btn btn-ghost btn-sm" style="color:#a33" onclick="deleteAlbumPhoto(${albumId}, ${photoId})">🗑 ${esc(t("alb.delete"))}</button>` : ""}
        <button class="btn btn-ghost btn-sm" onclick="openAlbumDetail(${albumId}, ${isOwner ? "false" : "true"})">${esc(t("alb.back"))}</button>
      </div>
    </div>`);
}

async function deleteAlbumPhoto(albumId, photoId){
  if(!confirm(t("alb.confirm_del_photo"))) return;
  try{
    const r = await fetch(`/api/albums/${albumId}/photos/${photoId}`, {
      method: "DELETE", headers: authHeaders()
    });
    const j = await r.json();
    if(!r.ok) throw new Error(j.error || ("HTTP " + r.status));
    toast(t("alb.deleted"));
    openAlbumDetail(albumId, false);
  }catch(e){ toast(e.message); }
}

async function deleteAlbum(albumId){
  if(!confirm(t("alb.confirm_del_album"))) return;
  try{
    const r = await fetch(`/api/albums/${albumId}`, {
      method: "DELETE", headers: authHeaders()
    });
    const j = await r.json();
    if(!r.ok) throw new Error(j.error || ("HTTP " + r.status));
    closeDynModal();
    toast(t("alb.deleted"));
    renderPerfilAlbums();
  }catch(e){ toast(e.message); }
}

/* ---------- Álbumes de OTRO usuario (solo lectura) ---------- */
async function viewUserAlbums(uid){
  uid = Number(uid);
  const w = (typeof dmWindows !== "undefined" && dmWindows[uid]) || null;
  const nombre = (w && w.target && w.target.nombre) || t("alb.readonly");
  openDynModal(`<h3 style="margin-top:0">📸 ${esc(nombre)}</h3>
    <div id="alb-other"><p style="text-align:center;color:var(--cocoa-soft)">…</p></div>`);
  try{
    const r = await fetch(`/api/albums/user/${uid}`, { headers: authHeaders() });
    const j = await r.json();
    if(!r.ok) throw new Error(j.error || ("HTTP " + r.status));
    const box = document.getElementById("alb-other");
    const albums = j.albums || [];
    if(!box) return;
    if(!albums.length){
      box.innerHTML = `<p style="text-align:center;color:var(--cocoa-soft)">${esc(t("alb.empty"))}</p>`;
      return;
    }
    box.innerHTML = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">` +
      albums.map(a => {
        const cover = a.portada
          ? `<img src="${a.portada}" alt="" style="width:100%;height:100%;object-fit:cover">`
          : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:2rem;background:var(--bg-soft)">📸</div>`;
        return `<div onclick="openAlbumDetail(${a.id}, true)" style="cursor:pointer">
          <div style="aspect-ratio:1;border-radius:12px;overflow:hidden;border:1px solid var(--hatch-widget-border)">${cover}</div>
          <div style="font-size:.82rem;font-weight:600;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.title)}</div>
          <div style="font-size:.75rem;color:var(--cocoa-soft)">${a.fotos} ${esc(t("alb.photos"))}</div>
        </div>`;
      }).join("") + `</div>`;
  }catch(e){
    const box = document.getElementById("alb-other");
    if(box) box.innerHTML = `<p style="text-align:center;color:#a33">${esc(e.message)}</p>`;
  }
}

/* Lista de países para el registro (nombres en español). */
const COUNTRY_LIST = [
  "Argentina","Bolivia","Brasil","Chile","Colombia","Costa Rica","Cuba","Ecuador",
  "El Salvador","España","Estados Unidos","Guatemala","Honduras","México","Nicaragua",
  "Panamá","Paraguay","Perú","Puerto Rico","República Dominicana","Uruguay","Venezuela",
  "Alemania","Canadá","Francia","Italia","Portugal","Reino Unido","Suiza",
  "China","Japón","Corea del Sur","India",
  "Australia","Nueva Zelanda",
  "Afganistán","Albania","Alemania","Andorra","Angola","Antigua y Barbuda","Arabia Saudita",
  "Argelia","Armenia","Austria","Azerbaiyán","Bahamas","Bangladés","Barbados","Baréin",
  "Bélgica","Belice","Benín","Bielorrusia","Birmania","Bosnia y Herzegovina","Botsuana",
  "Brunéi","Bulgaria","Burkina Faso","Burundi","Bután","Cabo Verde","Camboya","Camerún",
  "Catar","Chad","Chipre","Ciudad del Vaticano","Comoras","Congo","Corea del Norte",
  "Costa de Marfil","Croacia","Dinamarca","Dominica","Egipto","Emiratos Árabes Unidos",
  "Eritrea","Eslovaquia","Eslovenia","Estonia","Etiopía","Filipinas","Finlandia","Fiyi",
  "Gabón","Gambia","Georgia","Ghana","Granada","Grecia","Guinea","Guinea-Bisáu",
  "Guinea Ecuatorial","Guyana","Haití","Hungría","Indonesia","Irak","Irán","Irlanda",
  "Islandia","Islas Marshall","Islas Salomón","Israel","Jamaica","Jordania","Kazajistán",
  "Kenia","Kirguistán","Kiribati","Kuwait","Laos","Lesoto","Letonia","Líbano","Liberia",
  "Libia","Liechtenstein","Lituania","Luxemburgo","Macedonia del Norte","Madagascar",
  "Malasia","Malaui","Maldivas","Malí","Malta","Marruecos","Mauricio","Mauritania",
  "Micronesia","Moldavia","Mónaco","Mongolia","Montenegro","Mozambique","Namibia",
  "Nauru","Nepal","Nigeria","Noruega","Omán","Países Bajos","Pakistán","Palaos",
  "Papúa Nueva Guinea","Polonia","Rumania","Rusia","Ruanda","Samoa","San Cristóbal y Nieves",
  "San Marino","San Vicente y las Granadinas","Santa Lucía","Santo Tomé y Príncipe",
  "Senegal","Serbia","Seychelles","Sierra Leona","Singapur","Siria","Somalia","Sri Lanka",
  "Suazilandia","Sudáfrica","Sudán","Sudán del Sur","Suecia","Surinam","Tailandia",
  "Tanzania","Tayikistán","Timor Oriental","Togo","Tonga","Trinidad y Tobago","Túnez",
  "Turkmenistán","Turquía","Tuvalu","Ucrania","Uganda","Uzbekistán","Vanuatu","Yemen",
  "Yibuti","Zambia","Zimbabue"
];
function initCountrySelect(){
  const sel = document.getElementById("signup-country");
  if(!sel) return;
  const unicos = [...new Set(COUNTRY_LIST)].sort((a,b)=>a.localeCompare(b,"es"));
  for(const c of unicos){
    const o = document.createElement("option");
    o.value = c; o.textContent = c;
    sel.appendChild(o);
  }
}

/* ---------- 🤝 Afiliados: gana 5 RV por cada referido ---------- */
/* Muestra el conteo de referidos en el botón del perfil. */
async function loadAffiliateCount(){
  const el = $("affiliate-count");
  if(!el) return;
  try{
    const r = await fetch("/api/rv/affiliate", { headers: authHeaders() });
    const j = await r.json();
    if(!r.ok) return;
    const n = Number(j.referidos) || 0;
    el.textContent = n > 0 ? ` · 👥 ${n} referido${n === 1 ? "" : "s"}` : "";
  }catch(e){ /* silencioso: el botón sigue funcionando sin el conteo */ }
}

async function openAffiliateModal(){
  openDynModal(`<div style="text-align:center;padding:10px"><p style="color:var(--cocoa-soft)">Cargando…</p></div>`);
  try{
    const r = await fetch("/api/rv/affiliate", { headers: authHeaders() });
    const j = await r.json();
    if(!r.ok) throw new Error(j.error || "Error");
    openDynModal(`
      <div style="text-align:center">
        <div style="font-size:2.5rem">🤝</div>
        <h3 style="margin:8px 0">Programa de Afiliados</h3>
        <p style="color:var(--cocoa-soft);font-size:.9rem;margin:6px 0">
          Comparte tu link: por cada persona que se registre con él,<br>
          <b style="color:var(--terra);font-size:1.1rem">ganas 5 RV</b> 💰
        </p>
        <div style="display:flex;gap:16px;justify-content:center;margin:14px 0">
          <div style="background:var(--hatch-widget-bg,#f7f1e8);border-radius:12px;padding:10px 18px">
            <div style="font-size:1.4rem;font-weight:700">${j.referidos}</div>
            <div style="font-size:.8rem;color:var(--cocoa-soft)">referidos</div>
          </div>
          <div style="background:var(--hatch-widget-bg,#f7f1e8);border-radius:12px;padding:10px 18px">
            <div style="font-size:1.4rem;font-weight:700">${j.rvGanados}</div>
            <div style="font-size:.8rem;color:var(--cocoa-soft)">RV ganados</div>
          </div>
        </div>
        <p style="font-size:.85rem;color:var(--cocoa-soft);margin:8px 0">Tu link de afiliado:</p>
        <div style="display:flex;gap:8px;margin:0 0 12px">
          <input id="aff-link" class="field" readonly value="${esc(j.link)}"
            style="flex:1;font-size:.8rem" onclick="this.select()">
          <button class="btn btn-primary btn-sm" onclick="copyAffLink()">📋</button>
        </div>
        <p style="font-size:.85rem;color:var(--cocoa-soft);margin:8px 0">Mensaje listo para compartir:</p>
        <div style="background:var(--hatch-widget-bg,#f7f1e8);border-radius:12px;padding:12px;margin:0 0 12px;text-align:left;font-size:.85rem">
          <span id="aff-msg">💔 ¿Terminaste una relación y no sabes cómo seguir?<br><br>
          🌅 Descubrí <b>Reaviva</b>: un programa de 30 días para soltar el dolor y recuperar tu paz.<br><br>
          ✅ 7 días GRATIS · Sin tarjeta<br><br>
          👉 ${esc(j.link)}</span>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="copyAffMsg()">📋 Copiar mensaje</button>
        <p style="font-size:.8rem;color:var(--cocoa-soft)">
          Con RV puedes publicar links y fotos en el chat 📎🔗
        </p>
        <button class="btn btn-ghost" onclick="closeDynModal()" style="margin-top:8px">Cerrar</button>
      </div>`);
  }catch(e){
    openDynModal(`<p style="text-align:center;color:#a33">${esc(e.message)}</p>`);
  }
}
function copyAffLink(){
  const inp = document.getElementById("aff-link");
  if(!inp) return;
  inp.select();
  try{
    document.execCommand("copy");
    toast("Link copiado 📋");
  }catch(e){
    if(navigator.clipboard) navigator.clipboard.writeText(inp.value).then(()=>toast("Link copiado 📋"));
  }
}
function copyAffMsg(){
  const el = document.getElementById("aff-msg");
  if(!el) return;
  const txt = el.innerText || el.textContent;
  if(navigator.clipboard){
    navigator.clipboard.writeText(txt).then(()=>toast("Mensaje copiado 📋"));
  }else{
    const ta = document.createElement("textarea");
    ta.value = txt; document.body.appendChild(ta); ta.select();
    try{ document.execCommand("copy"); toast("Mensaje copiado 📋"); }catch(e){}
    document.body.removeChild(ta);
  }
}
