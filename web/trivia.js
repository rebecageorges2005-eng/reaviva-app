/* Reaviva — Trivia de Sanación 🎮 (pestaña Juegos)
 * Juego de 10 preguntas al azar, 10 puntos por acierto.
 * Corazones = RV: 3 corazones = 30 RV en juego; cada error quita 5 RV
 * (medio corazón). Al terminar una partida completa con al menos medio
 * corazón, lo que queda va al saldo (una vez por ciclo). En 0 corazones
 * no hay regalía: para jugar hay que recargar con 30 RV (automático al
 * intentar jugar teniendo saldo) o esperar la renovación gratis de 48h
 * (solo si el saldo es >= 30 RV); si no, hay que comprar RV.
 * Las respuestas correctas viven solo en el servidor: cada respuesta
 * se valida con POST /api/trivia/answer y el puntaje final se registra
 * con POST /api/trivia/finish.
 * Diseño: boceto aprobado por Georges (12 nov 2026) — cabecera terracota,
 * corazones, píldora de puntos, tarjeta de pregunta, opciones en píldoras
 * con círculo y botón grande "Confirmar respuesta". */
"use strict";

/* Estado del juego. */
const T = {
  questions: [], idx: 0, rvLeft: 30, rvLeftToday: 30, score: 0,
  picked: -1, answers: [], best: 0, streak: 0, rvEarnedToday: 0,
  rvBalance: 0, renewsAt: null, loading: false,
};

/* Fecha legible para la renovación de corazones. */
function triviaRenewText(){
  if(!T.renewsAt) return "";
  const d = new Date(T.renewsAt);
  if(isNaN(d.getTime())) return "";
  try{ return d.toLocaleString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); }
  catch(e){ return d.toLocaleString(); }
}

