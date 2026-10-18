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
function doLogin(ev){
  ev.preventDefault();
  const email = $("#auth-email").value.trim();
  const name  = $("#auth-name").value.trim() || email.split("@")[0];
  if(!email || !email.includes("@")){ toast("Escribe un correo válido"); return; }
  store.set(LS.user, {email, name});
  if(!store.get(LS.start, null)) store.set(LS.start, todayKey());
  enterApp();
  toast("¡Bienvenido/a, " + name + "! 💛");
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

/* ---------- admin login (code-based, discrete link on login screen) ---------- */
function toggleAdminLogin(ev){
  ev.preventDefault();
  const box = $("#admin-login-box");
  box.style.display = box.style.display === "none" ? "" : "none";
}
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
  ["landing","auth","app"].forEach(v => $("#view-"+v).style.display = v===name ? "" : "none");
  if(name==="landing") $("#view-landing").style.display = "";
  if(name==="auth")    $("#view-auth").style.display = "";
  if(name==="app")     $("#view-app").style.display = "";
  window.scrollTo(0,0);
}
function enterApp(){
  showView("app");
  const u = currentUser();
  $("#user-chip").textContent = "Hola, " + esc(u.name);
  switchTab("hoy");
}
function switchTab(tab){
  $$(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab===tab));
  $$(".panel").forEach(p => p.classList.toggle("active", p.id==="panel-"+tab));
  if(tab==="hoy") renderHoy();
  if(tab==="programa") renderPrograma();
  if(tab==="diario") renderDiario();
  if(tab==="progreso") renderProgreso();
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
    <div class="block audio-block"><h4>🎧 Escuchar</h4><audio controls preload="none" src="audio/dia-${p.day}.mp3" style="width:100%"></audio></div>
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
  $$("[data-go-app]").forEach(b=>b.addEventListener("click", ()=>{
    if(currentUser()) enterApp(); else showView("auth");
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
  // deep-link: #app
  if(location.hash === "#app" && currentUser()) enterApp();
});
