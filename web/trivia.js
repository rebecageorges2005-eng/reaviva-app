/* Reaviva — Trivia de Sanación 🎮 (pestaña Juegos)
 * Juego de 10 preguntas al azar, 10 puntos por acierto.
 * Corazones = RV: 3 corazones = 30 RV en juego; cada error quita 5 RV
 * (medio corazón). Al terminar, los RV que quedan van al saldo del usuario,
 * solo en la primera partida completa del día.
 * Las respuestas correctas viven solo en el servidor: cada respuesta
 * se valida con POST /api/trivia/answer y el puntaje final se registra
 * con POST /api/trivia/finish. */
"use strict";

/* Estado del juego. */
const T = {
  questions: [], idx: 0, rvLeft: 30, score: 0,
  picked: -1, answers: [], best: 0, streak: 0, rvEarnedToday: 0, loading: false,
};

/* Corazones con mitades: cada corazón vale 10 RV (lleno), 5 RV (mitad:
 * una mitad pálida y la otra en rojo) o 0 RV (vacío). */
function triviaHearts(rv){
  let out = "";
  for(let i = 0; i < 3; i++){
    const v = Math.max(0, Math.min(10, rv - i * 10));
    const w = v >= 10 ? 100 : v >= 5 ? 50 : 0;
    out += '<span class="trivia-heart">♥<span class="fill" style="width:' + w + '%">♥</span></span>';
  }
  return out;
}

function triviaHeartCss(){
  if(document.getElementById("trivia-heart-css")) return;
  const st = document.createElement("style");
  st.id = "trivia-heart-css";
  st.textContent = ".trivia-heart{position:relative;display:inline-block;font-size:1.5rem;line-height:1;color:#e8cfc4;margin-right:2px}.trivia-heart .fill{position:absolute;left:0;top:0;overflow:hidden;color:#e0503c;white-space:nowrap}";
  document.head.appendChild(st);
}

function triviaRoot(){ return document.getElementById("trivia-root"); }

async function renderTrivia(){
  const root = triviaRoot();
  if(!root) return;
  if(T.loading) return;
  // Si hay un juego en curso, no reiniciar la pantalla al reentrar a la pestaña.
  triviaHeartCss();
  if(T.questions.length && T.idx < T.questions.length && T.rvLeft > 0 && root.dataset.phase === "playing") return;
  T.loading = true;
  root.innerHTML = '<p style="text-align:center;color:var(--muted);padding:24px 0">Cargando la trivia…</p>';
  try{
    const r = await fetch("/api/trivia/today", { headers: authHeaders() });
    const d = await r.json();
    if(!r.ok) throw new Error(d.error || "No se pudo cargar la trivia.");
    T.questions = d.questions || [];
    T.best = d.best || 0;
    T.streak = d.streak || 0;
    T.rvEarnedToday = d.rvEarnedToday || 0;
    triviaHome();
  }catch(e){
    root.innerHTML = '<div class="card"><p>😔 ' + esc(e.message) + '</p><button class="btn btn-primary" onclick="renderTrivia()">Reintentar</button></div>';
  }finally{ T.loading = false; }
}

/* Pantalla inicial: presentación + mejor puntaje + racha. */
function triviaHome(){
  const root = triviaRoot();
  root.dataset.phase = "home";
  root.innerHTML =
    '<div class="card" style="text-align:center">' +
      '<div class="icon">🎮</div>' +
      '<h3>Trivia de Sanación</h3>' +
      '<p style="color:var(--muted)">10 preguntas sobre límites, amor propio y sanación. Empiezas con 3 corazones = <b>30 RV</b>. Cada error te quita <b>5 RV</b> (medio corazón) y lo que te quede al terminar va a tu saldo.</p>' +
      (T.rvEarnedToday > 0
        ? '<p style="margin:12px 0">🎉 Hoy ya ganaste <b>' + T.rvEarnedToday + ' RV</b> — puedes seguir jugando por puntos y racha.</p>'
        : '<p style="margin:12px 0">💎 El premio se gana en la primera partida completa del día.</p>') +
      '<p style="margin:12px 0">⭐ Mejor puntaje: <b>' + T.best + '</b> &nbsp;·&nbsp; 🔥 Racha: <b>' + T.streak + (T.streak === 1 ? ' día' : ' días') + '</b></p>' +
      '<button class="btn btn-primary" onclick="triviaStart()">▶ Jugar</button>' +
    '</div>';
}

function triviaStart(){
  T.idx = 0; T.rvLeft = 30; T.score = 0; T.picked = -1; T.answers = [];
  triviaQuestion();
}

/* Una pregunta: corazones, puntaje, opciones y confirmación. */
function triviaQuestion(){
  const root = triviaRoot();
  const q = T.questions[T.idx];
  if(!q){ triviaFinish(); return; }
  root.dataset.phase = "playing";
  const hearts = triviaHearts(T.rvLeft);
  let opts = "";
  q.options.forEach(function(o, i){
    opts += '<button class="btn btn-ghost trivia-opt" data-i="' + i + '" style="display:block;width:100%;text-align:left;margin:8px 0" onclick="triviaPick(' + i + ')">' + esc(o) + '</button>';
  });
  root.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
      '<span>' + hearts + '</span>' +
      '<span style="background:var(--rose);padding:6px 14px;border-radius:999px;font-weight:700">💎 ' + T.rvLeft + ' RV</span>' +
      '<span style="background:var(--rose);padding:6px 14px;border-radius:999px;font-weight:700">✨ ' + T.score + '</span>' +
    '</div>' +
    '<p style="text-align:center;color:var(--muted)">Pregunta ' + (T.idx + 1) + ' de ' + T.questions.length + '</p>' +
    '<div class="card"><h3 style="text-align:center">' + esc(q.q) + '</h3></div>' +
    '<div id="trivia-opts">' + opts + '</div>' +
    '<div id="trivia-feedback"></div>' +
    '<button id="trivia-confirm" class="btn btn-primary" style="width:100%;margin-top:8px" disabled onclick="triviaConfirm()">Confirmar respuesta</button>';
}

