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
  const topicBtn = $("#topic-add-btn");
  if(ta){ ta.disabled = true; ta.placeholder = "🚩 Solo puedes ver los mensajes (chat deshabilitado)"; }
  if(btn){ btn.disabled = true; btn.style.opacity = ".5"; }
  if(photoBtn) photoBtn.style.display = "none";
  if(emojiBtn) emojiBtn.style.display = "none";
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

/* Maneja los códigos de error del filtro anti-spam del servidor. */
function handleSpamError(j){
  const code = j && j.error;
  const msg = (j && j.message) || "Contenido no permitido.";
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
    if(bal) bal.textContent = Number(j.rv) || 0;
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
    toast("Pago cancelado.");
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
function esc(s){ return String(s||"").replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }

/* ---------- auth (placeholder) ----------
 * MVP: email stored locally only. Replace with real backend auth later.
 */
function currentUser(){ return store.get(LS.user, null); }
function requireAuth(){
  if(currentUser()) return true;
  showView("auth"); return false;
}
/* ---------- auth con backend (email + contraseña) ---------- */
let authMode = "login"; // "login" (principal) | "signup"

function switchAuthMode(mode){
  authMode = mode;
  $("#tab-login").classList.toggle("active", mode === "login");
  $("#tab-signup").classList.toggle("active", mode === "signup");
  $("#form-login").style.display = mode === "login" ? "" : "none";
  $("#form-signup").style.display = mode === "signup" ? "" : "none";
  $("#login-err").textContent = "";
  $("#signup-err").textContent = "";
}

function togglePassword(id){
  const f = $("#" + id);
  f.type = f.type === "password" ? "text" : "password";
}

/* Guarda la sesión del backend y entra a la app. */
function saveSession(token, user){
  store.set("reaviva_token", token);
  store.set(LS.user, { id: user.id, email: user.email, name: user.name, planType: user.planType || "free" });
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
      errBox.textContent = j.error || "No se pudo entrar. Inténtalo de nuevo.";
      return;
    }
    saveSession(j.token, j.user);
    enterApp();
    toast("¡Bienvenido/a de nuevo, " + j.user.name + "! 💛");
  }catch(e){
    errBox.textContent = "Sin conexión con el servidor. Revisa tu internet.";
  }
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
  if(password.length < 6){ errBox.textContent = "La contraseña debe tener al menos 6 caracteres."; return; }
  if(password !== password2){ errBox.textContent = "Las contraseñas no coinciden."; return; }
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
      body: JSON.stringify({ name, email, password, recaptchaToken, referred_by: localStorage.getItem("reaviva_ref") || null })
    });
    const j = await r.json();
    if(!r.ok){ errBox.textContent = j.error || "No se pudo crear la cuenta. Inténtalo de nuevo."; return; }
    // La cuenta se crea SIN verificar: no se entra a la app hasta confirmar el correo.
    try{ if(recaptchaWidgetId !== null && window.grecaptcha) grecaptcha.reset(recaptchaWidgetId); }catch(e){}
    showVerifyEmail(j.email || email);
    toast("¡Cuenta creada! Revisa tu correo 📧");
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
    enterApp();
    toast("¡Acceso de administrador! 👑");
  }catch(e){
    toast("Sin conexión con el servidor");
  }
}

