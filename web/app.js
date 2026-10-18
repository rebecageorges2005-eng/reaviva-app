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
  store.set(LS.user, { email: user.email, name: user.name });
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
      body: JSON.stringify({ name, email, password, recaptchaToken })
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

/* Sync the paid flag with the backend (PayPal is the source of truth). */
async function refreshPaidStatus(){
  const u = currentUser();
  if(!u || !u.email) return;
  try{
    const r = await fetch("/api/paypal/status?email=" + encodeURIComponent(u.email));
    if(!r.ok) return; // backend sin PayPal o sin registro: conserva el valor local
    const j = await r.json();
    store.set("reaviva_paid", !!j.subscribed);
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
  // El botón de foto solo para usuarios con plan.
  const photoBtn = $("#photo-btn");
  if(photoBtn) photoBtn.style.display = isPaid() ? "" : "none";
  try{
    const r = await fetch("/api/community", { headers: authHeaders() });
    if(!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    const items = j.comentarios || [];
    list.innerHTML = items.map(c=>{
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
      return `
      <div class="comment-card">
        <div class="comment-avatar">${avatar}</div>
        <div class="comment-body">
          <div class="comment-head"><b>${esc(c.nombre || "Guest")}</b><span>${esc(c.fecha)}</span></div>
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
    if(!r.ok) throw new Error(j.error || ("HTTP " + r.status));
    if(j.id){ myMsgIds.add(j.id); seenMsgIds.add(j.id); }
    if(box) box.value = "";
    toast("¡Publicado! Gracias por compartir 💛");
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
  // La barra de temas solo se muestra a usuarios con plan.
  if(!isPaid()){
    bar.style.display = "none";
    selectedTopicId = null;
    return;
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
    if(!r.ok) throw new Error(j.error || ("HTTP " + r.status));
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
    .then(j => { if(j && j.comentarios) j.comentarios.forEach(c => seenMsgIds.add(c.id)); })
    .catch(()=>{});
  chatPollTimer = setInterval(async () => {
    try{
      const r = await fetch("/api/community", { headers: authHeaders() });
      if(!r.ok) return;
      const j = await r.json();
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
document.addEventListener("DOMContentLoaded", ()=>{
  // landing CTAs
  $$("[data-go-app]").forEach(b=>b.addEventListener("click", async ()=>{
    afterRestore(await restoreSession());
  }));
  $("#logout-btn").addEventListener("click", ()=>{
    localStorage.removeItem(LS.user);
    localStorage.removeItem("reaviva_token");
    localStorage.removeItem("reaviva_admin");
    localStorage.removeItem("reaviva_paid");
    showView("landing");
  });
  // PayPal return (?paypal=ok|cancel) + sync paid status with backend
  handlePayPalReturn();
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
});