function triviaPick(i){
  T.picked = i;
  document.querySelectorAll(".trivia-opt").forEach(function(b){
    const on = Number(b.dataset.i) === i;
    b.style.borderColor = on ? "var(--terra-dark)" : "";
    b.style.background = on ? "var(--rose)" : "";
    b.style.fontWeight = on ? "700" : "";
  });
  const c = document.getElementById("trivia-confirm");
  if(c) c.disabled = false;
}

/* Valida la respuesta en el servidor y muestra la explicación. */
async function triviaConfirm(){
  const q = T.questions[T.idx];
  if(!q || T.picked < 0) return;
  const choice = T.picked;
  const btn = document.getElementById("trivia-confirm");
  if(btn) btn.disabled = true;
  document.querySelectorAll(".trivia-opt").forEach(function(b){ b.disabled = true; });
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
    document.querySelectorAll(".trivia-opt").forEach(function(b){ b.disabled = false; });
    return;
  }
  T.answers.push({ id: q.id, choice: choice });
  if(d.correct) T.score += 10; else T.rvLeft = Math.max(0, T.rvLeft - 5);
  // Colorear opciones: verde la correcta, rojo la elegida si falló.
  document.querySelectorAll(".trivia-opt").forEach(function(b){
    const i = Number(b.dataset.i);
    if(i === d.answer){ b.style.background = "#d9ead3"; b.style.borderColor = "#5a9a5a"; b.style.fontWeight = "700"; }
    else if(i === choice){ b.style.background = "#f4cccc"; b.style.borderColor = "#c0392b"; }
  });
  const last = (T.idx + 1 >= T.questions.length);
  const dead = T.rvLeft <= 0;
  const fb = document.getElementById("trivia-feedback");
  fb.innerHTML =
    '<div class="card" style="margin-top:12px;background:var(--cream)">' +
      '<p><b>' + (d.correct ? "✅ ¡Correcto!" : "💡 Casi…") + '</b></p>' +
      '<p style="color:var(--muted)">' + esc(d.why) + '</p>' +
      '<button class="btn btn-primary" style="width:100%" onclick="triviaNext(' + (last || dead) + ')">' + (last || dead ? "Ver mi resultado" : "Siguiente") + '</button>' +
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
  root.innerHTML = '<p style="text-align:center;color:var(--muted);padding:24px 0">Guardando tu resultado…</p>';
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
  if(d.rvEarned > 0){ T.rvEarnedToday = (T.rvEarnedToday || 0) + d.rvEarned; try{ if(typeof loadRVBalance === "function") loadRVBalance().catch(function(){}); }catch(e){} }
  const byId = {};
  T.questions.forEach(function(q){ byId[q.id] = q; });
  let review = "";
  (d.results || []).forEach(function(res){
    const q = byId[res.id];
    if(!q) return;
    const mine = (T.answers.find(function(a){ return a.id === res.id; }) || {}).choice;
    review += '<div class="card" style="text-align:left;margin:10px 0">' +
      '<p><b>' + (res.correct ? "✅" : "❌") + ' ' + esc(q.q) + '</b></p>' +
      (res.correct ? "" : '<p style="color:var(--muted)">Tu respuesta: ' + esc(q.options[mine] || "—") + '</p>') +
      '<p style="color:var(--muted)">Correcta: ' + esc(q.options[res.answer]) + ' — ' + esc(res.why) + '</p></div>';
  });
  const msg = d.correct === d.total && d.total > 0 ? "🏆 ¡Perfecto! Lo sabes todo de sanar."
    : d.correct >= 7 ? "🌟 ¡Muy bien! Vas sanando y se nota."
    : d.correct >= 4 ? "💛 Buen intento. Cada pregunta te acerca más."
    : "🌱 Cada día se aprende algo nuevo. ¡Inténtalo de nuevo!";
  root.innerHTML =
    '<div class="card" style="text-align:center">' +
      '<div class="icon">🎮</div><h3>' + msg + '</h3>' +
      '<p style="font-size:2rem;margin:8px 0">✨ <b>' + d.score + '</b> puntos</p>' +
      (d.rvEarned > 0
        ? '<p style="font-size:1.3rem;margin:8px 0">💎 <b>+' + d.rvEarned + ' RV</b> a tu saldo</p>'
        : '<p style="color:var(--muted)">Sin RV esta vez — el premio es una vez al día.</p>') +
      '<p style="color:var(--muted)">' + d.correct + ' de ' + d.total + ' correctas · Mejor: ' + d.best + ' · 🔥 Racha: ' + d.streak + (d.streak === 1 ? ' día' : ' días') + '</p>' +
      '<button class="btn btn-primary" onclick="triviaAgain()">🔄 Jugar de nuevo</button>' +
    '</div>' + review;
}

async function triviaAgain(){
  T.questions = []; T.idx = 0;
  const root = triviaRoot();
  if(root) root.dataset.phase = "";
  await renderTrivia();
  if(T.questions.length) triviaStart();
}
