"use strict";

/* ================================================================
 * CELEBRACIONES AUTOMÁTICAS 🎂🌱
 * - Cumpleaños: un correo el día del cumpleaños del usuario.
 * - Semestral: un correo cada 6 meses desde su registro.
 * 30 plantillas reconfortantes para cada ocasión (rotan por
 * usuario y período, para que nunca reciba el mismo dos veces).
 * Todo el contenido es cálido y 100% secular, en la voz de Reaviva:
 * sanación, amor propio y "un paso a la vez".
 * ================================================================ */

const db = require("./db");
const { sendCelebrationEmail } = require("./email");

/* ---------------- 30 mensajes de CUMPLEAÑOS ---------------- */
const CUMPLEANOS = [
  { a: "🎂 Hoy celebramos tu vida, {nombre}", c: [
    "Hoy no es solo un año más: es la prueba viva de todo lo que has atravesado y sigues aquí, de pie. Cada día difícil que superaste te trajo hasta este momento.",
    "Que este nuevo año te trate con la suavidad que mereces. Hoy celébrate: existes, importas y tu historia continúa. Feliz cumpleaños. 💛"] },
  { a: "💛 Un año más de ti, {nombre}", c: [
    "Hoy el calendario marca tu día, y queremos recordarte algo: llegar hasta aquí ya es un logro enorme. No cualquiera camina lo que tú has caminado.",
    "Respira, sonríe y date permiso de empezar este año a tu ritmo, sin prisa y sin culpa. Feliz cumpleaños. 🎂"] },
  { a: "🌅 Tu nuevo comienzo, {nombre}", c: [
    "Cada cumpleaños es una puerta que se abre. Detrás queda lo que dolió; delante, todo lo que todavía puede florecer en tu vida.",
    "Te deseamos un año de paz en el corazón y de pasos firmes. Gracias por permitirnos acompañarte. Feliz cumpleaños. 💛"] },
  { a: "🎈 {nombre}, hoy es tu día", c: [
    "Hoy nadie te pide que seas fuerte. Hoy solo se celebra que estás aquí, que tu corazón sigue latiendo y apostando por ti.",
    "Que recibas abrazos sinceros, palabras bonitas y la certeza de que lo mejor de tu historia aún se está escribiendo. Feliz cumpleaños. 🎂"] },
  { a: "🌻 Feliz cumpleaños, {nombre}", c: [
    "Como un girasol, has buscado la luz incluso en los días nublados. Este año nuevo de vida es tu oportunidad de seguir creciendo hacia ella.",
    "Celebra tus raíces, tus cicatrices y tus ganas de seguir. Todo eso te hace ser quien eres: alguien que vale muchísimo. 💛"] },
  { a: "✨ Lo que viene será mejor, {nombre}", c: [
    "Sabemos que no todos los años son amables. Pero también sabemos que dentro de ti hay una fuerza que ni tú conoces del todo.",
    "Que este cumpleaños marque el inicio de una etapa más ligera, más tuya, más en paz. Te lo mereces desde hace tiempo. Feliz cumpleaños. 🎂"] },
  { a: "🎂 Un deseo para ti, {nombre}", c: [
    "Si hoy pides un deseo al soplar las velas, pide también por ti: por tu calma, por tu corazón tranquilo, por días sin sobresaltos.",
    "Nosotros pedimos que este año te encuentres con la versión más serena y feliz de ti. Feliz cumpleaños, de corazón. 💛"] },
  { a: "🌷 {nombre}, celébrate hoy", c: [
    "A veces celebramos a todos menos a nosotros mismos. Hoy te toca a ti: mira lo lejos que has llegado, incluso con el corazón cansado.",
    "Date hoy el cariño que sueles dar a los demás. Feliz cumpleaños: que este año te abrace como tú abrazas a los que quieres. 🎂"] },
  { a: "💫 Tu historia importa, {nombre}", c: [
    "El día que naciste empezó una historia única, con capítulos duros y otros hermosos. Ninguno sobra: todos te han hecho más humano, más sabio, más tú.",
    "Que el capítulo que hoy comienza sea amable contigo. Feliz cumpleaños, y gracias por seguir escribiendo. 💛"] },
  { a: "🎂 Hoy sumas vida, {nombre}", c: [
    "No sumas años: sumas aprendizajes, risas que volvieron después del llanto y mañanas en las que decidiste levantarte una vez más.",
    "Eso se celebra en grande. Que tu día esté lleno de gente que te quiere bien y de momentos que te hagan sonreír. Feliz cumpleaños. 🎈"] },
  { a: "🌙 Para ti, en tu día, {nombre}", c: [
    "Quizá este cumpleaños llega en medio de un proceso, y está bien. No necesitas tener todo resuelto para merecer un día bonito.",
    "Hoy descansa de las exigencias y recibe este recordatorio: vas a estar bien, un paso a la vez. Feliz cumpleaños. 💛"] },
  { a: "🍰 {nombre}, que sea un año dulce", c: [
    "Después de temporadas amargas, la vida también sabe regalar momentos dulces. Este año puede ser el tuyo para saborearlos sin miedo.",
    "Guarda un pedacito de pastel y otro de esperanza. Feliz cumpleaños: lo dulce también es para ti. 🎂"] },
  { a: "🌈 Después de la tormenta, {nombre}", c: [
    "Has pasado tormentas que pocos conocen. Y aun así, aquí estás, cumpliendo un año más, con el corazón dispuesto a seguir.",
    "Que este año traiga colores nuevos a tus días y calma a tus noches. Feliz cumpleaños, valiente. 💛"] },
  { a: "🎁 El mejor regalo: tú, {nombre}", c: [
    "Para las personas que te quieren, el mejor regalo siempre has sido tú: tu presencia, tu manera de cuidar, tu corazón grande.",
    "Hoy queremos devolvértelo en palabras: gracias por existir. Feliz cumpleaños, que recibas multiplicado todo el amor que das. 🎂"] },
  { a: "🌞 Que tu luz siga, {nombre}", c: [
    "Ni los días oscuros lograron apagar tu luz; solo la hicieron más profunda y más verdadera.",
    "Que este nuevo año la veas brillar en tus proyectos, en tu paz y en tu sonrisa. Feliz cumpleaños. 💛"] },
  { a: "🎂 {nombre}, un año para florecer", c: [
    "Las flores no se apuran y, sin embargo, florecen. Tu proceso también tiene su tiempo, y este año puede sorprenderte.",
    "Confía en tus raíces y abre los brazos a lo que viene. Feliz cumpleaños: tu temporada bonita está llegando. 🌷"] },
  { a: "💛 Abraza tu nuevo año, {nombre}", c: [
    "Un cumpleaños es también un abrazo del tiempo: te dice que sigues aquí, que importas y que tu camino sigue abierto.",
    "Recíbelo con el corazón disponible para lo bueno. Te deseamos salud, calma y personas que sumen. Feliz cumpleaños. 🎂"] },
  { a: "⭐ Eres más fuerte de lo que crees, {nombre}", c: [
    "Si el año pasado te dejó lecciones, este puede dejarte recompensas. Mereces ver el fruto de todo lo que has resistido.",
    "Hoy brindamos por ti y por todo lo que construirás. Feliz cumpleaños, con admiración sincera. 🎈"] },
  { a: "🎂 Hoy, permiso para ser feliz, {nombre}", c: [
    "A veces nos cuesta permitirnos la alegría después de tiempos duros. Hoy tienes permiso total: ríe, celebra, disfruta sin culpa.",
    "La vida también se honra celebrando. Feliz cumpleaños: que hoy te sobre cariño y te falten preocupaciones. 💛"] },
  { a: "🌺 {nombre}, tu corazón merece fiesta", c: [
    "Ese corazón que ha dado tanto, que ha esperado tanto y que ha sanado tanto, hoy merece música, abrazos y pastel.",
    "Que este año le lleguen noticias bonitas y personas que sepan cuidarlo. Feliz cumpleaños. 🎂"] },
  { a: "🕊️ Un año de paz para ti, {nombre}", c: [
    "Si este año pudiéramos regalarte una sola cosa, sería paz: de esa que se siente en el pecho cuando por fin todo se aquieta.",
    "Que la encuentres cada día un poco más. Feliz cumpleaños, y gracias por seguir en tu proceso. 💛"] },
  { a: "🎂 {nombre}, mira lo lejos que llegaste", c: [
    "Haz una pausa hoy y mira hacia atrás con cariño: la persona de hace un año estaría orgullosa de verte aquí, intentándolo todavía.",
    "Esa constancia merece celebración. Feliz cumpleaños: lo que viene se construye con esa misma fuerza tuya. 🌅"] },
  { a: "💐 Feliz vida, {nombre}", c: [
    "Más que feliz cumpleaños, hoy queremos decirte feliz vida: feliz por tus días tranquilos, por tus pequeños logros, por tu manera de seguir.",
    "Que nunca te falten motivos para sonreír ni personas que celebren contigo. Hoy celebramos nosotros también: celebrarte a ti. 🎂"] },
  { a: "🌟 {nombre}, tu mejor etapa empieza", c: [
    "Dicen que la vida recompensa a quienes no se rinden. Tú no te rendiste: este año puede ser el comienzo de tu mejor etapa.",
    "Recíbelo con esperanza y con los brazos abiertos. Feliz cumpleaños, de parte de todo Reaviva. 💛"] },
  { a: "🎂 Un brindis por ti, {nombre}", c: [
    "Hoy brindamos por tus sueños que siguen vivos, por tu corazón que sigue creyendo y por tu sonrisa que vuelve, poco a poco, pero vuelve.",
    "Que este año te acerque a todo eso que mereces. Feliz cumpleaños. 🥂💛"] },
  { a: "🦋 {nombre}, sigue transformándote", c: [
    "La mariposa no discute con su proceso: confía y se transforma. Tú estás en eso, y este cumpleaños es parte de tu vuelo.",
    "Que este año despliegues alas con calma y sin miedo. Feliz cumpleaños. 🎂"] },
  { a: "🎈 Que te sobre amor, {nombre}", c: [
    "Nuestro deseo para ti es simple: que este año te sobre amor del bueno, del que empieza por ti y se comparte sin doler.",
    "Feliz cumpleaños. Mereces relaciones que sumen, días que abracen y un corazón en paz. 💛"] },
  { a: "🌄 {nombre}, amanece un año nuevo", c: [
    "Cada cumpleaños amanece distinto: trae aire fresco, páginas limpias y la oportunidad de elegirte otra vez.",
    "Elige tu paz, elige tu ritmo, elige tu alegría. Feliz cumpleaños: este amanecer es tuyo. 🎂"] },
  { a: "💛 {nombre}, gracias por seguir aquí", c: [
    "Hoy celebramos tu vida y también tu decisión de seguir cuidándola, incluso cuando costaba. Eso habla de un corazón enorme.",
    "Que este año te devuelva en calma todo lo que has entregado en amor. Feliz cumpleaños. 🎈"] },
  { a: "🎂 Tu día, tus reglas, {nombre}", c: [
    "Hoy el día es tuyo: para descansar, para reír, para comer tu pastel favorito y para recordar que tu vida vale celebrarse.",
    "Nosotros nos sumamos a tu fiesta con este mensaje: feliz cumpleaños, y que venga un año lleno de luz para ti. 💛"] },
];

