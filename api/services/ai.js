/* Reaviva API — servicio de IA (asistente del administrador y de los usuarios).
 * Usa OpenAI (gpt-4o-mini) vía OPENAI_API_KEY. Sin la clave, las funciones
 * devuelven un mensaje indicando que falta configurarla (nunca se cae).
 *
 * REGLAS DURAS:
 * - Todo en español latino.
 * - 100% secular: nada religioso.
 * - NUNCA da diagnósticos ni consejos médicos/psiquiátricos directos.
 * - Si detecta riesgo (autolesión, suicidio, violencia), sugiere buscar ayuda profesional.
 */
"use strict";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini";

const SYSTEM_BASE = `Eres el asistente de IA de Reaviva, una app de sanación emocional después de rupturas amorosas.
REGLAS INQUEBRANTABLES:
- Escribe SIEMPRE en español latinoamericano natural y cálido.
- Contenido 100% secular: jamás menciones religión, Dios, fe, oración ni nada espiritual.
- NUNCA des diagnósticos médicos, psiquiátricos ni psicológicos. No eres terapeuta.
- Si el usuario expresa ideas de autolesión, suicidio o violencia, responde con empatía y sugiere buscar ayuda profesional o una línea de apoyo en su país. No minimices ni ignores la señal.
- Sé empático, directo y práctico. Nada de frases vacías.`;

function hasKey() {
  return !!(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim());
}

/* Llamada base a OpenAI. Devuelve { ok, text } o { ok:false, error }. */
async function callAI(prompt, systemPrompt) {
  if (!hasKey()) {
    return { ok: false, error: "OPENAI_API_KEY no configurada en el servidor" };
  }
  try {
    const r = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + process.env.OPENAI_API_KEY.trim(),
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: systemPrompt || SYSTEM_BASE },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 1500,
      }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      return { ok: false, error: "OpenAI respondió " + r.status + ": " + t.slice(0, 200) };
    }
    const j = await r.json();
    const text = j.choices && j.choices[0] && j.choices[0].message
      ? j.choices[0].message.content.trim()
      : "";
    if (!text) return { ok: false, error: "OpenAI devolvió respuesta vacía" };
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: "Error llamando a OpenAI: " + e.message };
  }
}

/* Analiza el caso de un usuario a partir de sus datos en la BD.
 * userData: { name, gender, age, planType, currentDay, daysCompleted, journalEntries,
 *             testScores, flags, chatMuted, rvBalance, country } */
async function analyzeUserCase(userData) {
  const u = userData || {};
  const prompt = `Analiza el caso de este usuario de Reaviva y redacta un informe para el ADMINISTRADOR.

DATOS DEL USUARIO:
- Nombre: ${u.name || "—"} | Sexo: ${u.gender === "F" ? "mujer" : u.gender === "M" ? "hombre" : "—"} | Edad: ${u.age || "—"} | País: ${u.country || "—"}
- Plan: ${u.planType || "gratis"} | Día actual del programa: ${u.currentDay || 1} | Días completados: ${u.daysCompleted || 0}/30
- Entradas de diario: ${u.journalEntries || 0} | Balance RV: ${u.rvBalance || 0}
- Banderas recibidas: ${u.flags || 0} | Chat deshabilitado: ${u.chatMuted ? "sí" : "no"}
${u.testScores ? "- Puntajes de tests de progreso: " + u.testScores : ""}
${u.recentJournal ? "- Fragmentos recientes del diario:\n" + String(u.recentJournal).slice(0, 1500) : ""}

Redacta el informe en este formato exacto:
1. RESUMEN DEL CASO (2-3 líneas: en qué punto está)
2. TEMAS CLAVE (lista de 3-5 temas emocionales que detectas)
3. NIVEL DE RIESGO: bajo / medio / alto (alto solo si hay señales de autolesión, crisis severa o estancamiento total)
4. RECOMENDACIONES PARA EL ADMIN (3 acciones concretas: qué reto crearle, qué test aplicarle, si necesita atención especial)
5. MENSAJE SUGERIDO AL USUARIO (2-3 líneas cálidas, motivadoras, sin prometer resultados)

Recuerda: nada religioso, nada de diagnósticos clínicos. Si hay señales de riesgo, indícalo claramente para que el admin actúe.`;
  return callAI(prompt, SYSTEM_BASE + "\nRedactas informes para el administrador de la app. Sé claro, estructurado y accionable.");
}