/* ---------- views ---------- */
function showView(name){
  ["landing","auth","app","admin-login","verify-email"].forEach(v => {
    const el = $("#view-"+v);
    if(el) el.style.display = v===name ? "" : "none";
  });
  const target = $("#view-"+name);
  if(target) target.style.display = "";
  try{ window.scrollTo(0,0); }catch(e){}
}
function enterApp(){
  showView("app");
  const u = currentUser();
  const chip = $("#user-chip");
  if(chip && u) chip.textContent = "Hola, " + esc(u.name);
  // Mostrar pestaña Admin solo para administradores
  const adminTab = document.querySelector('[data-tab="admin"]');
  if(adminTab) adminTab.style.display = isAdmin() ? "" : "none";
  try{ switchTab("hoy"); }catch(e){ console.error("switchTab:", e); }
  try{ checkUserMessages(); }catch(e){}
  try{ startDmPoll(); }catch(e){}
}
function switchTab(tab){
  $$(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab===tab));
  $$(".panel").forEach(p => p.classList.toggle("active", p.id==="panel-"+tab));
  // El sondeo de mensajes nuevos solo corre con el chat abierto.
  if(tab === "comunidad") startChatPoll(); else stopChatPoll();
  if(tab==="hoy") renderHoy();
  if(tab==="programa") renderPrograma();
  if(tab==="diario") renderDiario();
  if(tab==="progreso") renderProgreso();
  if(tab==="comunidad") renderComunidad();
  if(tab==="privados") renderDmList();
  if(tab==="perfil") renderPerfil();
  if(tab==="admin") renderAdmin();
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
      <h2>${esc(prog.title)}</h2>
      <p>${esc(prog.reflexion.slice(0,140))}…</p>
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
      <div class="info"><b>Día ${p.day} · ${esc(p.title)}</b><small>${esc(p.part)}</small></div>
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
  openDayNum = d;
  const p = window.REAVIVA_PROGRAM[d-1];
  $("#day-detail").innerHTML = `
    <div class="day-hero">
      <div class="part">${esc(p.part)}</div>
      <h2>Día ${p.day} · ${esc(p.title)}</h2>
    </div>
    <div class="block audio-block"><h4>🎧 Escuchar</h4><audio controls preload="none" src="/audio/dia-${p.day}.mp3" style="width:100%"></audio></div>
    <div class="block case"><h4>📖 El caso</h4><p>${esc(p.caso)}</p></div>
    <div class="block"><h4>💭 Reflexión</h4><p>${esc(p.reflexion)}</p></div>
    <div class="block"><h4>✍️ Ejercicio</h4><p>${esc(p.ejercicio)}</p></div>
    <div class="block"><h4>✅ Acción de hoy</h4><p>${esc(p.accion)}</p></div>
    <div class="complete-row">
      <button class="btn ${isDone(d)?"btn-ghost":"btn-primary"} btn-block" onclick="completeDay(${d})">
        ${isDone(d) ? "✓ Día completado" : "Marcar día como completado"}
      </button>
    </div>
    <div class="day-nav">
      <button class="btn btn-ghost" ${d<=1?"disabled":""} onclick="openDay(${d-1})">← Anterior</button>
      <button class="btn btn-ghost" ${d>=30?"disabled":""} onclick="openDay(${d+1})">Siguiente →</button>
    </div>
    <div style="margin-top:16px"><button class="btn btn-ghost btn-block" onclick="backToList()">← Volver al programa</button></div>`;
  $("#panel-programa-list").style.display = "none";
  $("#day-detail").style.display = "";
  window.scrollTo(0,0);
}
function backToList(){
  $("#day-detail").style.display = "none";
  $("#panel-programa-list").style.display = "";
  renderPrograma();
}
function completeDay(d){
  markDone(d);
  toast("¡Día " + d + " completado! 💛");
  openDay(d);
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
  toast("Guardado en tu diario 💛");
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
  box.innerHTML = `
    <div style="text-align:center;padding:10px 0">
      <div style="font-size:1.3rem;font-weight:700">${nombre}</div>
      <div style="color:var(--cocoa-soft);font-size:.9rem;margin:4px 0">${planLabel}</div>
    </div>
    <button class="btn btn-primary btn-block" onclick="openShareModal()" style="margin:14px 0;font-size:1rem;padding:14px">📤 Compartir Reaviva</button>
    <p style="text-align:center;font-size:.85rem;color:var(--cocoa-soft)">¿Reaviva te está ayudando? Compártelo con alguien que lo necesite 💛</p>`;
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
async function renderComunidad(){
  const list = $("#community-list");
  list.innerHTML = `<p style="text-align:center;color:var(--cocoa-soft)">Cargando comentarios…</p>`;
  // Los temas se cargan en paralelo (solo visibles con plan).
  loadTopics().catch(()=>{});
  // Saldo de RV en la cabecera del chat (solo con plan).
  loadRVBalance().catch(()=>{});
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
    // Botón de usuarios en línea 🟢🔴.
    if(j.onlineCount != null) updateOnlineBtn(j.onlineCount);
    const items = j.comentarios || [];
    // Mapa uid → datos para abrir DMs al hacer clic (sin exponer nada extra).
    communityUsers = {};
    list.innerHTML = items.map(c=>{
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
      return `
      <div class="comment-card">
        <div class="comment-avatar"${clickAttr}>${avatar}</div>
        <div class="comment-body">
          <div class="comment-head"><b${clickAttr}>${esc(c.nombre || "Guest")}</b>${c.promo ? `<span class="promo-badge" title="Mensaje promocional">📢</span>` : ""}${c.repost ? `<span class="repost-badge" title="Republicación automática">🔁</span>` : ""}${expiryTag}<span>${esc(c.fecha)}</span></div>
          ${body}
        </div>
      </div>`;}).join("") ||
      `<div class="empty-state"><div style="font-size:2.5rem">💛</div>
       <p><b>Sé la primera persona en compartir</b></p>
       <p style="font-size:.85rem;color:var(--cocoa-soft)">Tu historia puede ayudar a alguien que lo necesita.</p></div>`;
  }catch(e){
    list.innerHTML = `<p style="text-align:center;color:#a33">Error cargando la comunidad</p>`;
  }
}