/* ---------- Diseño (CSS propio del juego, inyectado una sola vez) ---------- */
function triviaCss(){
  if(document.getElementById("trivia-css")) return;
  const st = document.createElement("style");
  st.id = "trivia-css";
  st.textContent = [
    ".tq{font-family:var(--font)}",
    /* Cabecera terracota con título y racha */
    ".tq-head{background:linear-gradient(135deg,#d99a76,#c4704f);border-radius:22px 22px 0 0;padding:18px 18px 26px;color:#3d2317;box-shadow:var(--shadow)}",
    ".tq-head-row{display:flex;align-items:center;gap:12px}",
    ".tq-back{background:none;border:none;font-size:1.5rem;color:#3d2317;cursor:pointer;padding:0 4px;line-height:1}",
    ".tq-fwd{background:none;border:none;font-size:1.7rem;color:#3d2317;cursor:pointer;padding:0 4px;line-height:1}",
    ".tq-title{font-size:1.45rem;font-weight:800;flex:1}",
    ".tq-streak{background:#fffaf3;border-radius:999px;padding:4px 12px;font-weight:800;box-shadow:0 4px 12px rgba(74,55,40,.15)}",
    /* Cuerpo crema que se solapa con la cabecera */
    ".tq-body{background:#fffaf3;border-radius:22px;margin-top:-18px;padding:18px 16px 20px;box-shadow:var(--shadow)}",
    /* Fila corazones + píldora RV */
    ".tq-top{display:flex;justify-content:space-between;align-items:center}",
    ".tq-hearts{font-size:1.35rem}",
    ".tq-heart{position:relative;display:inline-block;line-height:1;color:#ecd8cb;margin-right:3px}",
    ".tq-heart .fill{position:absolute;left:0;top:0;overflow:hidden;color:#d94f3d;white-space:nowrap}",
    ".tq-pill{background:linear-gradient(135deg,#d99a76,#c4704f);color:#fff;border-radius:999px;padding:7px 16px;font-weight:800;box-shadow:0 6px 14px rgba(196,112,79,.35)}",
    ".tq-progress{text-align:center;color:#b98a6d;font-weight:600;margin:14px 0 10px}",
    /* Tarjeta de la pregunta */
    ".tq-qcard{background:#fffdf9;border:2px solid #f0dcc9;border-radius:22px;padding:26px 18px;text-align:center;box-shadow:0 6px 16px rgba(74,55,40,.06)}",
    ".tq-q{font-size:1.5rem;font-weight:800;line-height:1.3;color:#3d2317}",
    ".tq-div{width:90px;height:3px;background:#e8b48f;border-radius:99px;margin:16px auto 0}",
    /* Opciones en píldoras con círculo */
    ".tq-opt{display:flex;align-items:center;gap:12px;width:100%;text-align:left;background:#fffdf9;border:2px solid #e8c4a8;border-radius:999px;padding:14px 18px;margin:10px 0;font-size:1.02rem;font-weight:600;color:#3d2317;cursor:pointer;font-family:var(--font)}",
    ".tq-opt .radio{flex:none;width:26px;height:26px;border:2px solid #d99a76;border-radius:50%;background:transparent}",
    ".tq-opt.sel{background:linear-gradient(135deg,#dd9a76,#c4704f);border-color:#a5583a;color:#fff}",
    ".tq-opt.sel .radio{border-color:#fff;background:#fff;box-shadow:inset 0 0 0 5px #c4704f}",
    ".tq-opt:disabled{cursor:default;opacity:1}",
    ".tq-opt.ok{background:#d9ead3!important;border-color:#5a8f6a!important;color:#2e5238!important}",
    ".tq-opt.ok .radio{border-color:#5a8f6a!important;background:#5a8f6a!important;box-shadow:inset 0 0 0 5px #d9ead3!important}",
    ".tq-opt.bad{background:#f4cccc!important;border-color:#c0392b!important;color:#7a1f16!important}",
    ".tq-opt.bad .radio{border-color:#c0392b!important;background:#c0392b!important;box-shadow:inset 0 0 0 5px #f4cccc!important}",
    /* Botón grande */
    ".tq-btn{display:block;width:100%;background:linear-gradient(135deg,#d99a76,#c4704f);color:#fff;border:none;border-radius:18px;padding:16px;font-size:1.15rem;font-weight:800;cursor:pointer;box-shadow:0 10px 22px rgba(196,112,79,.4);font-family:var(--font);margin-top:14px}",
    ".tq-btn:disabled{opacity:.45;cursor:default;box-shadow:none}",
    /* Explicación */
    ".tq-why{background:#fdf3e8;border:2px solid #f0dcc9;border-radius:18px;padding:16px;margin-top:14px}",
    ".tq-why p{color:var(--cocoa-soft);margin-top:6px}",
    /* Pantallas inicio / resultado */
    ".tq-center{text-align:center}",
    ".tq-big{font-size:2rem;font-weight:800;margin:8px 0}",
    ".tq-muted{color:var(--cocoa-soft)}",
    ".tq-stats{display:flex;gap:10px;justify-content:center;margin:14px 0;flex-wrap:wrap}",
    ".tq-stat{background:#fdf3e8;border:2px solid #f0dcc9;border-radius:14px;padding:10px 16px;font-weight:700}",
    ".tq-review{background:#fffdf9;border:2px solid #f0dcc9;border-radius:18px;padding:14px 16px;margin:10px 0;text-align:left}",
    ".tq-review p{color:var(--cocoa-soft);margin-top:4px}",
  ].join("\n");
  document.head.appendChild(st);
}

/* Corazones con mitades: cada corazón vale 10 RV (lleno), 5 RV (mitad:
 * una mitad pálida y la otra en rojo) o 0 RV (vacío). */
function triviaHearts(rv){
  let out = "";
  for(let i = 0; i < 3; i++){
    const v = Math.max(0, Math.min(10, rv - i * 10));
    const w = v >= 10 ? 100 : v >= 5 ? 50 : 0;
    out += '<span class="tq-heart">♥<span class="fill" style="width:' + w + '%">♥</span></span>';
  }
  return out;
}

function triviaRoot(){ return document.getElementById("trivia-root"); }

/* Cabecera: al inicio del juego la flecha va a la DERECHA y apunta
 * adelante (→ empieza el juego); al estar jugando, la flecha va a la
 * IZQUIERDA y vuelve atrás (← al inicio del juego). */