/* Genera un reto personalizado para un usuario. Devuelve { ok, title, description }. */
async function generateChallenge(userData) {
  const u = userData || {};
  const prompt = `Crea UN reto personalizado para este usuario de Reaviva (app de sanación tras ruptura).

DATOS:
- Nombre: ${u.name || "—"} | Sexo: ${u.gender === "F" ? "mujer" : u.gender === "M" ? "hombre" : "—"}
- Día actual: ${u.currentDay || 1}/30 | Días completados: ${u.daysCompleted || 0}
${u.analysisSummary ? "- Resumen del análisis de su caso: " + String(u.analysisSummary).slice(0, 800) : ""}
${u.testScores ? "- Puntajes de tests: " + u.testScores : ""}

El reto debe:
- Ser concreto y realizable en 1-3 días
- Estar adaptado a su punto del programa y su estado emocional
- Ser 100% secular y saludable (nada de contactar al ex, nada riesgoso)
- Tener un título corto (máx 60 caracteres) y una descripción clara (2-4 líneas con pasos)

Responde EXACTAMENTE en este formato:
TÍTULO: <título>
DESCRIPCIÓN: <descripción>`;
  const r = await callAI(prompt);
  if (!r.ok) return r;
  const mTitle = r.text.match(/TÍTULO:\s*(.+)/);
  const mDesc = r.text.match(/DESCRIPCIÓN:\s*([\s\S]+)/);
  return {
    ok: true,
    title: (mTitle ? mTitle[1] : "Reto personalizado").trim().slice(0, 120),
    description: (mDesc ? mDesc[1] : r.text).trim().slice(0, 2000),
    raw: r.text,
  };
}

/* Genera preguntas de test personalizadas según el progreso del usuario. */
async function generateTestQuestions(userData) {
  const u = userData || {};
  const prompt = `Genera 10 preguntas de test emocional personalizadas para este usuario de Reaviva.

DATOS:
- Nombre: ${u.name || "—"} | Día actual: ${u.currentDay || 1}/30
${u.analysisSummary ? "- Análisis de su caso: " + String(u.analysisSummary).slice(0, 800) : ""}
${u.testScores ? "- Tests anteriores: " + u.testScores : ""}

Las preguntas deben:
- Medir su estado emocional actual (ánimo, apego al ex, autocuidado, claridad, esperanza)
- Estar adaptadas a su momento del programa
- Ser escala 1-5 (1 = peor, 5 = mejor) o abiertas y reflexivas
- 100% seculares, cálidas, sin jerga clínica

Responde con las 10 preguntas numeradas, cada una en una línea, indicando al final [escala] o [abierta].`;
  return callAI(prompt);
}

/* Chat de ayuda con el usuario. userContext: perfil + día actual + resumen.
 * NUNCA expone datos de otros usuarios. */
async function chatWithUser(message, userContext) {
  const u = userContext || {};
  const msg = String(message || "").slice(0, 2000);
  if (!msg.trim()) return { ok: false, error: "Mensaje vacío" };
  const system = SYSTEM_BASE + `
Estás conversando directamente con un usuario que está sanando una ruptura.
- Su nombre: ${u.name || "—"}. Día del programa: ${u.currentDay || 1}/30.
${u.analysisSummary ? "Contexto de su caso: " + String(u.analysisSummary).slice(0, 600) : ""}
- Responde de forma breve (máx 150 palabras), cálida y práctica.
- Puedes sugerir ejercicios del programa o pequeños retos diarios.
- Si pide algo fuera de tu alcance (temas legales, médicos), dilo con honestidad y sugiere un profesional.
- Jamás menciones que eres un modelo de IA de una empresa; eres "el asistente de Reaviva".`;
  return callAI(msg, system);
}

module.exports = {
  callAI,
  analyzeUserCase,
  generateChallenge,
  generateTestQuestions,
  chatWithUser,
  hasKey,
};