async function postCommunity(){
  const box = $("#community-text");
  const text = box ? box.value.trim() : "";
  if(!text){ toast("Escribe algo para compartir 💛"); return; }
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
  if(!isPaid()){ toast("Solo los miembros con plan pueden crear temas 💎"); return; }
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

function toggleEmojiPanel(){
  const panel = $("#emoji-panel");
  if(!panel) return;
  if(panel.style.display === "none"){
    panel.innerHTML = EMOJIS.map(e =>
      `<button type="button" class="emoji-btn" onclick="insertEmoji('${e}')">${e}</button>`
    ).join("");
    panel.style.display = "grid";
  }else{
    panel.style.display = "none";
  }
}

function insertEmoji(e){
  const box = $("#community-text");
  if(!box) return;
  const start = box.selectionStart || box.value.length;
  const end = box.selectionEnd || box.value.length;
  box.value = box.value.slice(0, start) + e + box.value.slice(end);
  box.focus();
  box.selectionStart = box.selectionEnd = start + e.length;
}

/* Fotos temporales: solo usuarios con plan. */
function pickChatPhoto(){
  if(!isPaid()){ toast("Solo los miembros con plan pueden enviar fotos 💎"); return; }
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
  toast("Enviando foto… 📷");
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
    toast("¡Foto enviada! Se eliminará en 30 segundos ⏳");
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
        if(nuevos.some(c => !myMsgIds.has(c.id))) playDing();
        renderComunidad();
      }
    }catch(e){ /* reintentar en el próximo ciclo */ }
  }, 15000);
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
let dmActiveUid = null;
let dmPollTimer = null;

function dmAvatarHtml(p){
  return (p.foto && String(p.foto).startsWith("data:image/"))
    ? `<img src="${esc(p.foto)}" class="comment-photo" alt="">`
    : esc(p.avatar || "💛");
}

/* Clic en avatar/nombre de la comunidad. */
function onCommunityUserClick(uid){
  uid = Number(uid);
  const me = currentUser();
  if(me && Number(me.id) === uid){ toast("Ese eres tú 😄"); return; }
  const target = communityUsers[uid] || { nombre: "Usuario", foto: null, avatar: "💛" };
  if(planType() !== "free"){
    openDmChat(uid, target);
    switchTab("privados");
  }else{
    toast("Los mensajes privados son para miembros con plan 💎");
  }
}