function triviaHead(mode){
  if(mode === "home"){
    return '<div class="tq-head"><div class="tq-head-row">' +
      '<div class="tq-title">Trivia de Sanación</div>' +
      '<span class="tq-streak">🔥 ' + T.streak + '</span>' +
      '<button class="tq-fwd" onclick="triviaStart()" aria-label="Adelante">→</button>' +
      '</div></div>';
  }
  return '<div class="tq-head"><div class="tq-head-row">' +
    '<button class="tq-back" onclick="triviaHome()" aria-label="Volver">←</button>' +
    '<div class="tq-title">Trivia de Sanación</div>' +
    '<span class="tq-streak">🔥 ' + T.streak + '</span>' +
    '</div></div>';
}

async function renderTrivia(){
  const root = triviaRoot();
  if(!root) return;
  triviaCss();
  if(T.loading) return;
  // Si hay un juego en curso, no reiniciar la pantalla al reentrar a la pestaña.
  if(T.questions.length && T.idx < T.questions.length && T.rvLeft > 0 && root.dataset.phase === "playing") return;
  T.loading = true;
  root.innerHTML = '<div class="tq">' + triviaHead() + '<div class="tq-body"><p class="tq-center tq-muted" style="padding:24px 0">Cargando la trivia…</p></div></div>';
  try{
    const r = await fetch("/api/trivia/today", { headers: authHeaders() });
    const d = await r.json();
    if(!r.ok) throw new Error(d.error || "No se pudo cargar la trivia.");
    T.questions = d.questions || [];
    T.best = d.best || 0;
    T.streak = d.streak || 0;
    T.rvEarnedToday = d.rvEarnedToday || 0;
    T.rvLeftToday = (typeof d.rvLeftToday === "number") ? d.rvLeftToday : 30;
    T.rvBalance = d.rvBalance || 0;
    T.renewsAt = d.renewsAt || null;
    triviaHome();
  }catch(e){
    root.innerHTML = '<div class="tq">' + triviaHead() + '<div class="tq-body tq-center"><p>😔 ' + esc(e.message) + '</p><button class="tq-btn" onclick="renderTrivia()">Reintentar</button></div></div>';
  }finally{ T.loading = false; }
}

/* Pantalla inicial: presentación + mejor puntaje + racha. */
function triviaHome(){
  const root = triviaRoot();
  if(!root) return;
  triviaCss();
  root.dataset.phase = "home";
  const noHearts = T.rvLeftToday <= 0;
  const canRecharge = T.rvBalance >= 30;
  let action = "";
  if(!noHearts){
    action = '<button class="tq-btn" onclick="triviaStart()">▶ Jugar</button>';
  }else if(canRecharge){
    action = '<p style="margin:12px 0">💔 Tus corazones están en 0. Al jugar se recargan automáticamente con <b>30 RV</b> de tu saldo.</p>' +
      (T.renewsAt ? '<p class="tq-muted">O espera gratis hasta el ' + esc(triviaRenewText()) + '.</p>' : '') +
      '<button class="tq-btn" onclick="triviaStart()">▶ Jugar (recarga 30 RV)</button>';
  }else{
    action = '<p style="margin:12px 0">💔 Tus corazones están en 0 y no tienes suficientes RV (mínimo 30 RV).</p>' +
      '<p class="tq-muted">Recarga tu cuenta desde <b>$12 USD por 120 RV</b> para seguir jugando.</p>' +
      '<button class="tq-btn" onclick="triviaBuyRV()">Recargar RV 💰</button>';
  }
  root.innerHTML = '<div class="tq">' + triviaHead("home") +
    '<div class="tq-body tq-center">' +
      '<div class="tq-hearts" style="font-size:1.8rem">' + triviaHearts(T.rvLeftToday) + '</div>' +
      '<p class="tq-muted" style="margin-top:10px">10 preguntas sobre límites, amor propio y sanación. Tienes 3 corazones = <b>30 RV</b>. Cada error te quita <b>5 RV</b> (medio corazón). Al terminar con al menos medio corazón, lo que queda va a tu saldo. Los corazones perdidos <b>no se recuperan</b> al volver a jugar.</p>' +
      '<p style="margin:12px 0"><b>⚠️ Si te quedas con 0 corazones, no se aplicará la regalía.</b></p>' +
      (T.rvEarnedToday > 0 && !noHearts
        ? '<p style="margin:12px 0">🎉 Ya ganaste <b>' + T.rvEarnedToday + ' RV</b> en este ciclo — puedes seguir jugando por puntos y racha.</p>'
        : '') +
      '<div class="tq-stats"><span class="tq-stat">⭐ Mejor: ' + T.best + '</span><span class="tq-stat">🔥 Racha: ' + T.streak + (T.streak === 1 ? ' día' : ' días') + '</span><span class="tq-stat">💎 Saldo: ' + T.rvBalance + ' RV</span></div>' +
      action +
    '</div></div>';
}