/* ---------------- 30 mensajes SEMESTRALES ---------------- */
const SEMESTRE = [
  { a: "🌱 {meses} meses eligiéndote, {nombre}", c: [
    "Hoy cumples {meses} meses en Reaviva, y eso significa algo grande: llevas {meses} meses eligiéndote, cuidándote y apostando por tu paz.",
    "Quizá el cambio no se nota en un día, pero se acumula en silencio. Gracias por quedarte en tu proceso. 💛"] },
  { a: "💛 Medio camino de mucho, {nombre}", c: [
    "Ya son {meses} meses caminando este camino de sanación. Cada paso, incluso los lentos, te ha ido acercando a una versión más tranquila de ti.",
    "Celebra hoy tu constancia: no todo el mundo se queda a sanar. Tú sí. Y eso te honra. 🌱"] },
  { a: "🌻 {nombre}, mira tu constancia", c: [
    "{meses} meses. Se dice rápido, pero detrás hay días de esfuerzo, de dudas superadas y de volver a intentarlo.",
    "Que este recordatorio te abrace: estás avanzando, aunque a veces no lo sientas. Seguimos contigo, un paso a la vez. 💛"] },
  { a: "✨ {meses} meses de ti, para ti, {nombre}", c: [
    "Hace {meses} meses decidiste empezar a cuidarte en serio. Esa decisión sigue dando frutos en tu vida, uno pequeño cada día.",
    "Gracias por confiar en este espacio. Tu proceso importa, y nosotros lo celebramos contigo. 🌿"] },
  { a: "🌙 Tu proceso florece, {nombre}", c: [
    "Cumplir {meses} meses en Reaviva es como ver una planta que crece sin hacer ruido: un día te das cuenta de que estás más firme, más en paz.",
    "Sigue regando tu corazón con paciencia. Lo que estás construyendo vale cada día invertido. 💛"] },
  { a: "🎉 {meses} meses juntos, {nombre}", c: [
    "Hoy celebramos tus {meses} meses formando parte de esta comunidad que sana a su ritmo, sin compararse y sin rendirse.",
    "Gracias por estar, por leer, por intentarlo. Personas como tú hacen que este lugar tenga sentido. 💛"] },
  { a: "🌅 {nombre}, sigues amaneciendo", c: [
    "Han pasado {meses} meses desde que llegaste, y lo más bonito es esto: sigues amaneciendo para ti, incluso después de noches largas.",
    "Que los próximos meses te encuentren con más calma y más sonrisas. Tu constancia merece recompensa. 🌱"] },
  { a: "💛 Gracias por no rendirte, {nombre}", c: [
    "{meses} meses después, sigues aquí. En un mundo que se rinde rápido, tu permanencia es una forma silenciosa de valentía.",
    "Hoy solo queremos decírtelo claro: lo estás haciendo mejor de lo que crees. Sigue, a tu ritmo. 🌻"] },
  { a: "🌷 Tu paz está creciendo, {nombre}", c: [
    "Hace {meses} meses empezaste a sembrar paz en medio del ruido. Hoy esa siembra ya se asoma en tu manera de vivir y de elegir.",
    "Cuídala como lo que es: tu tesoro. Gracias por permitirnos acompañarte en el camino. 💛"] },
  { a: "⭐ {meses} meses de valentía, {nombre}", c: [
    "Sanar no es lineal, y aun así llevas {meses} meses sin soltar tu proceso. Eso no es suerte: es carácter, es amor propio en construcción.",
    "Celebramos tu valentía hoy y te recordamos que no caminas en soledad. 🌱"] },
  { a: "💫 {nombre}, esto también es un logro", c: [
    "Permanecer {meses} meses trabajando en tu corazón es un logro que merece nombre propio: se llama compromiso contigo.",
    "Que nada te haga dudar de lo lejos que has llegado. Hoy, celébralo un poquito. Te lo ganaste. 💛"] },
  { a: "🌿 Raíces más fuertes, {nombre}", c: [
    "En {meses} meses tus raíces se han hecho más fuertes, aunque el árbol todavía esté creciendo. Así son los cambios verdaderos: profundos antes que visibles.",
    "Gracias por confiar en el proceso. Lo que viene se sostiene sobre todo lo que ya sanaste. 🌱"] },
  { a: "🎈 {nombre}, celebramos tu camino", c: [
    "Hoy no celebramos una meta final, celebramos el camino: {meses} meses de pasos honestos hacia tu bienestar.",
    "Cada día que eliges tu paz es una pequeña fiesta. Gracias por invitarnos a la tuya. 💛"] },
  { a: "🌞 Tu luz lleva {meses} meses creciendo, {nombre}", c: [
    "Quizá no lo notas a diario, pero tu luz lleva {meses} meses volviendo, conversación a conversación, día a día.",
    "Que siga creciendo sin prisa y sin pausa. Estamos orgullosos de acompañarte. 🌻"] },
  { a: "💛 {meses} meses: tu corazón lo sabe, {nombre}", c: [
    "Tu corazón sabe que estos {meses} meses no han sido en vano: respira distinto, espera distinto, se cuida distinto.",
    "Honra ese avance hoy. Y cuando dudes, vuelve a este mensaje: vas por buen camino. 🌱"] },
  { a: "🍃 {nombre}, soltar también es avanzar", c: [
    "En {meses} meses has soltado pesos que no se ven pero se sienten. Cada soltar te ha hecho más ligero, más libre, más tú.",
    "Que los próximos meses traigan aún más liviandad a tu vida. Gracias por estar aquí. 💛"] },
  { a: "🌈 Después de {meses} meses, {nombre}", c: [
    "Después de {meses} meses de proceso, los colores vuelven de a poco: una risa aquí, una calma allá, una esperanza nueva.",
    "Guarda esos colores como prueba de que sanar es posible. Seguimos caminando contigo. 🌷"] },
  { a: "🕊️ {meses} meses buscando tu calma, {nombre}", c: [
    "Buscar la calma durante {meses} meses, en medio de la vida real, es de las cosas más valientes que una persona puede hacer.",
    "Que la calma te encuentre cada vez más seguido. Tu esfuerzo está dejando huella. 💛"] },
  { a: "🎂 Casi sin darte cuenta, {nombre}", c: [
    "Casi sin darte cuenta, ya sumas {meses} meses cuidando tu corazón. Los grandes cambios suelen llegar así: callados y constantes.",
    "Hoy date crédito por eso. Y sigue: tu historia de sanación se sigue escribiendo. 🌱"] },
  { a: "💛 Esta comunidad es mejor contigo, {nombre}", c: [
    "Hace {meses} meses llegaste a Reaviva, y desde entonces este rincón es un poco más humano gracias a personas como tú.",
    "Gracias por tu presencia y por tu proceso. Que vengan muchos meses más de paz compartida. 🌻"] },
  { a: "🌱 Semilla que no deja de crecer, {nombre}", c: [
    "Una semilla no se pregunta si va lenta: simplemente crece. Tú llevas {meses} meses creciendo a tu manera, y eso basta.",
    "Sigue confiando en tu temporada. Lo que florece en ti ya se empieza a notar. 💛"] },
  { a: "✨ {nombre}, tu esfuerzo se nota", c: [
    "Puede que nadie te lo haya dicho últimamente, así que lo decimos nosotros: tu esfuerzo de estos {meses} meses se nota y vale muchísimo.",
    "No sueltes ahora: estás más cerca de tu paz de lo que imaginas. 🌿"] },
  { a: "🌙 Noches más tranquilas vendrán, {nombre}", c: [
    "Llevas {meses} meses trabajando para que tus noches sean más tranquilas y tus días más tuyos. Ese trabajo no se pierde: se acumula a tu favor.",
    "Gracias por seguir. Lo mejor de tu proceso todavía está por mostrarse. 💛"] },
  { a: "🎉 {meses} meses, una misma promesa, {nombre}", c: [
    "La promesa que te hiciste hace {meses} meses sigue viva cada vez que abres Reaviva y eliges cuidarte un día más.",
    "Honramos esa promesa contigo hoy. Que nunca te falte fuerza para renovarla. 🌱"] },
  { a: "💛 {nombre}, gracias por confiar", c: [
    "Confiar tu proceso durante {meses} meses no es poca cosa. Gracias por dejarnos acompañarte con palabras, días y pequeñas luces.",
    "Seguiremos aquí, celebrando cada uno de tus avances, por pequeños que parezcan. 🌻"] },
  { a: "🌻 El tiempo también sana contigo, {nombre}", c: [
    "Dicen que el tiempo lo cura todo, pero es más cierto esto: el tiempo, cuando lo usas para cuidarte, sana. Tú llevas {meses} meses usándolo bien.",
    "Que los próximos meses sean todavía más amables contigo. 💛"] },
  { a: "⭐ Tu constancia inspira, {nombre}", c: [
    "Sin saberlo, tu constancia de estos {meses} meses inspira a otros que recién empiezan y dudan si podrán.",
    "Gracias por ser prueba viva de que se puede seguir. Hoy te celebramos a ti. 🌱"] },
  { a: "🌷 {meses} meses de amor propio en obra, {nombre}", c: [
    "El amor propio no se declara: se construye, día a día. Tú llevas {meses} meses poniendo ladrillos de cariño y de límites sanos.",
    "La obra avanza, {nombre}. Y se ve hermosa desde aquí. 💛"] },
  { a: "💫 Lo que viene, {nombre}", c: [
    "Si en {meses} meses lograste llegar hasta aquí, imagina lo que pueden traer los próximos meses con la misma constancia tuya.",
    "Te acompañamos a descubrirlo. Gracias por ser parte de Reaviva, hoy y siempre. 🌿"] },
  { a: "💛 {nombre}, este mensaje es un abrazo", c: [
    "Al cumplir {meses} meses en esta plataforma, queremos enviarte más que un correo: un abrazo en palabras, de esos que llegan justo a tiempo.",
    "Recíbelo y sigue adelante. Tu paz está en construcción, y va muy bien. 🌱"] },
];