/* ---------- lista de conversaciones ---------- */
async function renderDmList(){
  const list = $("#dm-list");
  const chat = $("#dm-chat");
  if(chat) chat.style.display = "none";
  if(list) list.style.display = "";
  dmActiveUid = null;
  if(planType() === "free"){
    if(list) list.innerHTML = `
      <div class="empty-state"><div style="font-size:2.5rem">💎</div>
      <p><b>Mensajes privados</b></p>
      <p style="font-size:.85rem;color:var(--cocoa-soft)">Solo para miembros con plan.</p>
      <button class="btn btn-primary" onclick="openPaywall()" style="margin-top:10px">Ver planes</button>
      </div>`;
    return;
  }
  if(list) list.innerHTML = `<p style="text-align:center;color:var(--cocoa-soft)">Cargando conversaciones…</p>`;
  try{
    const r = await fetch("/api/dm/conversations", { headers: authHeaders() });
    if(!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    const convs = j.conversaciones || [];
    if(!convs.length){
      list.innerHTML = `
        <div class="empty-state"><div style="font-size:2.5rem">💬</div>
        <p><b>Sin conversaciones todavía</b></p>
        <p style="font-size:.85rem;color:var(--cocoa-soft)">Toca la foto o el nombre de alguien en la comunidad para escribirle en privado.</p></div>`;
      return;
    }
    list.innerHTML = convs.map(c => `
      <div class="dm-conv" onclick="openDmChat(${Number(c.uid)})">
        <div class="comment-avatar">${dmAvatarHtml(c)}</div>
        <div class="dm-conv-body">
          <div class="dm-conv-head"><b>${esc(c.nombre)}</b><span>${esc(c.fecha || "")}</span></div>
          <p class="dm-preview">${esc(c.ultimo || "")}</p>
        </div>
        ${c.noLeidos ? `<span class="dm-unread">${c.noLeidos}</span>` : ""}
      </div>`).join("");
  }catch(e){
    if(list) list.innerHTML = `<p style="text-align:center;color:#a33">Error cargando conversaciones</p>`;
  }
}

/* ---------- chat privado con un usuario ---------- */
async function openDmChat(uid, target){
  uid = Number(uid);
  dmActiveUid = uid;
  if(!target){
    try{
      const r = await fetch("/api/dm/conversations", { headers: authHeaders() });
      const j = await r.json();
      const c = (j.conversaciones || []).find(x => Number(x.uid) === uid);
      if(c) target = c;
    }catch(e){}
  }
  target = target || communityUsers[uid] || { nombre: "Usuario", foto: null, avatar: "💛" };
  const list = $("#dm-list");
  const chat = $("#dm-chat");
  if(list) list.style.display = "none";
  if(!chat) return;
  chat.style.display = "";
  chat.innerHTML = `
    <div class="dm-chat-head">
      <button class="dm-back" onclick="renderDmList()" aria-label="Volver">←</button>
      <div class="comment-avatar">${dmAvatarHtml(target)}</div>
      <div style="flex:1"><b>${esc(target.nombre)}</b><br><small id="dm-countdown" style="color:var(--cocoa-soft)">⏳ Los mensajes se eliminan en 48h</small></div>
      <button id="dm-video-btn" class="dm-icon-btn" title="${isAnnual() ? "Videollamada 📹" : "Actualiza a plan anual 💎"}" aria-label="Videollamada">${isAnnual() ? "📹" : "📹🔒"}</button>
    </div>
    <div id="dm-messages" class="dm-messages"><p style="text-align:center;color:var(--cocoa-soft)">Cargando…</p></div>
    <div class="dm-composer">
      <input id="dm-voice-file" type="file" accept=".pdf,.doc,.docx,.txt" style="display:none" onchange="sendDmFile(this)">
      <button id="dm-voice-btn" class="dm-icon-btn" title="Mensaje de voz 🎤" aria-label="Mensaje de voz">🎤</button>
      <button id="dm-file-btn" class="dm-icon-btn" title="${isAnnual() ? "Adjuntar archivo 📎" : "Actualiza a plan anual 💎"}" aria-label="Adjuntar archivo">${isAnnual() ? "📎" : "📎🔒"}</button>
      <input id="dm-input" class="field" maxlength="1000" placeholder="Escribe un mensaje privado…"
        onkeydown="if(event.key==='Enter')sendDm()">
      <button class="btn btn-primary" onclick="sendDm()">➤</button>
    </div>
    <div id="dm-rec-ind" class="dm-rec-ind" style="display:none">🔴 Grabando… <span id="dm-rec-time">0:00</span> <button class="btn btn-sm" onclick="toggleDmVoice()">Detener</button></div>`;
  /* Botón de videollamada según el plan. */
  const vbtn = $("#dm-video-btn");
  if(vbtn){
    if(isAnnual()){ vbtn.onclick = startVideoCall; }
    else { vbtn.onclick = function(){ openUpgradeModal("Las videollamadas son exclusivas del plan anual 💎"); }; vbtn.classList.add("locked-feature"); }
  }
  /* Botón de archivo: solo anual. */
  const fbtn = $("#dm-file-btn");
  if(fbtn){
    if(isAnnual()){ fbtn.onclick = function(){ $("#dm-voice-file").click(); }; }
    else { fbtn.onclick = function(){ openUpgradeModal("Los archivos adjuntos son exclusivos del plan anual 💎"); }; fbtn.classList.add("locked-feature"); }
  }
  /* Botón de voz: anual y mensual (los gratuitos no llegan al DM). */
  const mic = $("#dm-voice-btn");
  if(mic){ mic.onclick = toggleDmVoice; }
  await loadDmMessages();
  updateDmBadge();
  startDmCountdown();
}

async function loadDmMessages(){
  const box = $("#dm-messages");
  if(!box || !dmActiveUid) return;
  try{
    const r = await fetch("/api/dm/" + dmActiveUid, { headers: authHeaders() });
    if(!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    const msgs = j.mensajes || [];
    box.innerHTML = msgs.map(m => {
      const tipo = m.tipo || "text";
      let cuerpo = "";
      if(tipo === "voice" && m.audio){
        cuerpo = `<audio controls preload="metadata" src="${esc(m.audio)}" style="max-width:100%"></audio>`;
      }else if(tipo === "video-invite" && m.texto){
        cuerpo = `<p>📹 <b>Invitación a videollamada</b></p>
          <button class="btn btn-primary btn-sm" onclick="window.open('${esc(m.texto)}','_blank')">Unirse a la videollamada</button>`;
      }else if(tipo === "file" && m.archivo){
        const kb = m.archivo.tamano ? (m.archivo.tamano/1024).toFixed(0) + " KB" : "";
        cuerpo = `<a class="dm-file-card" href="${esc(m.archivo.data)}" download="${esc(m.archivo.nombre)}">
          <span class="dm-file-icon">📎</span>
          <span><b>${esc(m.archivo.nombre)}</b><br><small>${kb} · clic para descargar</small></span>
        </a>`;
      }else{
        cuerpo = `<p>${esc(m.texto)}</p>`;
      }
      return `
      <div class="dm-msg ${m.mio ? "dm-mine" : "dm-theirs"}"${m.expira ? ` data-expira="${esc(m.expira)}"` : ""}>
        ${cuerpo}
        <span class="dm-meta">${esc(m.fecha)} · ⏳ se elimina en 48h</span>
      </div>`;
    }).join("") || `<p style="text-align:center;color:var(--cocoa-soft)">Sin mensajes todavía. ¡Saluda! 👋</p>`;
    box.scrollTop = box.scrollHeight;
  }catch(e){
    box.innerHTML = `<p style="text-align:center;color:#a33">Error cargando mensajes</p>`;
  }
}

async function sendDm(){
  const inp = $("#dm-input");
  const text = inp ? inp.value.trim() : "";
  if(!text || !dmActiveUid) return;
  try{
    const r = await fetch("/api/dm", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ to_user_id: dmActiveUid, text })
    });
    const j = await r.json().catch(() => ({}));
    if(!r.ok){
      if(j.error === "UPGRADE_ANNUAL"){ openUpgradeModal(j.message); return; }
      if(handleSpamError(j)) return;
      throw new Error(j.message || j.error || ("HTTP " + r.status));
    }
    if(inp) inp.value = "";
    playDing();
    await loadDmMessages();
  }catch(e){
    toast(e.message);
  }
}