/* Abrir la compra de RV (packs desde $12 USD por 120 RV). */
function triviaBuyRV(){
  try{ if(typeof openRVModal === "function"){ openRVModal(); return; } }catch(e){}
  try{ switchTab("perfil"); }catch(e){}
  toast("Recarga RV desde tu perfil 💰");
}

async function triviaStart(){
  // Sin corazones: recarga automática con 30 RV al intentar jugar.
  if(T.rvLeftToday <= 0){
    try{
      const r = await fetch("/api/trivia/recharge", { method: "POST", headers: authHeaders() });
      const d = await r.json();
      if(!r.ok || !d.hearts){
        T.rvBalance = (d && d.rvBalance) || T.rvBalance;
        triviaHome();
        toast("😔 " + ((d && d.error) || "No se pudo recargar."));
        return;
      }
      T.rvLeftToday = d.hearts;
      T.rvBalance = d.rvBalance || 0;
      T.renewsAt = null;
      toast(d.free ? "❤️ Tus corazones volvieron gratis" : "❤️ Corazones recargados 💎 −30 RV");
      try{ if(typeof loadRVBalance === "function") loadRVBalance().catch(function(){}); }catch(e){}
    }catch(e){
      toast("😔 No se pudo recargar. Inténtalo de nuevo.");
      return;
    }
  }
  // La partida empieza con los corazones que quedan del ciclo (los perdidos
  // en partidas anteriores ya no vuelven).
  T.idx = 0; T.rvLeft = T.rvLeftToday; T.score = 0; T.picked = -1; T.answers = [];
  triviaQuestion();
}

/* Una pregunta: corazones, RV, opciones y confirmación. */
function triviaQuestion(){
  const root = triviaRoot();
  const q = T.questions[T.idx];
  if(!q){ triviaFinish(); return; }
  root.dataset.phase = "playing";
  let opts = "";
  q.options.forEach(function(o, i){
    opts += '<button class="tq-opt" data-i="' + i + '" onclick="triviaPick(' + i + ')"><span class="radio"></span><span>' + esc(o) + '</span></button>';
  });
  root.innerHTML = '<div class="tq">' + triviaHead() +
    '<div class="tq-body">' +
      '<div class="tq-top"><span class="tq-hearts">' + triviaHearts(T.rvLeft) + '</span>' +
      '<span class="tq-pill">💎 ' + T.rvLeft + ' RV</span></div>' +
      '<p class="tq-progress">Pregunta ' + (T.idx + 1) + ' de ' + T.questions.length + ' &nbsp;·&nbsp; ✨ ' + T.score + ' puntos</p>' +
      '<div class="tq-qcard"><div class="tq-q">' + esc(q.q) + '</div><div class="tq-div"></div></div>' +
      '<div id="trivia-opts">' + opts + '</div>' +
      '<div id="trivia-feedback"></div>' +
      '<button id="trivia-confirm" class="tq-btn" disabled onclick="triviaConfirm()">Confirmar respuesta</button>' +
    '</div></div>';
}

function triviaPick(i){
  T.picked = i;
  document.querySelectorAll(".tq-opt").forEach(function(b){
    b.classList.toggle("sel", Number(b.dataset.i) === i);
  });
  const c = document.getElementById("trivia-confirm");
  if(c) c.disabled = false;
}