const fill = (txt, vars) => txt.replace(/\{nombre\}/g, vars.nombre || "")
  .replace(/\{meses\}/g, String(vars.meses || ""));

/* Fecha de hoy en la zona del usuario (Bolivia). */
function hoyLaPaz(){
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/La_Paz", year: "numeric", month: "numeric", day: "numeric",
  }).formatToParts(new Date());
  const o = {};
  for (const p of parts) o[p.type] = Number(p.value);
  return { y: o.year, m: o.month, d: o.day };
}
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/* Ejecuta el barrido de celebraciones del día. Idempotente por
 * celebration_log (user_id, kind, period_key únicos). */
async function runCelebrations(){
  const hoy = hoyLaPaz();
  const users = await db.all(
    `SELECT id, name, email, birthdate, created_at FROM users
     WHERE email_verified = 1 AND is_admin = 0
       AND email NOT LIKE '%@test.com' AND email NOT LIKE '%@reavivaapp.com'`);
  const out = { fecha: `${hoy.y}-${String(hoy.m).padStart(2, "0")}-${String(hoy.d).padStart(2, "0")}`, cumpleanos: [], semestre: [] };

  for (const u of users) {
    const nombre = String(u.name || "").trim().split(/\s+/)[0] || "amigo";
    /* --- Cumpleaños --- */
    if (u.birthdate) {
      const bm = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(u.birthdate));
      if (bm) {
        const bM = Number(bm[2]);
        let bD = Number(bm[3]);
        if (bM === 2 && bD === 29 && !isLeap(hoy.y)) bD = 28;
        if (bM === hoy.m && bD === hoy.d) {
          const period = "B-" + hoy.y;
          const idx = Math.abs(u.id + hoy.y) % CUMPLEANOS.length;
          const claim = await claimLog(u.id, "cumpleanos", period, idx);
          if (claim) {
            const t = CUMPLEANOS[idx];
            await sendCelebrationEmail({
              to: u.email, nombre,
              asunto: fill(t.a, { nombre }),
              titulo: fill(t.a, { nombre }),
              parrafos: t.c.map(p => fill(p, { nombre })),
            });
            out.cumpleanos.push({ nombre: u.name, email: u.email, plantilla: idx + 1 });
          }
        }
      }
    }
    /* --- Cada 6 meses en la plataforma --- */
    if (u.created_at) {
      const cm = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(u.created_at));
      if (cm) {
        const cY = Number(cm[1]), cM = Number(cm[2]), cD = Number(cm[3]);
        const meses = (hoy.y - cY) * 12 + (hoy.m - cM);
        const diaOk = hoy.d === Math.min(cD, daysInMonth(hoy.y, hoy.m));
        if (meses >= 6 && meses % 6 === 0 && diaOk) {
          const period = "S-" + meses;
          const idx = Math.abs(u.id + meses) % SEMESTRE.length;
          const claim = await claimLog(u.id, "semestre", period, idx);
          if (claim) {
            const t = SEMESTRE[idx];
            await sendCelebrationEmail({
              to: u.email, nombre,
              asunto: fill(t.a, { nombre, meses }),
              titulo: fill(t.a, { nombre, meses }),
              parrafos: t.c.map(p => fill(p, { nombre, meses })),
            });
            out.semestre.push({ nombre: u.name, email: u.email, meses, plantilla: idx + 1 });
          }
        }
      }
    }
  }
  out.total = out.cumpleanos.length + out.semestre.length;
  return out;
}

/* Reclama el envío en el registro; false si ya se envió ese período. */
async function claimLog(userId, kind, period, idx){
  const prev = await db.get(
    "SELECT id FROM celebration_log WHERE user_id = ? AND kind = ? AND period_key = ?",
    userId, kind, period);
  if (prev) return false;
  await db.run(
    "INSERT INTO celebration_log (user_id, kind, period_key, template_idx) VALUES (?, ?, ?, ?)",
    userId, kind, period, idx);
  return true;
}

module.exports = { runCelebrations, CUMPLEANOS, SEMESTRE };