/* ---------- videollamada (solo plan anual, vía Jitsi Meet) ---------- */
async function startVideoCall(){
  if(!dmActiveUid) return;
  if(!isAnnual()){ openUpgradeModal("Las videollamadas son exclusivas del plan anual 💎"); return; }
  try{
    const r = await fetch("/api/dm/" + dmActiveUid + "/video-call", {
      method: "POST", headers: authHeaders()
    });
    const j = await r.json().catch(() => ({}));
    if(!r.ok){
      if(j.error === "UPGRADE_ANNUAL"){ openUpgradeModal(j.message); return; }
      throw new Error(j.message || j.error || ("HTTP " + r.status));
    }
    window.open(j.roomUrl, "_blank");
    await loadDmMessages();
  }catch(e){
    toast(e.message);
  }
}

/* ---------- mensajes de voz (plan anual y mensual) ---------- */
let dmRecorder = null, dmAudioChunks = [], dmRecTimer = null, dmRecSecs = 0;

async function toggleDmVoice(){
  if(dmRecorder && dmRecorder.state === "recording"){ detenerDmVoice(); return; }
  try{
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    dmRecorder = new MediaRecorder(stream);
    dmAudioChunks = [];
    dmRecorder.ondataavailable = e => { if(e.data && e.data.size) dmAudioChunks.push(e.data); };
    dmRecorder.onstop = enviarDmVoice;
    dmRecorder.start();
    dmRecSecs = 0;
    const ind = $("#dm-rec-ind"), t = $("#dm-rec-time");
    if(ind) ind.style.display = "";
    dmRecTimer = setInterval(() => {
      dmRecSecs++;
      if(t) t.textContent = Math.floor(dmRecSecs/60) + ":" + String(dmRecSecs%60).padStart(2, "0");
      if(dmRecSecs >= 120) detenerDmVoice(); /* máx 2 minutos */
    }, 1000);
  }catch(e){
    toast("No se pudo acceder al micrófono 🎤");
  }
}