/* Sonidos del juego (Web Audio, sin archivos): al acertar suena un
 * sonidito alegre ascendente; al fallar suena UNA nota grave FUERTE
 * con timbre de piano (fundamental + armónicos con caída rápida).
 * Nunca rompe el juego: cualquier error de audio se ignora. */
let triviaAC = null;
function triviaSound(ok){
  try{
    const AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return;
    if(!triviaAC) triviaAC = new AC();
    if(triviaAC.state === "suspended") triviaAC.resume();
    const t0 = triviaAC.currentTime;
    if(!ok){
      // Piano grave: Do3 (130.81 Hz) + armónicos que se apagan rápido.
      const base = 130.81;
      [[1, 0.34, 0.8], [2, 0.15, 0.55], [3, 0.07, 0.4], [4, 0.035, 0.3]].forEach(function(h){
        const o = triviaAC.createOscillator();
        const g = triviaAC.createGain();
        o.type = "sine";
        o.frequency.value = base * h[0];
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(h[1], t0 + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + h[2]);
        o.connect(g); g.connect(triviaAC.destination);
        o.start(t0); o.stop(t0 + h[2] + 0.05);
      });
      return;
    }
    [[659.25, 0, 0.12], [783.99, 0.09, 0.12], [1046.5, 0.18, 0.22]].forEach(function(n){
      const o = triviaAC.createOscillator();
      const g = triviaAC.createGain();
      o.type = "sine";
      o.frequency.value = n[0];
      g.gain.setValueAtTime(0.0001, t0 + n[1]);
      g.gain.exponentialRampToValueAtTime(0.18, t0 + n[1] + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + n[1] + n[2]);
      o.connect(g); g.connect(triviaAC.destination);
      o.start(t0 + n[1]); o.stop(t0 + n[1] + n[2] + 0.05);
    });
  }catch(e){ /* Sin sonido: el juego sigue igual. */ }
}

/* Valida la respuesta en el servidor y muestra la explicación. */
async function triviaConfirm(){
  const q = T.questions[T.idx];
  if(!q || T.picked < 0) return;
  const choice = T.picked;
  const btn = document.getElementById("trivia-confirm");
  if(btn) btn.disabled = true;
  document.querySelectorAll(".tq-opt").forEach(function(b){ b.disabled = true; });
  let d;
  try{
    const r = await fetch("/api/trivia/answer", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, authHeaders()),
      body: JSON.stringify({ id: q.id, choice: choice }),
    });
    d = await r.json();
    if(!r.ok) throw new Error(d.error || "No se pudo validar la respuesta.");
  }catch(e){
    toast("😔 " + e.message);
    if(btn) btn.disabled = false;
    document.querySelectorAll(".tq-opt").forEach(function(b){ b.disabled = false; });
    return;
  }
  T.answers.push({ id: q.id, choice: choice });
  triviaSound(!!d.correct);
  if(d.correct) T.score += 10; else T.rvLeft = Math.max(0, T.rvLeft - 5);
  // Colorear opciones: verde la correcta, rojo la elegida si falló.
  document.querySelectorAll(".tq-opt").forEach(function(b){
    const i = Number(b.dataset.i);
    if(i === d.answer) b.classList.add("ok");
    else if(i === choice) b.classList.add("bad");
  });
  // Actualizar corazones y RV tras el error.
  const heartsEl = document.querySelector(".tq-hearts");
  if(heartsEl) heartsEl.innerHTML = triviaHearts(T.rvLeft);
  const pillEl = document.querySelector(".tq-pill");
  if(pillEl) pillEl.textContent = "💎 " + T.rvLeft + " RV";
  const last = (T.idx + 1 >= T.questions.length);
  const dead = T.rvLeft <= 0;
  const fb = document.getElementById("trivia-feedback");
  fb.innerHTML =
    '<div class="tq-why">' +
      '<p style="margin-top:0;color:#3d2317"><b>' + (d.correct ? "✅ ¡Correcto!" : "💡 Casi…") + '</b></p>' +
      '<p>' + esc(d.why) + '</p>' +
      '<button class="tq-btn" onclick="triviaNext(' + (last || dead) + ')">' + (last || dead ? "Ver mi resultado" : "Siguiente") + '</button>' +
    '</div>';
  if(btn) btn.style.display = "none";
}