function detenerDmVoice(){
  if(dmRecTimer){ clearInterval(dmRecTimer); dmRecTimer = null; }
  const ind = $("#dm-rec-ind");
  if(ind) ind.style.display = "none";
  if(dmRecorder && dmRecorder.state === "recording"){
    dmRecorder.stop();
  }else{
    dmRecorder = null;
  }
  try{ dmRecorder && dmRecorder.stream && dmRecorder.stream.getTracks().forEach(tr => tr.stop()); }catch(e){}
}

async function enviarDmVoice(){
  const rec = dmRecorder; dmRecorder = null;
  try{ rec && rec.stream && rec.stream.getTracks().forEach(tr => tr.stop()); }catch(e){}
  if(!dmAudioChunks.length || !dmActiveUid){ dmAudioChunks = []; return; }
  const blob = new Blob(dmAudioChunks, { type: (rec && rec.mimeType) || "audio/webm" });
  dmAudioChunks = [];
  const reader = new FileReader();
  reader.onload = async () => {
    try{
      const r = await fetch("/api/dm/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ to_user_id: dmActiveUid, audio: reader.result })
      });
      const j = await r.json().catch(() => ({}));
      if(!r.ok){
        if(j.error === "UPGRADE_ANNUAL"){ openUpgradeModal(j.message); return; }
        throw new Error(j.message || j.error || ("HTTP " + r.status));
      }
      playDing();
      await loadDmMessages();
    }catch(e){
      toast(e.message);
    }
  };
  reader.readAsDataURL(blob);
}

/* ---------- archivos adjuntos (solo plan anual) ---------- */
async function sendDmFile(input){
  const f = input && input.files && input.files[0];
  input.value = "";
  if(!f || !dmActiveUid) return;
  if(!isAnnual()){ openUpgradeModal("Los archivos adjuntos son exclusivos del plan anual 💎"); return; }
  const permitidos = ["application/pdf", "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain"];
  if(!permitidos.includes(f.type)){
    toast("Solo se permiten PDF, DOC, DOCX y TXT 📎");
    return;
  }
  if(f.size > 10 * 1024 * 1024){
    toast("El archivo es muy grande (máx 10MB) 📎");
    return;
  }
  const reader = new FileReader();
  reader.onload = async () => {
    try{
      const r = await fetch("/api/dm/file", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ to_user_id: dmActiveUid, file: reader.result, fileName: f.name })
      });
      const j = await r.json().catch(() => ({}));
      if(!r.ok){
        if(j.error === "UPGRADE_ANNUAL"){ openUpgradeModal(j.message); return; }
        throw new Error(j.message || j.error || ("HTTP " + r.status));
      }
      playDing();
      await loadDmMessages();
    }catch(e){
      toast(e.message);
    }
  };
  reader.readAsDataURL(f);
}

/* ---------- insignia + aviso de mensajes sin leer ---------- */
async function updateDmBadge(){
  try{
    const r = await fetch("/api/dm/unread-count", { headers: authHeaders() });
    if(!r.ok) return;
    const j = await r.json();
    const n = j.count || 0;
    const badge = $("#dm-badge");
    if(badge){
      badge.style.display = n ? "" : "none";
      badge.textContent = n > 99 ? "99+" : n;
    }
    const notif = $("#dm-notif");
    if(notif){
      if(n && planType() === "free"){
        notif.style.display = "";
        notif.innerHTML = `💬 Tienes ${n} mensaje${n === 1 ? "" : "s"} privado${n === 1 ? "" : "s"} sin leer.
          <button class="btn btn-primary btn-sm" onclick="openUpgradeModal()">Actualizar a anual 💎</button>`;
      }else if(n){
        notif.style.display = "";
        notif.innerHTML = `💬 Tienes ${n} mensaje${n === 1 ? "" : "s"} privado${n === 1 ? "" : "s"} sin leer.
          <button class="btn btn-primary btn-sm" onclick="switchTab('privados')">Ver</button>`;
      }else{
        notif.style.display = "none";
        notif.innerHTML = "";
      }
    }
  }catch(e){ /* sin conexión: no mostrar nada */ }
}

function startDmPoll(){
  stopDmPoll();
  updateDmBadge();
  dmPollTimer = setInterval(updateDmBadge, 30000);
}

/* Cronómetro de 48h en el chat privado: muestra el tiempo restante
 * del mensaje más antiguo visible. Se actualiza cada minuto. */
let dmCountdownTimer = null;
function startDmCountdown(){
  stopDmCountdown();
  updateDmCountdown();
  dmCountdownTimer = setInterval(updateDmCountdown, 60000);
}
function stopDmCountdown(){
  if(dmCountdownTimer){ clearInterval(dmCountdownTimer); dmCountdownTimer = null; }
}
function updateDmCountdown(){
  const el = $("#dm-countdown");
  if(!el || !dmActiveUid) return;
  // Busca el mensaje con expiración más próxima (tiene data-expira).
  const msgs = document.querySelectorAll("#dm-messages [data-expira]");
  if(!msgs.length){ el.textContent = "⏳ Los mensajes se eliminan en 48h"; return; }
  let proxima = Infinity;
  msgs.forEach(m => {
    const t = new Date(m.getAttribute("data-expira").replace(" ", "T") + "Z").getTime();
    if(!isNaN(t) && t < proxima) proxima = t;
  });
  if(proxima === Infinity){ el.textContent = "⏳ Los mensajes se eliminan en 48h"; return; }
  const restante = proxima - Date.now();
  if(restante <= 0){ el.textContent = "⏳ Eliminando mensajes…"; return; }
  const h = Math.floor(restante / 3600000);
  const m = Math.floor((restante % 3600000) / 60000);
  el.textContent = h >= 24
    ? `⏳ Se eliminan en ${Math.floor(h/24)}d ${h%24}h`
    : `⏳ Se eliminan en ${h}h ${m}m`;
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
    toast("Pago cancelado — puedes intentarlo cuando quieras");
    return;
  }
  toast("¡Pago recibido! Activando tu membresía… 💛");
  await refreshPaidStatus();
  if(isPaid()){
    toast("¡Membresía activa! Bienvenido/a a tu proceso 💛");
  } else {
    // el webhook puede tardar unos segundos: reintenta un par de veces
    setTimeout(async ()=>{ await refreshPaidStatus(); if(isPaid()) toast("¡Membresía activa! 💛"); }, 4000);
  }
  if(currentUser()) enterApp(); else showView("auth");
}

/* ---------- init ---------- */

/* ============ TOUR DE BIENVENIDA (se muestra una vez) ============ */
const TOUR_STEPS = [
  {
    emoji: "🎉",
    titulo: "¡Bienvenido a Reaviva!",
    texto: "Tu espacio de sanación emocional. Te mostramos lo esencial en unos segundos."
  },
  {
    emoji: "📅",
    titulo: "Tu programa de 30 días",
    texto: "Cada día tienes una reflexión, un ejercicio y un audio para sanar tu corazón. Completa un día a la vez, a tu ritmo."
  },
  {
    emoji: "💬",
    titulo: "Chat de la comunidad",
    texto: "Conversa con otros en proceso de sanación. Todos aparecen con iniciales y país: tu identidad está protegida."
  },
  {
    emoji: "💰",
    titulo: "Moneda RV",
    texto: "Con RV puedes compartir enlaces y fotos en el chat. Recarga desde $12 tocando el botón 💰. Al registrarte con plan mensual recibes 50 RV, con plan anual 200 RV."
  },
  {
    emoji: "⭐",
    titulo: "Tu perfil y planes",
    texto: "En tu perfil ves tu progreso, tu país y tu plan. Actualiza a un plan para desbloquear fotos, temas, mensajes privados ¡y más!"
  }
];
let tourStep = 0;