function triviaNext(done){
  T.picked = -1;
  if(done){ triviaFinish(); return; }
  T.idx++;
  triviaQuestion();
}

/* Registra el juego y muestra el resultado + repaso. */
async function triviaFinish(){
  const root = triviaRoot();
  root.dataset.phase = "done";
  root.innerHTML = '<div class="tq">' + triviaHead() + '<div class="tq-body"><p class="tq-center tq-muted" style="padding:24px 0">Guardando tu resultado…</p></div></div>';
  let d = { score: T.score, correct: 0, total: T.answers.length, results: [], best: T.best, streak: T.streak, rvEarned: 0 };
  try{
    const r = await fetch("/api/trivia/finish", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, authHeaders()),
      body: JSON.stringify({ answers: T.answers }),
    });
    const j = await r.json();
    if(r.ok) d = j;
  }catch(e){ /* Sin conexión: mostrar el puntaje local. */ }
  T.best = d.best || T.best; T.streak = d.streak || T.streak;
  if(typeof d.rvLeftToday === "number") T.rvLeftToday = d.rvLeftToday;
  if(typeof d.rvBalance === "number") T.rvBalance = d.rvBalance;
  T.renewsAt = d.renewsAt || null;
  if(d.rvEarned > 0){ T.rvEarnedToday = (T.rvEarnedToday || 0) + d.rvEarned; try{ if(typeof loadRVBalance === "function") loadRVBalance().catch(function(){}); }catch(e){} }
  const byId = {};
  T.questions.forEach(function(q){ byId[q.id] = q; });
  let review = "";
  (d.results || []).forEach(function(res){
    const q = byId[res.id];
    if(!q) return;
    const mine = (T.answers.find(function(a){ return a.id === res.id; }) || {}).choice;
    review += '<div class="tq-review">' +
      '<p style="margin-top:0;color:#3d2317"><b>' + (res.correct ? "✅" : "❌") + ' ' + esc(q.q) + '</b></p>' +
      (res.correct ? "" : '<p>Tu respuesta: ' + esc(q.options[mine] || "—") + '</p>') +
      '<p>Correcta: ' + esc(q.options[res.answer]) + ' — ' + esc(res.why) + '</p></div>';
  });
  const msg = d.correct === d.total && d.total > 0 ? "🏆 ¡Perfecto! Lo sabes todo de sanar."
    : d.correct >= 7 ? "🌟 ¡Muy bien! Vas sanando y se nota."
    : d.correct >= 4 ? "💛 Buen intento. Cada pregunta te acerca más."
    : "🌱 Cada día se aprende algo nuevo. ¡Inténtalo de nuevo!";
  root.innerHTML = '<div class="tq">' + triviaHead() +
    '<div class="tq-body tq-center">' +
      '<h3>' + msg + '</h3>' +
      '<p class="tq-big">✨ ' + d.score + ' puntos</p>' +
      (d.rvEarned > 0
        ? '<p style="font-size:1.3rem;margin:8px 0">💎 <b>+' + d.rvEarned + ' RV</b> a tu saldo</p>'
        : (T.rvLeftToday <= 0
          ? '<p class="tq-muted">💔 Tus corazones quedaron en 0 — sin regalía. Recarga con 30 RV o espera 48 horas.</p>'
          : '<p class="tq-muted">Sin RV esta vez — el premio es una vez por ciclo.</p>')) +
      '<p class="tq-muted">' + d.correct + ' de ' + d.total + ' correctas · Mejor: ' + d.best + ' · 🔥 Racha: ' + d.streak + (d.streak === 1 ? ' día' : ' días') + '</p>' +
      '<button class="tq-btn" onclick="triviaAgain()">🔄 Jugar de nuevo</button>' +
    '</div>' + review + '</div>';
}

async function triviaAgain(){
  T.questions = []; T.idx = 0;
  const root = triviaRoot();
  if(root) root.dataset.phase = "";
  await renderTrivia();
  // Sin corazones, quedarse en el inicio (ahí está la recarga / compra).
  if(T.questions.length && T.rvLeftToday > 0) triviaStart();
}