function maybeShowTour(){
  try{
    if(localStorage.getItem("reaviva_tour_done")) return;
  }catch(e){ return; }
  tourStep = 0;
  renderTourStep();
  const m = document.getElementById("tour-modal");
  if(m) m.style.display = "flex";
}

function renderTourStep(){
  const s = TOUR_STEPS[tourStep];
  const c = document.getElementById("tour-content");
  if(c) c.innerHTML = `<div class="tour-emoji">${s.emoji}</div><h3>${s.titulo}</h3><p>${s.texto}</p>`;
  const dots = document.getElementById("tour-dots");
  if(dots) dots.innerHTML = TOUR_STEPS.map((_, i) =>
    `<span class="tour-dot${i === tourStep ? " active" : ""}"></span>`).join("");
  const next = document.getElementById("tour-next");
  if(next) next.textContent = tourStep === TOUR_STEPS.length - 1 ? "¡Empezar! 💛" : "Siguiente →";
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
  // landing CTAs
  $$("[data-go-app]").forEach(b=>b.addEventListener("click", async ()=>{
    afterRestore(await restoreSession());
  }));
  $("#logout-btn").addEventListener("click", ()=>{
    try{ stopDmPoll(); }catch(e){}
    try{ stopChatPoll(); }catch(e){}
    localStorage.removeItem(LS.user);
    localStorage.removeItem("reaviva_token");
    localStorage.removeItem("reaviva_admin");
    localStorage.removeItem("reaviva_paid");
    showView("landing");
  });
  // PayPal return (?paypal=ok|cancel) + sync paid status with backend
  handlePayPalReturn();
  // Retorno de compra de RV (?rv=ok&token=ORDERID)
  handleRVReturn().catch(()=>{});
  refreshPaidStatus();
  // reCAPTCHA v2 en el formulario de registro (si hay site key configurada)
  initRecaptcha();
  // URL secreta de admin: /admin/ingzoe
  if(location.pathname === "/admin/ingzoe"){
    restoreSession().then(ok => { if(ok && isAdmin()) enterApp(); else showView("admin-login"); });
    return;
  }
  // deep-link: #app — valida la sesión contra el backend
  if(location.hash === "#app"){
    restoreSession().then(afterRestore);
  }
  // Referido: si llegó con ?ref=USERID, guardarlo para el registro.
  try{
    const refParam = new URLSearchParams(location.search).get("ref");
    if(refParam && /^\d+$/.test(refParam)) localStorage.setItem("reaviva_ref", refParam);
  }catch(e){}
  // Tour de bienvenida: se muestra una vez al primer ingreso.
  setTimeout(maybeShowTour, 1500);
});

/* ============================================================
   COMPARTIR REAVIVA
   ============================================================ */
const SHARE_MSG = "🌅 ¿Sientes que tu corazón necesita sanar? Descubrí Reaviva, un programa de 30 días que me está ayudando a soltar el dolor y recuperar mi paz. ¡Tienes 7 días gratis! 💛";

function myShareLink(){
  const u = currentUser();
  const base = "https://www.reavivaapp.com/";
  // Link personal con ref para rastrear referidos (solo si hay sesión).
  return (u && u.id) ? base + "?ref=" + encodeURIComponent(u.id) : base;
}

function openShareModal(){
  const link = myShareLink();
  const txt = SHARE_MSG + " " + link;
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
  const txt = SHARE_MSG + " " + link;
  const msg = $("#share-copy-msg");
  const done = (t) => { if(msg) msg.textContent = t; };
  if(canal === "whatsapp"){
    window.open("https://wa.me/?text=" + encodeURIComponent(txt), "_blank");
  }else if(canal === "facebook"){
    window.open("https://www.facebook.com/sharer/sharer.php?u=" + encodeURIComponent(link) + "&quote=" + encodeURIComponent(SHARE_MSG), "_blank");
  }else if(canal === "telegram"){
    window.open("https://t.me/share/url?url=" + encodeURIComponent(link) + "&text=" + encodeURIComponent(SHARE_MSG), "_blank");
  }else if(canal === "x"){
    window.open("https://twitter.com/intent/tweet?text=" + encodeURIComponent(txt), "_blank");
  }else if(canal === "copy"){
    const copiar = async () => {
      try{
        await navigator.clipboard.writeText(txt);
        done("✅ ¡Link copiado! Pégalo donde quieras 💛");
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
