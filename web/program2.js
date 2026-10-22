/* ============================================================
   REAVIVA — FASE 2: "Seguir sanando" (día 31 en adelante, sin fin)
   ------------------------------------------------------------
   Motor de ciclos: cada 7 días = 1 ciclo con UN tema del pool.
   El pool rota en orden; al agotarse empieza una nueva "vuelta"
   con el mismo orden pero nivel de profundidad +1 (los prompts
   de "Su historia" y los ejercicios profundizan con referencias
   a lo que la persona escribió antes — ver app.js: storyPromptF2
   y getDayContent).

   Cálculo para un día absoluto d > 30 (MISMA fórmula en el
   backend: api/routes/program.js, ruta de audio):
     f2day      = d - 30                      (1-based en Fase 2)
     ciclo0     = floor((f2day - 1) / 7)      (ciclo global 0-based)
     cycleDay   = ((f2day - 1) % 7) + 1       (1..7)
     themeIndex = ciclo0 % 8
     vuelta     = floor(ciclo0 / 8) + 1
     ciclo      = ciclo0 + 1                  (número mostrado)

   Cada tema: { id, nombre, enfoque, dias: [7 × { titulo,
   audioTitulo, caso, guion, ejercicio, historia, accion }] }.
   - guion: texto del audio del día (también se muestra como
     reflexión). Los audios se generan con TTS desde estos guiones
     y se sirven como /audio/f2-t<tema>-d<día>.mp3 (+ "-f").
   - En ejercicio/historia puede aparecer el token {frag}: el
     frontend lo reemplaza por un fragmento real de la historia
     del usuario (día 1) — ver getDayContent/storyPromptF2.
   - Marcadores de género {masc/fem} igual que en Fase 1 (gtext).
   Contenido 100% secular.
   ============================================================ */

window.REAVIVA_F2_THEMES = [
/* ==========================================================
   TEMA 1 — AUTOESTIMA (contenido completo)
   ========================================================== */
{ id: "autoestima", nombre: "Autoestima",
  enfoque: "Reconstruir tu valor propio desde adentro: dejar de medirte con los ojos de quien se fue y volver a verte con los tuyos.",
  dias: [
  { titulo: "Tu valor no se negocia",
    audioTitulo: "Tu valor no se negocia",
    caso: "Valeria salió de su relación creyendo que «no era suficiente». No era una conclusión: era una frase que escuchó tantas veces, en tantos tonos, que terminó pareciendo su propia voz.",
    guion: "Bienvenido a tu Fase 2. Ya hiciste lo más difícil: atravesaste los primeros 30 días. Ahora empieza otra etapa, más silenciosa y más profunda: reconstruirte. Y el primer ladrillo es este: tu valor no se negocia. No sube porque alguien te elija ni baja porque alguien se vaya. Piensa en el sol: no vale menos porque una persona decida cerrar las cortinas. Durante mucho tiempo mediste tu valor con una regla ajena: si te escribía, valías; si te ignoraba, no valías nada. Esa regla estaba rota desde el principio, porque tu valor nunca estuvo en sus manos. Estaba —y sigue estando— en lo que eres cuando nadie te mira: en cómo tratas a la gente, en tu capacidad de levantarte, en la lealtad que ofreces y que también mereces. Hoy no tienes que convencerte de golpe. Solo repite esto cuando la duda apriete: «que alguien no haya sabido verme no cambia lo que soy». La autoestima no se recupera en un día; se entrena, como un músculo. Y hoy, este ciclo, es tu gimnasio. Cada ejercicio de esta semana es una repetición más. No busques sentirte {seguro/segura} de inmediato: busca actuar como alguien que se valora, y el sentimiento llegará detrás, como llega siempre: tarde, pero llega. Por eso este ciclo no te pide grandes saltos: te pide constancia honesta. La autoestima de verdad se nota en días normales: en cómo te hablas un martes cualquiera, en lo que aceptas y en lo que ya no aceptas. Desde hoy, cada día de este ciclo suma una prueba más a tu expediente nuevo: el de una persona que se trata como alguien valioso mientras termina de creérselo.",
    ejercicio: "Escribe dos columnas. En la izquierda: «Lo que me hicieron creer de mí»; en la derecha: «Lo que sé que es verdad». Retoma algo que escribiste en tu historia: {frag}. ¿Esa frase habla de tu valor real o del dolor de ese momento? Argumenta tu respuesta con hechos de tu vida, no con emociones del día.",
    historia: "Hoy empieza un ciclo nuevo: autoestima. Cuéntanos: ¿cómo quedó tu imagen de ti {mismo/misma} después de todo lo que viviste? Sé brutalmente {honesto/honesta}.",
    accion: "Elige una frase de tu columna derecha y ponla como fondo de pantalla o nota en el espejo. Léela cada mañana de este ciclo." },
  { titulo: "La voz crítica no eres tú",
    audioTitulo: "La voz crítica no eres tú",
    caso: "Daniel se miraba al espejo y se decía cosas que jamás le diría a un amigo. Un día se preguntó de quién era esa voz… y reconoció frases exactas de su expareja.",
    guion: "Hay una voz que te habla bajito cuando fallas, cuando te miras al espejo, cuando alguien nuevo aparece. Esa voz dice «no eres suficiente», «nadie te va a querer así», «fue tu culpa». Hoy quiero que escuches algo importante: esa voz no eres tú. Es un eco. Se formó con críticas que recibiste, con comparaciones que te impusieron, con momentos en los que te hicieron sentir {pequeño/pequeña}. Y como todo eco, suena fuerte pero no tiene fuerza propia: depende de que tú sigas hablando en ese cuarto oscuro. El primer paso para bajarle el volumen no es pelear con ella; es reconocerla. Cuando aparezca, di mentalmente: «esa es la voz crítica, no soy yo». Parece un detalle menor, pero cambia todo: dejas de ser el acusado y pasas a ser el testigo. Y un testigo puede preguntar: ¿esto es verdad, o es solo una vieja grabación? La mayoría de las veces descubrirás que es una grabación vieja, de una época en la que necesitabas creer eso para quedarte donde estabas. Ya no estás ahí. Ya no necesitas esa voz para sobrevivir. Esta semana la vamos a desarmar pieza por pieza. Y algo más: una voz también se desarma reemplazándola. Cada vez que detectes la frase crítica y la respondas con datos, le quitas un tornillo. No desaparecerá de un día para otro —lleva años instalada—, pero su reinado termina el día en que empiezas a auditarla en vez de obedecerla. Ese día es hoy.",
    ejercicio: "Escribe las 3 frases que tu voz crítica más repite. Al lado de cada una, escribe de quién la escuchaste primero o en qué época apareció. Luego respóndele a cada frase como le responderías a tu mejor amigo si se la dijeran a él. Incluye en tu respuesta algo concreto de tu historia: {frag}.",
    historia: "¿De dónde crees que viene tu voz crítica? ¿Quién te hablaba así, y desde cuándo la llevas contigo?",
    accion: "Hoy, cada vez que la voz crítica aparezca, nómbrala: «ahí está otra vez». Solo nómbrala. El registro es el ejercicio." },
  { titulo: "Lo que sí hiciste bien",
    audioTitulo: "Lo que sí hiciste bien",
    caso: "Laura hizo una lista de todo lo que «hizo mal» en su relación: tenía 14 puntos. Cuando su terapeuta le pidió la lista de lo que hizo bien, se quedó en blanco… y luego lloró al darse cuenta de que nunca nadie se la había pedido.",
    guion: "Tu memoria está sesgada. Cuando el autoestima está herida, el cerebro archiva los errores en una carpeta gigante y los aciertos en un cajón que ni abre. Por eso puedes recordar con lujo de detalle la noche en que dijiste lo incorrecto, pero no las cien veces que estuviste, cuidaste, resolviste y sostuviste. No es que no haya aciertos: es que nadie te entrenó para contarlos. Hoy cambiamos el archivo. Reconocer lo que hiciste bien no es soberbia; es justicia. En tu relación amaste, intentaste, perdonaste, creciste. En tu duelo te levantaste días en los que no querías levantarte. Llegaste hasta el día 31 de este proceso, y eso ya te pone por encima de la versión de ti que se quedó esperando en la puerta. La autoestima sana no dice «soy perfecto»; dice «sé lo que aporto y sé lo que merezco». Esas dos certezas se construyen con evidencia, y la evidencia está en tu propia historia, esperando que la leas completa, no solo las páginas tristes. Desde hoy, cada noche, anota un acierto del día, por pequeño que sea. En pocas semanas tendrás un archivo nuevo. Y cuando la voz crítica hable, tendrás con qué responderle: con datos. Porque la autoestima que se apoya en frases bonitas se cae con el primer mal día; la que se apoya en evidencia, aguanta. Tú no necesitas creerte {perfecto/perfecta}: necesitas creerte la lista completa de lo que sí has hecho, sostenido y superado. Esa lista existe. Hoy empezaste a escribirla, y esta semana la vas a dejar firmada.",
    ejercicio: "Haz tu inventario justo: escribe 10 cosas que hiciste bien en tu relación y 5 que has hecho bien durante este proceso de sanación. Sin minimizar («bueno, no fue para tanto» está prohibido). Si te cuesta, vuelve a esto que viviste: {frag}. ¿Qué dice de ti el hecho de haberlo atravesado?",
    historia: "Cuéntanos un momento de tu historia en el que estuviste a la altura, aunque nadie te lo reconoció. ¿Cómo se siente contarlo en voz alta?",
    accion: "Empieza hoy tu lista nocturna: antes de dormir, escribe un acierto del día. Uno solo. Sin excepción esta semana." },
  { titulo: "Compararte es perder dos veces",
    audioTitulo: "Compararte es perder dos veces",
    caso: "Marcos veía la foto de su ex con alguien nuevo y sentía que había «perdido». Su hermano le dijo algo que no olvidó: «estás comparando tu peor día con el mejor escaparate de otro».",
    guion: "Compararte es perder dos veces: pierdes la paz por lo que ves, y pierdes la gratitud por lo que tienes. Y en tiempos de redes, la comparación es una trampa perfecta: comparas tu interior, con todo su desorden, contra el escaparate de los demás, donde nadie publica sus madrugadas llorando. Si te comparas con tu ex, la trampa es peor: comparas tu proceso real, con días malos incluidos, contra una versión editada de su vida que ni siquiera conoces completa. La comparación además es injusta en su base: nadie más partió de tu punto de partida, con tus heridas, tu historia y tus recursos. Tu único rival honesto eres tú hace un mes. ¿Duermes mejor que hace un mes? ¿Lloras menos días? ¿Te hablas con más respeto? Eso es ganar, aunque no se vea en ninguna foto. Esta semana te propongo un ayuno: siete días sin revisar perfiles que te activen la comparación. No por debilidad, sino por estrategia: nadie se recupera mirando la herida del de al lado. Tu proceso es tuyo, tu ritmo es tuyo, y tu valor no aparece en el marcador de nadie más. Y si hoy tu marcador personal todavía se ve modesto, mídelo con la escala correcta: no se mide en fotos ni en aprobación ajena; se mide en noches dormidas, en mensajes no enviados, en mañanas en las que te levantaste cuando no querías. Por ese marcador, tú vas ganando. Sigue alimentándolo un día a la vez, sin mirar el de al lado.",
    ejercicio: "Escribe en qué te comparas más: ¿con tu ex, con su nueva vida, con otras parejas, con tu yo del pasado? Describe la última vez que te comparaste y cuánto tiempo te robó ese día. Luego escribe tu marcador personal: 3 avances tuyos, medibles, desde que empezó tu historia en este programa ({frag}).",
    historia: "¿Con quién te comparas más y qué crees que esa comparación está protegiendo? A veces comparamos para no mirar otra cosa. ¿Qué sería en tu caso?",
    accion: "Ayuno de comparación por 7 días: silencia o deja de revisar los perfiles que te disparan. Anota cada impulso de mirar y qué sentías justo antes." },
  { titulo: "Cuida tu cuerpo, cambia tu espejo",
    audioTitulo: "Cuida tu cuerpo, cambia tu espejo",
    caso: "Durante su duelo, Daniel dejó de arreglarse: «¿para quién?». Una mañana decidió ducharse, vestirse bien y salir a caminar sin motivo. Al volver, el espejo le devolvió a alguien distinto. No había cambiado su vida: había cambiado el mensaje que se daba.",
    guion: "La autoestima también se construye con las manos. Hay días en los que no puedes pensar distinto, pero sí puedes actuar distinto: ducharte con calma, vestirte con ropa que te gusta, caminar veinte minutos, comer algo que te nutra de verdad. Parecen cosas superficiales, pero tu cerebro las lee como evidencia: «esta persona se cuida; esta persona importa». Cada acto de cuidado es un voto a favor de la persona que quieres ser. Y los votos se acumulan. Por eso en los duelos más duros, lo primero que se cae es lo básico: el sueño, la comida, el movimiento. Y lo primero que hay que reconstruir también es lo básico. No necesitas una transformación de revista. Necesitas constancia pequeña: la cama tendida, la caminata de la mañana, el vaso de agua antes que el tercer café. Tu cuerpo cargó el dolor de esta historia; merece que lo trates como aliado y no como el escenario del desastre. Esta semana, elige un solo hábito corporal y cúmplelo siete días. Cuando lo cumplas, nótalo: eso también es autoestima, de la que se demuestra en vez de declararse. Nota además algo práctico: el cuidado corporal ordena el día. Una ducha tranquila, una caminata y una comida decente le dan estructura hasta al peor martes, y la estructura baja la ansiedad mejor que mil consejos. Cuando el ánimo no alcance para grandes decisiones, que alcance para lo básico: la cama tendida, el agua, el aire. Mañana será otro examen; hoy solo hay que cumplir el hábito pequeño y anotarlo.",
    ejercicio: "Califica del 1 al 10 cómo estás cuidando tu sueño, tu alimentación, tu movimiento y tu presentación personal. Elige el área más baja y diseña un hábito mínimo de 7 días (tan pequeño que no puedas fallar). Conecta tu plan con tu historia: ¿qué abandonaste de ti cuando pasó esto: {frag}?",
    historia: "¿Qué partes de tu cuidado personal dejaste caer durante la relación o el duelo? ¿Qué se siente retomarlas, aunque sea un poco?",
    accion: "Haz hoy el primer día de tu hábito mínimo. Marca una X en un papel visible. La cadena de X es tu nueva evidencia." },
  { titulo: "Rodéate de quien te ve bien",
    audioTitulo: "Rodéate de quien te ve bien",
    caso: "Valeria notó algo curioso: con ciertas personas salía sintiéndose capaz y bonita; con otras, salía dudando de todo. No era casualidad. Empezó a llevar la cuenta… y a elegir.",
    guion: "Tu entorno es un espejo. Hay personas que te devuelven tu mejor reflejo: te escuchan sin minimizarte, celebran tus avances, te dicen la verdad sin humillarte. Y hay personas que funcionan como espejos rotos: todo lo que reflejan sale deformado. Después de una relación que dañó tu autoestima, es vital auditar tus espejos. No se trata de cortar a todo el mundo, sino de saber quién suma y quién resta en esta etapa. La gente que te quiere bien tiene tres señales: respeta tus límites, no usa tus confesiones en tu contra y se alegra cuando mejoras. La que no, suele disfrazarse de «honestidad» para criticar, o de «preocupación» para controlarte. También es momento de pedir mejor: decir «necesito que me escuches sin darme consejos», o «hoy no quiero hablar de mi ex». Las personas correctas agradecen la claridad. Y si tu círculo quedó pequeño tras la ruptura, recuerda esto: un círculo pequeño y sano vale más que una multitud que te recuerda tu herida. Esta semana vas a acercarte, a propósito, a tus espejos buenos. Tu autoestima se alimenta de lo que te rodea; elige el menú. Y empieza por casa: tú también eres un espejo para ti. La forma en que te hablas al equivocarte, lo que te permites descansar, lo que celebras de tu avance: todo eso también es entorno. Esta semana eliges menú afuera y adentro. Mañana cerramos el ciclo escribiendo tu nueva definición de ti, con todo lo reunido hasta aquí: tu valor, tu voz, tu evidencia y tus espejos.",
    ejercicio: "Dibuja tu mapa de espejos: lista a las personas de tu vida y marca quién te devuelve un reflejo bueno, quién es neutro y quién te deforma. Piensa en quién estuvo cuando viviste esto: {frag}. ¿Quién te sostuvo y quién desapareció? Escribe un mensaje de agradecimiento para uno de tus espejos buenos (enviarlo es parte de la acción).",
    historia: "Cuéntanos de la persona que mejor te ha acompañado en este proceso. ¿Qué hace diferente a las demás? ¿Y quién te sorprendió para mal?",
    accion: "Agenda esta semana un café o una llamada con uno de tus espejos buenos. Y envía hoy ese mensaje de agradecimiento." },
  { titulo: "Tu nueva definición de ti",
    audioTitulo: "Tu nueva definición de ti",
    caso: "Al cerrar su semana de autoestima, Laura escribió en su libreta: «No soy la que fue dejada. Soy la que se está levantando». Lo leyó cada mañana durante un mes. Un día se dio cuenta de que ya no lo leía: lo creía.",
    guion: "Cerramos el ciclo de autoestima con el ejercicio más poderoso: redefinirte. Durante mucho tiempo tu identidad quedó atrapada en la historia que terminó: «la persona a la que dejaron», «el que no fue suficiente». Pero esa es una descripción del pasado, no una definición de tu persona. Una definición nueva se escribe en presente y se firma con hechos. Fíjate en lo que acumulaste esta semana: separaste tu valor de la mirada ajena, reconociste que la voz crítica no eres tú, hiciste inventario de tus aciertos, dejaste de compararte, cuidaste tu cuerpo y elegiste mejores espejos. Eso no lo hace alguien «insuficiente»: lo hace alguien en reconstrucción. La autoestima madura no grita «soy lo máximo»; susurra «sé quién soy, incluso en mis días malos». Habrá días en que la definición tiemble. Es normal. Por eso se escribe: para releerla cuando la memoria emocional quiera volver a la versión vieja. Hoy escribes tu definición, con tus palabras, desde tu evidencia. Y mañana empieza un ciclo nuevo —el de los límites— sobre esta base: ya no negocias tu valor; ahora aprendes a protegerlo. Quédate con la imagen completa de esta semana: llegaste midiendo tu valor con una regla ajena y te vas con una definición firmada por ti. Ese papel no es un amuleto: es el recordatorio de un trabajo hecho y de un estándar nuevo. Cuando la vida lo ponga a prueba —y lo pondrá—, no discutirás desde cero: leerás tu definición y actuarás desde ahí. Esa es la diferencia entre desear autoestima y tenerla instalada.",
    ejercicio: "Escribe tu nueva definición: «Soy una persona que…» — 10 líneas en presente, basadas en la evidencia de estas semanas (incluye lo que demostraste al atravesar esto: {frag}). Termina con dos frases: «Ya no acepto…» y «De aquí en adelante merezco…». Guárdala donde puedas releerla.",
    historia: "Si tuvieras que contar tu historia empezando por quién eres HOY (no por lo que te pasó), ¿cómo empezaría ese relato? Escríbelo.",
    accion: "Lee tu definición en voz alta, grabándote si puedes. Escucharte decirla es parte del entrenamiento. Mañana: test de cierre del ciclo." }
  ]
},
];

/* ==========================================================
   TEMA 2 — LÍMITES
   ========================================================== */
window.REAVIVA_F2_THEMES.push(
{ id: "limites", nombre: "Límites",
  enfoque: "Aprender a decir no sin culpa: límites claros, calmados y con consecuencia, para proteger el valor que ya reconstruiste.",
  dias: [
  { titulo: "Un límite no es un muro",
    audioTitulo: "Un límite no es un muro",
    caso: "A Daniel le costaba decir no en el trabajo, en su familia, en todo. Terminaba agotado y resentido, y luego explotaba. Creía que poner límites era ser frío; en realidad, no ponerlos era lo que lo volvía frío.",
    guion: "Un límite no es un muro: es una puerta con reglas. El muro bloquea a todos; el límite deja pasar lo bueno y detiene lo que daña. Poner límites no te hace {duro/dura} ni egoísta: te hace claro. Y la claridad es una forma de cariño, también hacia los demás, porque nadie disfruta a un Daniel resentido que dijo sí queriendo decir no. Esta semana entrenaremos el músculo del no: pequeño, calmado y sin discursos. Un buen límite tiene tres partes: lo que necesitas, dicho en una frase; la consecuencia, dicha una sola vez; y la constancia para cumplirla. Sin gritos, sin amenazas, sin disculpas eternas. Empezamos.",
    ejercicio: "Lista 5 situaciones recientes donde dijiste sí queriendo decir no. Elige la más repetida y escribe tu límite en una sola frase, con su consecuencia calmada. Conecta con tu historia: ¿qué límite no pusiste cuando pasó esto: {frag}?",
    historia: "¿En qué área de tu vida te cuesta más poner límites: familia, trabajo, amistades o amor? Cuéntanos el ejemplo más claro.",
    accion: "Di un no pequeño hoy: sin excusas largas ni explicaciones eternas. Solo «hoy no puedo». Anota cómo se sintió." },
  { titulo: "Decir no sin culpa",
    audioTitulo: "Decir no sin culpa",
    caso: "Valeria decía no y después pasaba dos días justificándose. Sentía que debía un informe completo por cada decisión. Su amiga le preguntó: «¿desde cuándo cuidar tu paz necesita permiso?».",
    guion: "La culpa que sientes al poner un límite no significa que el límite esté mal: significa que te entrenaron para complacer. Esa culpa es un viejo reflejo, no una brújula. Un «no» completo no necesita ensayo ni anexo de justificaciones: «no puedo», «no quiero», «esta vez no» son frases enteras. Quien te quiere respeta tu no; quien solo te usa, lo negocia. Hoy practica el no seco y amable, y observa: la Tierra sigue girando, y tu paz queda intacta.",
    ejercicio: "Escribe 3 «no» que debes hace tiempo, cada uno en una frase corta y sin justificación. Agrega qué temes que pase si los dices, y qué pasó en realidad las veces que dijiste que no en el pasado. Revisa tu historia: {frag}. ¿Qué te costó no poner ese límite a tiempo?",
    historia: "Cuéntanos la última vez que pusiste un límite y te sentiste culpable. ¿La culpa tenía fundamento, o era el viejo reflejo de complacer?",
    accion: "Envía hoy uno de tus 3 «no» escritos. El más pequeño primero. El músculo se entrena con peso ligero." },
  { titulo: "Límites con tu ex",
    audioTitulo: "Límites con tu ex",
    caso: "El ex de Laura aparecía cada cierto tiempo con un «¿cómo estás?» que la desestabilizaba tres días. Ella decidió su protocolo antes de que volviera a escribir. Cuando escribió, Laura ya no improvisó.",
    guion: "Los límites más difíciles son con quien conoce tus botones. Por eso se deciden en frío: qué harás si escribe, si llama, si aparece «por casualidad». Un límite con tu ex no es venganza ni juego: es higiene emocional. Revisar sus redes «solo para ver» también rompe tu propio límite: el contacto cero incluye los ojos. Decide hoy tu protocolo completo y escríbelo. Cuando el momento llegue —y llegará—, no tendrás que pensar: solo ejecutar lo que tu yo en calma ya decidió por ti.",
    ejercicio: "Escribe tu protocolo completo: qué harás si te escribe, si te llama, si aparece en persona, si pregunta por ti con terceros. Incluye qué harás contigo esos días (a quién llamarás, qué no harás). Ten presente tu historia: {frag}.",
    historia: "¿Qué contacto mantienes hoy con tu ex, directo o por redes? Sé {honesto/honesta}: ¿ese contacto te está ayudando o te está reteniendo?",
    accion: "Ajusta hoy lo técnico: silencia, archiva o bloquea lo que tu protocolo diga. El teléfono también obedece límites." },
  { titulo: "Límites con la familia que opina",
    audioTitulo: "Límites con la familia que opina",
    caso: "«Ya deberías superarlo», «tan buen partido que era», «tú también tuviste la culpa». La familia de Marcos opinaba de todo, con amor y sin permiso. Él aprendió a cerrar la puerta sin cerrar el corazón.",
    guion: "La familia opina porque quiere ayudar, pero sus opiniones llegan con sus propios miedos y costumbres. No tienes que pelear cada comentario ni convencer a nadie de tu proceso. Un límite familiar suena así: «sé que lo dices por cariño, y justo por eso te pido que de este tema no opinemos más». Se dice una vez, con calma, y se cambia de tema las veces que haga falta. También puedes elegir qué compartes: no todo el mundo merece la versión completa de tu duelo. Reservar no es mentir; es administrar tu energía.",
    ejercicio: "Escribe las 3 frases familiares que más te duelen y prepara una respuesta corta y calmada para cada una. Decide también qué temas dejas de compartir y con quién. ¿Alguna de esas frases apareció cuando viviste esto: {frag}?",
    historia: "¿Cómo ha reaccionado tu familia a tu ruptura y tu proceso? ¿Te sientes {apoyado/apoyada} o juzgado? Cuéntalo sin filtros.",
    accion: "Usa hoy una de tus respuestas preparadas si el tema aparece. Si no aparece, elige a quién de tu familia le compartirás menos desde ahora… y a quién le abrirás más la puerta." },
  { titulo: "Tu tiempo es un límite",
    audioTitulo: "Tu tiempo es un límite",
    caso: "Daniel regalaba su tiempo a cualquiera que lo pidiera: favores, traslados, escuchas eternas a las 2 a.m. Al final del día no le quedaba nada para él. Su agenda era de todos menos suya.",
    guion: "El tiempo es el límite que nadie ve y todos cruzan. Cada «sí» automático a planes ajenos es un «no» silencioso a tu descanso, a tu proceso, a tus proyectos. No se trata de volverse {inaccesible/inaccesible}: se trata de que tu agenda te incluya. Regla práctica: antes de aceptar, pregunta «¿esto lo quiero, lo necesito, o solo me da miedo decir que no?». Si es lo tercero, es un no con una respiración de por medio. Tu semana, tu energía y tu sanación merecen estar agendadas como cualquier compromiso importante: porque lo son.",
    ejercicio: "Audita tu última semana: ¿cuántas horas diste a pedidos ajenos y cuántas a ti? Escribe 3 bloques de tiempo tuyos para esta semana, con día y hora, y protégelos como citas. ¿En qué se te iba el tiempo cuando pasó esto: {frag}?",
    historia: "¿A qué o a quién le regalaste tiempo que hoy entiendes que era tuyo? ¿Qué harías con dos horas semanales recuperadas?",
    accion: "Bloquea hoy en tu agenda el primer espacio tuyo de la semana. Innegociable: si surge un pedido, ese hueco ya está ocupado." },
  { titulo: "Cuando alguien cruza tu límite",
    audioTitulo: "Cuando alguien cruza tu límite",
    caso: "Valeria puso un límite claro con un compañero: nada de mensajes fuera de horario. Él lo «olvidó» tres veces. A la tercera, Valeria aplicó la consecuencia sin discutir. El mensaje llegó solo.",
    guion: "Un límite sin consecuencia es una sugerencia. Y las sugerencias se ignoran. Cuando alguien cruza tu límite, el paso no es explicarlo más fuerte: es aplicar la consecuencia que anunciaste, con calma y sin debate. Habrá molestia, a veces enojo. No es señal de que fallaste: es señal de que el límite empezó a existir de verdad. Las personas que te quieren ajustan; las que se van porque ya no pueden cruzarte, se van por la razón correcta. Tu constancia es el mensaje. Una sola vez basta: límite dicho, límite cumplido.",
    ejercicio: "Elige un límite que ya anunciaste y que alguien sigue cruzando. Escribe la consecuencia concreta que aplicarás la próxima vez, y el guion exacto de la frase que dirás. Piensa en tu historia: {frag}. ¿Qué consecuencia nunca aplicaste entonces?",
    historia: "Cuéntanos de una vez en que alguien cruzó un límite tuyo y no hiciste nada. ¿Qué te frenó? ¿Qué harías hoy en esa misma escena?",
    accion: "Si esta semana alguien cruza tu límite, aplica la consecuencia escrita. Si nadie lo cruza, celébralo: algo ya cambió." },
  { titulo: "Límites que te dan paz",
    audioTitulo: "Límites que te dan paz",
    caso: "Al final de la semana, Laura notó algo nuevo: dormía mejor. No había cambiado su vida entera; había cerrado tres puertas pequeñas. La paz, descubrió, muchas veces es solo eso: puertas bien cerradas.",
    guion: "Cerramos el ciclo de límites con su fruto: la paz. Un límite bien puesto no se siente como guerra; se siente como silencio bueno, como una casa ordenada. Esta semana dijiste no sin culpa, ordenaste tu tiempo, preparaste tu protocolo y aplicaste consecuencias. Guárdalo todo por escrito: tus límites son tu manual de cuidado propio, y en los días difíciles no se improvisa, se consulta. Mañana harás el test de cierre del ciclo, y después empezaremos a trabajar las recaídas: esos días en que todo lo avanzado parece temblar. Spoiler: tus límites serán tu red de seguridad.",
    ejercicio: "Escribe tu «Manual de límites» personal: los 5 límites principales de tu vida desde hoy, cada uno con su consecuencia. Incluye el que nace de tu historia: {frag}. Léelo completo y fírmalo abajo con tu nombre y la fecha.",
    historia: "Si tuvieras que resumir esta semana: ¿qué límite te dio más paz y cuál te costó más mantener? Cuenta la escena, no solo la idea.",
    accion: "Guarda tu Manual de límites en tu teléfono, con una foto o nota fijada. Mañana lo relees antes del test del ciclo." }
  ]
});

/* ==========================================================
   TEMA 3 — RECAÍDAS Y DÍAS DIFÍCILES
   ========================================================== */
window.REAVIVA_F2_THEMES.push(
{ id: "recaidas", nombre: "Recaídas y días difíciles",
  enfoque: "Entender que recaer no es fracasar: qué hacer el día en que todo duele otra vez, y cómo levantarse más rápido cada vez.",
  dias: [
  { titulo: "Recaer no es fracasar",
    audioTitulo: "Recaer no es fracasar",
    caso: "Tres meses después de su ruptura, Daniel amaneció llorando como el primer día. «Todo para nada», pensó. Su progreso no había desaparecido: estaba teniendo un día de duelo, no un regreso al inicio.",
    guion: "Escucha esto en tu día difícil: recaer no es fracasar. Sanar no es una línea recta; es una espiral. Visitas los mismos dolores, pero cada vez desde más arriba, con más herramientas y saliendo más rápido. La prueba de tu progreso no es que nunca duela: es cuánto tardas en levantarte y qué haces mientras tanto. El Daniel del día 1 se hubiera quedado en la cama escribiéndole a su ex. Tú, hoy, estás escuchando este audio. Eso también es progreso, aunque no se sienta así. Esta semana aprenderás el arte de los días difíciles: qué hacer, qué no hacer y cómo medirte con justicia.",
    ejercicio: "Compara una recaída reciente con tu peor día del inicio. Escribe 3 diferencias concretas: cuánto duró, qué hiciste, a quién buscaste. Vuelve a tu historia: {frag}. ¿Ese día te hubiera imaginado manejándolo como lo manejas hoy?",
    historia: "Cuéntanos tu recaída más reciente: ¿qué la disparó y qué hiciste? Sin juzgarte: solo los hechos y lo que sentiste.",
    accion: "Hoy escribe tu frase de emergencia y guárdala en el teléfono: «Esto es un día, no mi vida. Ya salí de esto antes»." },
  { titulo: "Conoce tus disparadores",
    audioTitulo: "Conoce tus disparadores",
    caso: "A Laura la desarmaban tres cosas: una canción, un restaurante y los domingos por la tarde. Cuando las identificó, dejaron de ser emboscadas y pasaron a ser citas conocidas que podía preparar.",
    guion: "Las recaídas casi nunca llegan de la nada: llegan por la puerta de un disparador. Una fecha, un lugar, una canción, el alcohol, el insomnio, las redes a medianoche. Conocer tus disparadores no elimina el dolor, pero elimina la sorpresa, y la sorpresa es la mitad del golpe. No se trata de evitar todo para siempre: se trata de atravesar sabiendo. Si el domingo es tu día débil, el domingo se planifica: plan con amigos, ejercicio, cama temprano. Tú no eres frágil; estás en proceso. Y los procesos se administran mejor con mapa que con suerte.",
    ejercicio: "Haz tu mapa de disparadores: 5 situaciones que te disparan el dolor o las ganas de escribirle a tu ex. Para cada una, escribe su antídoto concreto. ¿Cuál de ellos ya aparecía en tu historia: {frag}?",
    historia: "¿Cuál disparador te ha tomado más por sorpresa? Cuenta esa vez: ¿qué pasó antes, durante y después?",
    accion: "Planifica hoy tu próximo momento débil: si es la noche, agenda algo; si es un lugar, cambia la ruta. Prevención, no improvisación." },
  { titulo: "El protocolo de las 24 horas",
    audioTitulo: "El protocolo de las 24 horas",
    caso: "Marcos sintió el impulso de escribirle a su ex a la 1 a.m. En vez de enviarlo, aplicó su protocolo: mensaje escrito en notas, teléfono lejos, ducha fría, dormir. A la mañana siguiente borró la nota con las manos firmes.",
    guion: "En una recaída no decides bien porque decides herido. Por eso existe el protocolo de las 24 horas: ninguna decisión importante, ningún mensaje, ninguna «última conversación» mientras el dolor esté en su pico. Escribes lo que sientes en una nota que nadie leerá, aplicas algo físico —agua fría, caminata, respiración— y duermes. El 90% de los impulsos de recaída mueren antes del desayuno. Y el 10% que sobrevive se atiende mañana, con calma, con tu protocolo de límites abierto. Tu yo de mañana te lo va a agradecer. Él siempre lo agradece.",
    ejercicio: "Escribe tu protocolo personal de 24 horas, paso a paso: qué harás con el impulso de escribir, con el cuerpo, con el teléfono y con la noche. Incluye el nombre de tu persona de emergencia. Revísalo contra tu historia: {frag}. ¿Qué paso te hubiera salvado ese día?",
    historia: "Cuéntanos de un impulso que seguiste en el pasado (un mensaje, una llamada, una visita). ¿Qué pasó después? Sé {detallado/detallada}: es material de aprendizaje, no de vergüenza.",
    accion: "Guarda tu protocolo donde lo veas en el momento difícil: nota fijada en el teléfono y papel en la mesa de noche." },
  { titulo: "No rompas todo por un día malo",
    audioTitulo: "No rompas todo por un día malo",
    caso: "Después de semanas de contacto cero, Valeria le escribió a su ex en una noche mala. Al día siguiente creyó que había quemado todo su avance. Su avance seguía ahí: solo tenía una mancha, no un incendio.",
    guion: "Si ya rompiste una regla —escribiste, miraste, caíste— escucha: un día malo no quema un proceso. Lo que sí lo quema es la frase «ya la regué en todo, da igual seguir». Esa frase es la verdadera recaída. La recuperación sana hace otra cosa: reconoce, registra qué pasó, ajusta el plan y retoma al día siguiente sin ceremonias de castigo. La constancia no es nunca fallar; es volver rápido. Cada vuelta rápida fortalece el músculo que importa. Sé tan firme con tu proceso como compasivo contigo: no eres tu peor noche.",
    ejercicio: "Si tuviste una caída reciente, escríbela en formato de informe: hechos, disparador, qué funcionó del protocolo, qué ajustarás. Si no la tuviste, escribe el informe preventivo de tu escena de mayor riesgo, apoyándote en tu historia: {frag}.",
    historia: "¿Cómo te tratas después de fallarte a ti {mismo/misma}? ¿Castigo o aprendizaje? Cuenta la última vez y cómo te hablaste.",
    accion: "Define hoy tu «regla de retorno»: la acción mínima con la que retomas el proceso tras un día malo (ej.: caminar 20 min y completar el audio del día). Escríbela." },
  { titulo: "El cuerpo en los días difíciles",
    audioTitulo: "El cuerpo en los días difíciles",
    caso: "En sus peores días, Daniel no podía «pensar positivo». Pero podía ducharse, comer algo caliente y caminar diez minutos. Descubrió que el cuerpo era la puerta de emergencia cuando la mente estaba bloqueada.",
    guion: "Cuando la mente está secuestrada por el dolor, no se razona: se regula el cuerpo. El sistema nervioso entiende otro idioma: agua fría en la cara, respiración lenta con exhalaciones largas, luz del sol, movimiento, comida real, sueño protegido. Ninguna de estas cosas «resuelve» tu duelo, pero todas bajan el volumen lo suficiente para que puedas pensar otra vez. En los días difíciles, baja la vara: no se trata de avanzar, se trata de no retroceder en lo básico. Ducha, comida, caminata, cama. Mañana se evalúa; hoy se sostiene.",
    ejercicio: "Escribe tu kit corporal de emergencia: 5 acciones físicas ordenadas de menor a mayor esfuerzo, listas para ejecutar sin pensar. Prueba hoy la primera aunque estés bien, para entrenarla. Recuerda cómo se sentía tu cuerpo cuando pasó esto: {frag}.",
    historia: "¿Cómo se manifiesta tu dolor en el cuerpo: insomnio, nudo en el pecho, falta de apetito, cansancio? ¿Qué has notado que de verdad te ayuda?",
    accion: "Ejecuta hoy una acción de tu kit como práctica: caminata de 10 minutos sin teléfono, prestando atención a la respiración." },
  { titulo: "Pide ayuda antes del fondo",
    audioTitulo: "Pide ayuda antes del fondo",
    caso: "Laura esperaba a estar «insoportable» para pedir ayuda. Su red de apoyo le enseñó otra cosa: la llamada a tiempo vale diez veces más que la llamada desde el fondo.",
    guion: "Hay una creencia cara: «no quiero molestar». Nadie que te quiere siente tu llamada de auxilio como una molestia; la siente como confianza. Pedir ayuda antes del fondo no es debilidad: es administración inteligente de tus recursos. Prepara el terreno hoy, en calma: avísale a tu persona de emergencia que es tu persona de emergencia. Suena obvio, pero en la crisis no se improvisa ni eso. Y si un día la tristeza se vuelve constante, pesada, de semanas enteras sin alivio, la ayuda correcta es profesional: buscar apoyo terapéutico también es un acto de amor propio, del bueno, del que se hace cargo.",
    ejercicio: "Designa oficialmente a tu persona (o personas) de emergencia y escribe qué puedes pedirle en concreto: escucha, compañía, que te quite el teléfono, que te acompañe a caminar. Relaciónalo con tu historia: ¿quién estuvo cuando viviste esto: {frag}?",
    historia: "¿Te cuesta pedir ayuda? ¿De dónde crees que viene eso? Cuéntanos de una vez que pediste ayuda y funcionó… o de una vez que no pediste y lo pagaste.",
    accion: "Envía hoy el mensaje: «Estoy en un proceso de sanación. Si algún día te llamo en un momento difícil, solo necesito que me escuches. ¿Puedo contar contigo?»." },
  { titulo: "Medir el progreso de verdad",
    audioTitulo: "Medir el progreso de verdad",
    caso: "Al final de su peor semana, Marcos revisó sus marcas: sus recaídas duraban horas, ya no días. Escribía en su diario en vez de escribirle a su ex. «No estoy donde quiero», escribió, «pero ya no estoy donde estaba».",
    guion: "Cerramos el ciclo midiendo con justicia. Tu progreso de verdad se ve en tres números: cuántos días difíciles tienes, cuánto duran y qué haces en ellos. Si antes un disparador te costaba una semana y hoy te cuesta una tarde, ganaste, aunque duela. El dolor no es el medidor; la recuperación sí. Mañana harás el test de cierre del ciclo. Y luego abrimos un tema delicado y liberador: el rencor. Eso que queda cuando ya no extrañas a la persona, pero todavía le cobras la historia. Tus días difíciles serán más ligeros cuando esa cuenta se cierre.",
    ejercicio: "Construye tu tabla de progreso: para las últimas 3 recaídas (o días difíciles), anota fecha, disparador, duración y qué hiciste. Compáralas con la primera vez que viviste algo así: {frag}. Escribe tu conclusión en una frase honesta.",
    historia: "Si hoy te visitara tu yo del primer día de este programa, ¿qué le dirías sobre cómo manejas los días difíciles ahora? Escríbeselo directamente.",
    accion: "Deja tu protocolo y tu kit visibles en casa. Mañana, antes del test, relee tu tabla de progreso y entra con evidencia, no con sensaciones." }
  ]
});

/* ==========================================================
   TEMA 4 — SOLTAR EL RENCOR
   ========================================================== */
window.REAVIVA_F2_THEMES.push(
{ id: "rencor", nombre: "Soltar el rencor",
  enfoque: "Cerrar la cuenta emocional pendiente: entender el rencor, dejar de ensayar venganzas y perdonar como acto de libertad personal (no de reconciliación).",
  dias: [
  { titulo: "El rencor es un alquiler caro",
    audioTitulo: "El rencor es un alquiler caro",
    caso: "Daniel repetía: «no puedo creer lo que me hizo». Cada repetición era un día más viviendo dentro de la misma escena. Su ex ya no estaba, pero el rencor le seguía cobrando renta en su propia cabeza.",
    guion: "El rencor es pagar alquiler por vivir en un lugar que odias. La persona que te hirió sigue con su vida mientras tú repasas la deuda cada mañana. Ojo: soltar el rencor no es decir «no pasó nada» ni «estuvo bien». Pasó y estuvo mal. Soltar es otra decisión: dejar de cobrar una deuda que solo estás pagando tú. Perdonar, en este ciclo, no significa reconciliarse ni volver: significa cancelar el contrato mental que te ata a esa historia todos los días. Lo haces por tu paz, no por su absolución. Esta semana cerramos la cuenta, paso a paso, sin ingenuidad y sin prisa fingida.",
    ejercicio: "Escribe la «factura emocional»: todo lo que tu rencor le cobra a esa persona, punto por punto. Al final, suma lo que te ha costado A TI cobrarla: tiempo, sueño, alegría. Apóyate en tu historia: {frag}.",
    historia: "¿Qué es exactamente lo que no logras soltar? No el hecho general: la escena, la frase, el momento exacto que se repite en tu cabeza.",
    accion: "Hoy, cada vez que tu mente ensaye la escena, di: «ya la pagué bastante» y cambia físicamente de lugar. Registro de una semana." },
  { titulo: "Lo que ensayas, te daña",
    audioTitulo: "Lo que ensayas, te daña",
    caso: "Valeria ensayaba conversaciones: «ojalá le hubiera dicho…». Ganaba todas las discusiones en su cabeza y perdía todas las mañanas en la vida real. Decidió ensayar otra cosa: su nueva vida.",
    guion: "Tu cerebro no distingue bien entre la escena vivida y la escena ensayada: cada ensayo de venganza o de «lo que debí decir» reactiva el mismo estrés en tu cuerpo. Por eso sales agotado de discusiones que ni siquiera ocurrieron. La salida no es «no pensar», es dar una orden de reemplazo: cuando el ensayo empiece, pregúntate «¿esto me está construyendo o me está cobrando?». Y luego redirige el ensayo hacia algo tuyo: tu proyecto, tu cuerpo, tu próxima etapa. No es negación; es administración de tu energía mental.",
    ejercicio: "Identifica tus 3 ensayos más repetidos (la conversación perfecta, la venganza, la escena de «que me vea bien»). Escribe para cada uno su reemplazo: en qué vas a pensar o hacer cuando aparezca. Uno de ellos nace de esto: {frag}.",
    historia: "¿Qué conversación ensayas una y otra vez? Escríbela completa aquí, por primera y última vez: todo lo que dirías, sin filtro.",
    accion: "Instala hoy tu frase-corte: cuando el ensayo empiece, di tu frase («esto me cobra, no me construye») y ejecuta tu reemplazo. Cuenta cuántas veces lo logras." },
  { titulo: "La disculpa que nunca llegará",
    audioTitulo: "La disculpa que nunca llegará",
    caso: "Marcos esperó dos años un «perdón» que nunca llegó. El día que entendió que su paz no podía depender de la boca de otro, empezó a sanar en serio: cerró él la cuenta que otro dejó abierta.",
    guion: "Quizá esperas una disculpa para poder cerrar. Pero hay disculpas que nunca llegan: porque el otro no puede, no quiere o no entiende. Si tu paz espera ese correo, tu paz está tercerizada. Cerrar sin disculpa no es rendirse: es asumir que tu sanación tiene firma propia. Tú puedes declarar la deuda incobrable y darla por terminada, no porque no valga, sino porque cobrarla te cuesta más que el monto. La falta de disculpa habla de quien no la dio, no de lo que tú merecías. Merecías el perdón pedido. Y aun así puedes soltar. Las dos cosas son verdad a la vez.",
    ejercicio: "Escribe la disculpa que merecías escuchar, palabra por palabra, en voz de esa persona. Léela en voz alta. Ahora escribe debajo: «esta disculpa no llegó. Mi paz no la espera más». Conéctalo con tu historia: {frag}.",
    historia: "¿Qué disculpa esperas todavía, de quién, y cómo imaginas que cambiaría tu vida si llegara? Sé {específico/específica}.",
    accion: "Hoy haz un gesto de cierre tuyo: borra un chat, archiva una foto, elimina un objeto ancla. Un acto físico para una declaración interna." },
  { titulo: "Perdonarte a ti también",
    audioTitulo: "Perdonarte a ti también",
    caso: "Laura no solo estaba enojada con su ex: estaba furiosa consigo misma. «¿Cómo no lo vi? ¿Cómo aguanté tanto?». Su rencor más pesado era hacia adentro, y era el que menos se permitía mirar.",
    guion: "Suele sobrar rencor hacia uno mismo: por haber elegido, por haber aguantado, por no haber visto las señales. Pero juzgas tu pasado con la información de hoy, y eso es un juicio injusto. La persona que se quedó no tenía el mapa que tienes tú ahora; lo estaba dibujando, a ciegas y enamorada. Perdonarte no es decir «todo lo hice bien»: es decir «hice lo que pude con lo que sabía, y de esa experiencia salió este aprendizaje». La culpa que enseña una vez es útil; la que se repite cien veces ya es solo castigo. Esta parte del ciclo suele doler más que la otra. Ve despacio, con la misma compasión que le tendrías a alguien a quien quieres mucho.",
    ejercicio: "Escribe tu lista de auto-reproches. Para cada uno, responde dos cosas: qué no sabías entonces, y qué sabes ahora gracias a eso. Cierra con una carta corta de perdón hacia ti, retomando tu historia: {frag}.",
    historia: "¿Qué es lo que menos te perdonas de toda esta historia? Cuéntalo como si lo contará tu mejor amigo defendiéndote.",
    accion: "Hoy, cuando aparezca el auto-reproche, responde con tu frase de defensa: «actué con lo que sabía; hoy sé más». Regístralo." },
  { titulo: "Justicia sin venganza",
    audioTitulo: "Justicia sin venganza",
    caso: "Daniel tuvo la oportunidad perfecta de «devolverla». Tenía información que podía dañar a su ex. La pensó toda una noche… y eligió no usarla. No por ella: por no convertirse en eso.",
    guion: "La venganza promete equilibrio y entrega otra cadena: te convierte en administrador permanente de la vida de quien te dañó. La justicia íntima, en cambio, no necesita público ni castigo: consiste en que tu vida mejore al punto de que esa historia deje de ser el centro. La mejor «respuesta» jamás escrita es una vida reconstruida, y no se la mandas a nadie: la vives. Si hubo daños reales —dinero, acuerdos, hijos— se atienden por las vías correctas, con cabeza fría y asesoría, no con impulso. Eso también es justicia, y es aburrida, adulta y libre de rencor.",
    ejercicio: "Separa en dos columnas: «asuntos prácticos pendientes» (dinero, objetos, trámites, acuerdos) y «cuentas emocionales». Para la primera columna, define el paso concreto y frío para cerrar cada asunto. Para la segunda, declara tu decisión: {frag}.",
    historia: "¿Has fantaseado con alguna venganza? Cuéntala aquí sin miedo. ¿Qué necesidad real había debajo: justicia, reconocimiento, que sufriera lo mismo?",
    accion: "Ejecuta hoy un paso práctico de tu primera columna (un mensaje formal, una cita, un trámite). Cerrar lo práctico aligera lo emocional." },
  { titulo: "Escribe la carta de cierre",
    audioTitulo: "Escribe la carta de cierre",
    caso: "Valeria escribió su carta de cierre durante tres noches. No era para enviarla: era para vaciar. En la última línea escribió: «ya no necesito que entiendas». La quemó en su patio y durmió como hacía meses no dormía.",
    guion: "Hoy escribes tu carta de cierre. No es una carta para enviar: es una carta para vaciar el tanque. En ella cabe todo: el reclamo, el agradecimiento por lo poco bueno, la despedida y la declaración de que tu vida sigue sin esa dirección. Escribirla con destino cerrado tiene un poder especial: nadie te interrumpe, nadie negocia tu versión, nadie la convierte en una nueva discusión. Cuando termines, tú decides el ritual: guardarla, romperla o quemarla con cuidado. El ritual marca la fecha. A partir de hoy, tu historia con esa persona tiene un final escrito por ti. Y los finales bien escritos dejan de doler como heridas abiertas: duelen como cicatrices, que es otra temperatura.",
    ejercicio: "Escribe la carta completa, sin límite de extensión dentro del ejercicio: saludo, lo que dolió, lo que aprendiste, lo que ya no será, despedida. No la edites mientras la escribes; la honestidad primero. Retoma el inicio de tu historia: {frag}, y ciérralo con tus palabras de hoy.",
    historia: "Antes de escribir la carta, responde aquí: ¿qué necesitas que esta carta logre en ti? ¿Vaciar, cerrar, despedir, perdonarte? Di tu intención en tres líneas.",
    accion: "Haz el ritual hoy mismo: lee la carta en voz alta una vez y luego rómpela, quémala (con cuidado) o ciérrala bajo llave. Fecha registrada: es tu día de cierre." },
  { titulo: "La paz después del rencor",
    audioTitulo: "La paz después del rencor",
    caso: "Semanas después de su carta, Marcos se cruzó con noticias de su ex y sintió… poco. Ni euforia ni dolor: indiferencia tranquila. «Ahí supe que la cuenta estaba cerrada de verdad».",
    guion: "Cerramos el ciclo del rencor mirando su fruto: la indiferencia serena. No la frialdad disfrazada, sino esa calma nueva en la que la otra persona deja de ser el tema de tus mañanas. El rencor puede reaparecer en ráfagas; ya sabes el camino: nombrar, cortar el ensayo, recordar la carta, seguir con tu vida. Mañana harás el test de cierre del ciclo, y luego entramos en territorio esperanzador: volver a confiar. No en cualquiera ni a ciegas, sino con la sabiduría que todo este proceso te ha dado. La paz que hoy sientes es tu nuevo punto de partida, no una tregua frágil.",
    ejercicio: "Haz el balance del ciclo: qué frase, escena o cuenta lograste soltar; cuál sigue pesando y qué paso sigue para ella. Escribe también qué espacio mental y de tiempo recuperaste, y en qué lo vas a invertir. Relaciona tu balance con el comienzo de tu historia: {frag}.",
    historia: "Describe un momento reciente en el que notaste que el rencor pesaba menos. ¿Qué estabas haciendo? ¿Qué pensaste al darte cuenta?",
    accion: "Celebra el cierre hoy con un acto de vida, no de duelo: una comida rica, una salida, un plan con tu gente. La paz también se practica festejándola." }
  ]
});

/* ==========================================================
   TEMA 5 — VOLVER A CONFIAR
   ========================================================== */
window.REAVIVA_F2_THEMES.push(
{ id: "confiar", nombre: "Volver a confiar",
  enfoque: "Reconstruir la confianza sin ingenuidad: confiar primero en tu propio criterio y luego, poco a poco, en los demás.",
  dias: [
  { titulo: "Confiar no es ser ingenuo",
    audioTitulo: "Confiar no es ser ingenuo",
    caso: "«Yo ya no confío en nadie», decía Daniel como un trofeo. Pero vivía cansado: revisar, sospechar y anticipar traiciones agota más que el golpe original. Su desconfianza total también era una prisión.",
    guion: "Después de una traición, la desconfianza total parece protección. Pero tiene un costo altísimo: vives en guardia permanente, y nadie sana en estado de alerta. Confiar de nuevo no significa volver a ser la persona que no veía señales. Volver a confiar es un proceso en dos pisos: primero confías en ti —en tu criterio, tus límites y tu capacidad de irte si algo está mal— y solo después confías en otros, por cuotas, según se lo ganen. La confianza madura no es ciega: es verificada. Esta semana reconstruimos así: por pisos, con evidencia, sin prisa y sin cinismo.",
    ejercicio: "Describe tu nivel actual de confianza en tres círculos: en ti, en las personas conocidas, en las personas nuevas. Califica cada uno del 1 al 10 y justifica con ejemplos. Apóyate en tu historia: {frag}. ¿Dónde se rompió exactamente tu confianza?",
    historia: "¿Qué fue lo que más daño le hizo a tu capacidad de confiar? La escena o el descubrimiento que todavía defines como «antes y después».",
    accion: "Hoy haz un acto pequeño de confianza en ti: date una instrucción (una hora, una tarea) y cúmplela. Tu criterio se entrena cumpliéndote." },
  { titulo: "Confía primero en tu criterio",
    audioTitulo: "Confía primero en tu criterio",
    caso: "Laura repasó su historia y notó algo incómodo: vio las señales desde el principio. No falló su intuición: falló su permiso para hacerle caso. Ese descubrimiento, bien leído, era una buena noticia.",
    guion: "La frase clave de este ciclo es incómoda y liberadora: tu intuición funcionó; lo que falló fue obedecerla. Eso significa que no necesitas «un radar nuevo»: necesitas darle poder de veto al que ya tienes. Confiar en tu criterio se entrena como todo: con registro. Anota tus corazonadas y luego verifica qué pasó. En semanas tendrás datos de que tu radar sirve, y la próxima vez que suene podrás decir: «ya pasé por ignorar esto; no lo hago más». Tu criterio es hoy tu mejor sistema de seguridad. Y funciona sin necesidad de que nadie más sea confiable todavía.",
    ejercicio: "Escribe 3 momentos de tu historia en los que tu intuición avisó y no le hiciste caso (apóyate en {frag}). Para cada uno: ¿qué sentiste en el cuerpo, qué te dijiste para ignorarlo, qué pasó al final? Cierra escribiendo tu nueva regla: «cuando mi cuerpo diga ___ , voy a ___».",
    historia: "¿Recuerdas la primera señal que ignoraste? Cuéntala con lujo de detalle: ¿qué excusa le pusiste en ese momento?",
    accion: "Lleva desde hoy un registro simple en notas: fecha, corazonada, qué pasó después. En 30 días lo revisas: es la auditoría de tu radar." },
  { titulo: "Confianza por cuotas",
    audioTitulo: "Confianza por cuotas",
    caso: "Valeria volvió a salir con amigas y conocidos con una regla nueva: nadie recibe confianza completa «de paquete». La entrega en cuotas, contra entregas: palabra cumplida, respeto mostrado, constancia vista.",
    guion: "La confianza no es un interruptor de encendido y apagado: es una escalera. El error del pasado no fue confiar; fue entregarlo todo en la planta baja. Desde hoy, la confianza se concede por niveles y contra evidencia: constancia, coherencia entre palabra y acto, respeto a tus límites. Quien sube, sube porque cumple; quien falla baja solo, sin drama y sin discursos. Esto aplica a amistades, familia y futuros amores. Y aplica al revés también: no exijas de golpe que confíen plenamente en ti si estás reconstruyendo. La escalera se sube peldaño a peldaño, de ambos lados. Así deja de dar miedo: nadie puede caerse desde muy alto si estás en el segundo peldaño.",
    ejercicio: "Diseña tu escalera personal: 4 niveles de confianza (qué se gana en cada nivel: tiempo, confidencias, planes, vulnerabilidad) y qué evidencia pide cada subida. Revisa con quiénes de tu vida actual estás en cada nivel. Ten presente tu historia: {frag}. ¿A quién le diste el último nivel sin pasar por los otros?",
    historia: "¿Alguna vez entregaste confianza total muy rápido? ¿Qué pasó? ¿Y alguna vez alguien se la ganó paso a paso contigo? Compara ambas historias.",
    accion: "Ubica hoy, con honestidad, a una persona clave en su nivel real (quizá más bajo del que ocupaba) y ajusta lo que compartes con ella desde esta semana." },
  { titulo: "Señales de gente confiable",
    audioTitulo: "Señales de gente confiable",
    caso: "Marcos hizo su lista inversa: en vez de estudiar banderas rojas, estudió las verdes. «Cumple lo que promete, incluso lo pequeño. Dice que no sin temblar. Respeta a quien no necesita». Su filtro cambió por completo.",
    guion: "Estamos entrenados para cazar banderas rojas, y hace falta. Pero la confianza se construye reconociendo las verdes: coherencia entre palabra y hecho, respeto por los límites ajenos, responsabilidad cuando se equivocan, trato amable con quien no puede darles nada. La gente confiable suele ser aburrida en el mejor sentido: predecible, constante, sin picos de euforia ni desapariciones. Si el inicio con alguien se siente como una montaña rusa, probablemente no es pasión: es inestabilidad con buen marketing. Aprende a leer lo estable como atractivo. Tu sistema nervioso, después de todo lo vivido, confunde calma con aburrimiento. Recalibremos eso también.",
    ejercicio: "Escribe tu lista de 8 señales verdes (conductas concretas y observables) y al lado, para calibrar, 4 señales de inestabilidad disfrazada. Compáralas con tu experiencia: {frag}. ¿Qué señales verdes ignoraste en el pasado porque «no emocionaban»?",
    historia: "Piensa en la persona más confiable de tu vida. ¿Qué hace, exactamente, para serlo? Escríbelo como un retrato de conductas, no de intenciones.",
    accion: "Reconoce hoy a alguien confiable de tu entorno: un mensaje, una mención. Nombrar lo bueno también entrena el radar." },
  { titulo: "Lo que harás distinto",
    audioTitulo: "Lo que harás distinto",
    caso: "«¿Y si me vuelve a pasar?», le preguntó Daniel a su hermana. Ella respondió: «no es la pregunta. La pregunta es: si pasa, ¿cuánto tardas en irte? Antes tardaste años. Hoy tardarías semanas». Esa diferencia lo tranquilizó más que cualquier promesa.",
    guion: "El miedo real no es «¿y si me engañan otra vez?». El miedo real es «¿y si otra vez no me voy a tiempo?». Y ahí está tu garantía más sólida: ya no eres la persona que se quedó años. Conoces las señales, tienes límites escritos, sabes pedir ayuda y ya demostraste que puedes atravesar un final. Confiar no exige que nada malo vuelva a pasar; exige saber que, si pasa, actuarás distinto y sobrevivirás. Lo ya lo hiciste una vez: está en tu historia. Este ciclo te deja un plan, no solo una esperanza: tus reglas de entrada, tus tiempos de observación y tus líneas de salida. Con eso se puede volver a abrir el corazón sin dejar la puerta sin llave.",
    ejercicio: "Escribe tu «protocolo de salida sana»: 3 señales que, de verlas en una relación futura, activan conversación; y 2 que activan retirada sin negociación. Especifica tiempos (¿cuánto observas antes de decidir?). Ilústralo con lo que viviste: {frag}.",
    historia: "Imagina que una futura pareja hace mañana exactamente lo primero que te hirió en tu historia. ¿Qué harías hoy, paso a paso? Escríbelo en presente, como un guion que ya te sabes.",
    accion: "Comparte tu protocolo con tu persona de emergencia. Que alguien más lo conozca lo vuelve más difícil de romper en un momento débil." },
  { titulo: "Confiar en el proceso",
    audioTitulo: "Confiar en el proceso",
    caso: "Laura dudaba algunos días: «¿y si todo este trabajo no sirve?». Su respuesta la encontró en su propio diario: releyó su primera semana y no se reconoció. El cambio no se veía día a día; se veía archivo contra archivo.",
    guion: "Hay una confianza más silenciosa: la confianza en tu proceso. No se siente todos los días; se verifica por temporadas. Por eso llevas registros: tu historia, tus diarios, tus tests. Ellos no mienten ni exageran: muestran la distancia entre quien empezó y quien eres hoy. Cuando dudes, no te midas con sentimientos del momento: mídete con archivo. Leer tu primera semana y tu última es la auditoría objetiva de tu avance. Este programa entero es la demostración de que cumplirte, día a día, funciona. Sigue cumpliéndote con la misma receta después de los 30 días: constancia pequeña, evidencia guardada, ajuste sin drama.",
    ejercicio: "Haz tu auditoría del proceso: relee tu historia del día 1 y una reciente. Escribe 5 diferencias concretas entre ambas versiones de ti (tono, claridad, decisiones, cuerpo, esperanza). Una de tus primeras páginas decía esto: {frag}. ¿Qué le respondes hoy?",
    historia: "Escribe una carta breve a tu yo de los primeros días: qué le dirías de lo que viene, sin arruinarle las sorpresas buenas, pero dándole la fuerza que necesitaba.",
    accion: "Guarda esa carta donde guardas tu Manual de límites. Es tu par de documentos fundacionales: reglas y motivo." },
  { titulo: "Corazón abierto, ojos abiertos",
    audioTitulo: "Corazón abierto, ojos abiertos",
    caso: "Al cerrar el ciclo, Valeria lo resumió así en su diario: «No volví a ser la de antes. Soy otra: confío, pero verifico; abro, pero observo; amo, pero primero me amo». Esa frase quedó como su firma.",
    guion: "Cerramos el ciclo de confiar con la fórmula que lo resume: corazón abierto, ojos abiertos. Ni la fortaleza cerrada que no deja entrar a nadie, ni la entrega ciega que no ve venir nada. Las dos cosas a la vez: capacidad de vínculo y capacidad de lectura. Mañana harás el test de cierre del ciclo. Lo que sigue es uno de los temas más hermosos del proceso: el amor propio llevado a propósito —descubrir qué quieres construir con esta segunda oportunidad de vida—. Llegas con autoestima, límites, red de seguridad, rencor soltado y un radar calibrado. Es una buena base para construir lo que viene.",
    ejercicio: "Escribe tu manifiesto de confianza: 6 frases que empiecen con «De aquí en adelante…» combinando apertura y criterio (ej.: «De aquí en adelante confío por cuotas y verifico con calma»). Ilustra cada frase con una lección de tu historia ({frag}).",
    historia: "¿Cómo imaginas tu forma de confiar dentro de un año? Descríbete en esa versión: cómo eliges, qué observas, qué ya no temes.",
    accion: "Elige tu frase favorita del manifiesto y ponla junto a tu definición de ti (ciclo de autoestima). Tu carpeta de documentos personales crece." }
  ]
});


/* ==========================================================
   TEMA 6 — AMOR PROPIO Y PROPÓSITO
   ========================================================== */
window.REAVIVA_F2_THEMES.push(
{ id: "proposito", nombre: "Amor propio y propósito",
  enfoque: "Pasar de recuperarte a construirte: rutinas de amor propio real y un propósito que le dé dirección a tu nueva etapa.",
  dias: [
  { titulo: "Amor propio: hechos, no frases",
    audioTitulo: "Amor propio: hechos, no frases",
    caso: "«Debería quererme más», decía Marcos, mientras aceptaba trabajos mal pagados, dormía 4 horas y decía sí a todo. El día que cobró lo justo, durmió y dijo un no, entendió: el amor propio se practica, no se declara.",
    guion: "El amor propio no es una frase en una taza: es cómo te tratas cuando nadie mira. Es lo que comes, lo que aceptas, lo que toleras, lo que cobras, lo que callas. Se mide en hechos pequeños y repetidos: dormir lo suficiente, decir no a lo que te hace daño, pedir lo que vales, darte tiempo sin culpa. La buena noticia es que ya practicas varias de esas cosas desde que entraste a este proceso; este ciclo las ordena en un sistema. Y abre la pregunta grande: ya que sobreviviste y te reconstruiste… ¿para qué? ¿Qué quieres construir con esta segunda mitad de tu historia? Esa pregunta se llama propósito, y esta semana empezamos a responderla sin presión y con método.",
    ejercicio: "Audita tu amor propio en hechos: califica del 1 al 10 cómo te tratas en cuerpo, dinero, trabajo, relaciones y tiempo libre. Elige el área más baja y escribe 3 actos concretos para subirla un punto este mes. Retoma tu historia: {frag}. ¿Qué acto de amor propio te hubiera cambiado ese capítulo?",
    historia: "¿Cuándo fue la última vez que hiciste algo claramente por amor a ti? Cuéntalo. ¿Qué se sintió diferente a «hacer algo por obligación»?",
    accion: "Ejecuta hoy el primer acto de tu lista: uno solo, pequeño y visible. El amor propio se inaugura con hechos." },
  { titulo: "Tu diálogo interno amable",
    audioTitulo: "Tu diálogo interno amable",
    caso: "Daniel notó que a su hija jamás le hablaría como se hablaba a sí mismo. Empezó a corregirse en voz baja: «eso se dice mejor así». Su tono interno cambió antes que sus circunstancias. Y eso empezó a cambiarlas.",
    guion: "Pasas más tiempo contigo que con nadie: tu diálogo interno es el clima donde vives. Un clima de crítica constante desgasta cualquier proceso; uno de trato amable lo sostiene todo. No se trata de mentirte («todo está perfecto») sino de hablarte con la justicia y la calidez con que le hablarías a alguien que quieres: «hoy me salió mal; mañana lo intento de nuevo; estoy aprendiendo». La técnica es simple y diaria: detecta la frase dura, escríbela, reescribela en versión aliada y repítela. Con semanas de práctica, la versión aliada empieza a salir sola. Ya trabajaste la voz crítica en el ciclo de autoestima; ahora construimos la voz que la reemplaza: tu aliada permanente.",
    ejercicio: "Recoge hoy 5 frases que te digas a ti {mismo/misma} en un día normal. Reescribe cada una en voz aliada (firme, pero amable). Luego conecta con tu historia: ¿cuál frase dura nació de esto: {frag}? Reescríbela también, con especial cuidado.",
    historia: "¿Cómo era el tono de tu casa cuando hablabas de errores, de niño? ¿De quién aprendiste a hablarte como te hablas? Cuéntalo sin juzgar a nadie: solo el origen.",
    accion: "Elige tu frase aliada favorita y úsala en voz alta cada vez que te equivoques hoy. Regístrala en el teléfono para tenerla a mano en los momentos difíciles." },
  { titulo: "Lo que te gustaba antes",
    audioTitulo: "Lo que te gustaba antes",
    caso: "Antes de su relación, Laura dibujaba. Dejó el cuaderno «para después» durante años. Al retomarlo, lloró con el primer trazo: no por tristeza, sino por reencuentro. Había una persona esperándola en ese cuaderno.",
    guion: "Las relaciones que duelen suelen quedarse con tus gustos por el camino: el deporte que dejaste, la música que no sonó más, el pasatiempo que «no tenía tiempo». Recuperarlos no es nostalgia: es recuperación de identidad. Cada gusto retomado le dice a tu cerebro «esta es mi vida, y me gusta». Además, el propósito rara vez aparece en una revelación: aparece siguiendo hilos de interés viejo, probando, aburrirse poco, curiosear mucho. Esta semana rescata un hilo: algo que te gustaba antes de todo esto y que merece una segunda oportunidad, aunque sea en versión pequeña. No tiene que «servir» para nada más que para devolverte a ti.",
    ejercicio: "Haz el inventario de lo perdido: 10 cosas que te gustaban antes (hobbies, lugares, músicas, comidas, gente) y marcaste en pausa por la relación o el duelo. Elige 1 para retomar esta semana y diseña su versión mínima. ¿Qué gustos ya aparecían amenazados en tu historia: {frag}?",
    historia: "Cuéntanos quién eras antes de esta historia en tus gustos y pasiones. ¿Qué versión de ti extrañas más y por qué la fuiste dejando?",
    accion: "Hoy mismo ejecuta la versión mínima de tu gusto rescatado: 20 minutos cuentan. Fecha y foto en tu registro: evidencia de reencuentro." },
  { titulo: "Propósito: empezar por el para quién",
    audioTitulo: "Propósito: empezar por el para quién",
    caso: "A Marcos le preguntaron qué quería hacer con su vida y se bloqueó. Pero cuando le preguntaron a quién le gustaría ayudar con lo que vivió, respondió sin dudar. Su propósito empezó por ahí: por los demás que venían detrás.",
    guion: "La pregunta «¿cuál es mi propósito?» es tan grande que paraliza. Empecemos por una versión caminable: ¿a quién podría servirle lo que tú aprendiste a la mala? ¿Qué sabes hoy —de dolor, de límites, de reconstrucción— que alguien necesita escuchar? El propósito suele tener tres ingredientes: algo que sabes hacer, algo que te importa y alguien a quien le sirve. No necesitas renunciar a tu trabajo ni fundar nada: a veces el propósito se ejerce en tu propia familia, en tu oficio, en un voluntariado de sábados. Lo importante es que tu historia deje de ser solo una herida y pase a ser también un recurso. Eso no romantiza lo que te pasó: lo redime, que es distinto.",
    ejercicio: "Completa las tres listas: «Sé hacer…», «Me importa…», «Podría servirle a…». Busca el cruce entre las tres y escribe 2 ideas de propósito caminables (que quepan en tu vida real). Cruza con tu historia: {frag}. ¿A quién le serviría exactamente eso que viviste?",
    historia: "Escribe tu respuesta honesta: si tuvieras que darle un sentido a todo lo que pasaste, ¿cuál sería? No la versión bonita: la que de verdad te mueve hoy.",
    accion: "Cuéntale tu idea de propósito a una persona de confianza. Decirla en voz alta la vuelve un compromiso en vez de un deseo." },
  { titulo: "Una meta de 90 días",
    audioTitulo: "Una meta de 90 días",
    caso: "Daniel pasó de «quiero rehacer mi vida» (inmenso, borroso) a una meta de 90 días: certificar el curso que dejó a mitad y caminar 5 km sin parar. Al día 90 tenía dos medallas invisibles y una certeza: «puedo construir, no solo sobrevivir».",
    guion: "El propósito se vuelve real con una meta de 90 días. Noventa días son suficientes para un cambio visible e insuficientes para abrumarte toda la vida. La fórmula: una sola meta principal, medible, con pasos semanales y revisión los domingos. Es el mismo sistema que te trajo hasta aquí —un día a la vez, con registro—, ahora apuntando a construir en vez de a sanar. Elige algo que te ilusione de verdad, no lo que «deberías». Puede ser salud, dinero, estudio, tu oficio, tu proyecto. Tu sistema de diario y registros ya sabe cómo sostenerla: solo cambia el destino del esfuerzo.",
    ejercicio: "Define tu meta de 90 días con la fórmula: qué, cuánto, para cuándo y cómo sabrás que lo lograste. Desglósala en 12 pasos semanales pequeños. Relaciónala con tu momento: ¿por qué esta meta y no otra, después de haber vivido {frag}?",
    historia: "Imagina que pasan los 90 días y logras tu meta. Escribe la escena: dónde estás, qué sientes, qué cambió en tu vida diaria. Concreta, no sueñes en general.",
    accion: "Ejecuta hoy el paso cero: la acción más pequeña de tu plan (inscribirte, apartar hora, comprar el material, contar la meta). Hoy, no el lunes." },
  { titulo: "Tu círculo y tu contribución",
    audioTitulo: "Tu círculo y tu contribución",
    caso: "Valeria empezó ayudando en el grupo de apoyo donde ella misma lloró meses atrás. «No tengo respuestas», decía, «pero sé escuchar como me escucharon». Su dolor se había convertido en oficio de acompañar.",
    guion: "El propósito crece cuando se comparte. Hay algo que solo puede dar quien ya pasó por un lugar oscuro: compañía creíble. No necesitas ser experto de nada para acompañar a alguien que hoy está donde tú estuviste: basta tu historia, tu escucha y tu constancia. Piensa en tu círculo: tu familia, tu trabajo, esta comunidad. ¿Dónde encaja tu contribución natural? Puede ser un mensaje semanal a alguien en duelo, compartir tu testimonio, enseñar lo que sabes. Contribuir además te protege: las personas con propósito recaen menos, porque su dolor encontró salida útil. Esta semana diseña tu aporte: pequeño, sostenido y desde lo que viviste.",
    ejercicio: "Diseña tu contribución: qué darás, a quién, cuándo y con qué frecuencia realista. Escríbela como un compromiso firmado. Ten presente que tu historia —esto incluido: {frag}— es el material desde el que contribuyes: ¿qué parte de tu experiencia es hoy más útil para otros?",
    historia: "¿Quién te ayudó a ti en el peor momento, y cómo? Escribe cómo te gustaría que alguien en tu situación fuera ayudado por ti dentro de un año.",
    accion: "Haz hoy el primer micro-aporte: un mensaje a alguien que la está pasando mal, sin consejos: solo presencia. «Sé lo que se siente. Aquí estoy»." },
  { titulo: "La vida que estás construyendo",
    audioTitulo: "La vida que estás construyendo",
    caso: "Al cerrar el ciclo, Laura actualizó su definición de sí misma. Le agregó una línea nueva: «Soy una persona con un proyecto». Notó que hablaba de futuro sin fingir. El dolor había dejado de ser su tema principal.",
    guion: "Cerramos el ciclo de propósito con la vista completa. Empezaste este proceso sobreviviendo; hoy hablas de construir. Esa es la diferencia que marca el amor propio maduro: ya no solo te protege del daño, te empuja hacia la vida. Tu meta de 90 días está en marcha, tu contribución definida, tu diálogo interno aliado. Mañana harás el test de cierre del ciclo. Y luego viene el tema que muchos esperan con mezcla de ilusión y miedo: prepararte para una nueva relación. Llegas con una ventaja enorme respecto a tu versión anterior: esta vez, tu vida no está vacía esperando a alguien: está llena, y alguien tendrá que sumar para entrar.",
    ejercicio: "Escribe tu «mapa de vida en construcción»: estado actual y próximo paso en 5 áreas (cuerpo, dinero/trabajo, vínculos, propósito, disfrute). Compara este mapa con tu punto de partida en este programa ({frag}) y subraya tu avance más sorprendente.",
    historia: "Escribe cómo quieres presentar tu vida ahora cuando alguien te pregunte «¿y tú qué haces, en qué estás?». Que suene a vida llena, no a vida en pausa.",
    accion: "Pega tu mapa en un lugar visible. Esta semana le toca sostener tu meta de 90 días: la revisión del domingo se vuelve cita fija." }
  ]
});

/* ==========================================================
   TEMA 7 — PREPARARSE PARA UNA NUEVA RELACIÓN
   ========================================================== */
window.REAVIVA_F2_THEMES.push(
{ id: "nueva-relacion", nombre: "Prepararse para una nueva relación",
  enfoque: "Abrirse a un nuevo amor desde la abundancia, no desde la herida: señales de que estás listo/a, cómo conocer a alguien y cómo cuidar lo aprendido.",
  dias: [
  { titulo: "¿Estás {listo/lista}? Señales honestas",
    audioTitulo: "¿Estás listo? Señales honestas",
    caso: "Marcos sentía «mariposas» por alguien nuevo y se preguntó con miedo si era amor o ansiedad de no estar solo. Se dio un mes para observar antes de decidir. Por primera vez, eligió con calma en vez de urgencia.",
    guion: "Empezamos el ciclo con la pregunta que importa: ¿estás listo para una nueva relación? No hay fecha mágica, pero sí señales. Señales de que sí: tu ex ya no ocupa tus mañanas, disfrutas tu soledad en vez de solo soportarla, tu vida tiene proyecto y no hay un hueco con forma de persona. Señales de que no: buscas quien te rescate del dolor, revisas a tu ex para compararlo todo, necesitas respuesta inmediata para no angustiarte. Ninguna de estas señales te condena: solo te ubican. Abrirse al amor desde la abundancia y no desde la herida es la diferencia entre repetir y estrenar. Esta semana nos preparamos con calma, sin prisa y sin culpa por desear amar otra vez: desearlo es sano.",
    ejercicio: "Aplica el inventario honesto: de las señales descritas, ¿cuáles tienes de cada lista? Escribe tu conclusión en una frase («estoy listo para conocer, no aún para comprometer» vale perfectamente). Apóyate en tu estado real tras esta historia: {frag}.",
    historia: "¿Has pensado en alguien nuevo, aunque sea de paso? ¿Qué sientes de verdad: ilusión, miedo, culpa, ganas? Cuéntalo sin juzgarte.",
    accion: "Define hoy tu estado en una frase y tu ritmo («conocer sin prisa» es una posición completa). Escríbelo en tu registro: es tu punto de partida del ciclo." },
  { titulo: "No busques lo que te faltó: ofrece lo que eres",
    audioTitulo: "No busques lo que te faltó",
    caso: "Laura hizo dos listas: la del «hombre perfecto» de antes de su proceso (que era, en realidad, su ex con correcciones) y la de ahora: cualidades de trato, no de fantasía. La segunda era más corta y mucho más exigente en lo importante.",
    guion: "Hay una trampa al volver al amor: buscar a tu ex «corregido». Esa búsqueda te ata a la historia anterior y convierte a cada persona nueva en un examen sobre el pasado. Mejor pregunta: ¿qué clase de trato quiero dar y recibir ahora? La lista útil no describe cuerpos ni profesiones: describe conductas —cómo trata los conflictos, cómo responde a un no, cómo se alegra por ti—. Y tiene una segunda columna igual de importante: lo que tú ofreces hoy, que es mucho más que antes: alguien con límites, proyecto y honestidad. Entras al mercado, como quien dice, con inventario valioso. Precio de entrada: saberlo.",
    ejercicio: "Escribe tus dos columnas: «El trato que quiero dar y recibir» (8 conductas observables) y «Lo que ofrezco hoy» (8 cualidades tuyas reales, con ejemplos). Compáralas con lo que buscabas antes de tu historia ({frag}): ¿qué cambió en tus criterios?",
    historia: "¿Qué buscabas en una pareja antes de esta historia y qué buscas ahora? Sé {honesto/honesta} con ambas versiones: la diferencia entre ellas es tu diploma.",
    accion: "Guarda tus dos columnas junto a tu manifiesto de confianza. Son tu ficha completa para esta etapa nueva." },
  { titulo: "Conocer gente sin perderte",
    audioTitulo: "Conocer gente sin perderte",
    caso: "Daniel probó salir a actividades nuevas: un club de senderismo y clases de cocina. Conoció gente sin la presión de «cazar pareja» y redescubrió algo olvidado: «soy buena compañía, incluso para mí».",
    guion: "La vía más sana para conocer personas no es una aplicación a las 2 a.m.: son los lugares donde tu vida ya crece. Actividades, cursos, deporte, voluntariado, tu comunidad. Allí la pregunta no es «¿me elegirá?» sino «¿me gusta estar aquí?». Y cuando aparezca alguien interesante, tus reglas nuevas viajan contigo: conocer por cuotas, verificar con calma, no entregar tu agenda ni tu paz por unas semanas de mensajes intensos. Tu vida nueva no se pone en pausa por un chat. Si conocer a alguien te cuesta tu rutina, tu sueño o tu proceso, no es amor: es la vieja herida con ropa nueva. Ve despacio: lo bueno tolera la calma.",
    ejercicio: "Diseña tu plan de vida social de 4 semanas: 2 actividades recurrentes donde haya gente afín (no necesariamente parejas) y 1 plan semanal con tus personas. Si ya hay alguien en el panorama, evalúalo con tu escalera de confianza en mano. Contrasta con tu etapa de encierro tras vivir {frag}.",
    historia: "¿Cómo quedó tu vida social después de la ruptura? ¿Qué parte quieres reconstruir primero y por qué te da un poco de miedo (o de pereza)? Cuéntalo tal cual.",
    accion: "Inscríbete hoy en la primera actividad de tu plan. La inscripción es el ejercicio: después, asistir ya es logística." },
  { titulo: "Las primeras conversaciones",
    audioTitulo: "Las primeras conversaciones",
    caso: "Valeria temía el momento de contar su historia a alguien nuevo: «¿y si salgo corriendo al baño a llorar?». Preparó su versión breve: tres frases honestas, sin el expediente completo. La usó dos veces y funcionó: ligera y verdadera.",
    guion: "Conocer a alguien nuevo trae dos preguntas difíciles: cuándo contar tu historia y cuánta. Regla sencilla: tu historia se cuenta por capas y al ritmo de la confianza, no en la primera cita como currículum ni como advertencia. Prepara tu versión breve: qué viviste, en una frase; qué aprendiste, en otra; dónde estás hoy, en la tercera. Sin ataques a tu ex (revelan más de ti que de él) y sin convertir la cita en terapia. Y del otro lado: escucha cómo habla esa persona de SUS exparejas e historias. Ahí se ve todo: responsabilidad o victimismo, respeto o despecho. Tus primeras conversaciones son una entrevista mutua y amable, no un examen final.",
    ejercicio: "Escribe tus dos guiones: tu versión breve en 3 frases (pasado, aprendizaje, presente) y 5 preguntas buenas para conocer el trato de alguien (conflictos, límites, exparejas, planes, alegría ajena). Al pensar en tu versión breve, retoma esto de tu historia: {frag}. ¿Cómo lo dirías hoy en una frase serena?",
    historia: "Escribe cómo solías presentarte al conocer a alguien antes (¿qué vendías, qué escondías?) y cómo quieres presentarte ahora: esa diferencia es tu evolución hablando.",
    accion: "Practica tu versión breve en voz alta dos veces. Que suene a quien eres hoy, no a un resumen de daños." },
  { titulo: "Intensidad no es intimidad",
    audioTitulo: "Intensidad no es intimidad",
    caso: "A Laura alguien le escribió «siento que te conozco de toda la vida» al cuarto día. Antes le hubiera sonado a destino. Ahora lo leyó con su radar nuevo: «precioso… y rápido». Observó. A las dos semanas, la intensidad era con otra persona.",
    guion: "Una de las lecciones más caras de tu historia: la intensidad inicial no es intimidad, es velocidad. Mensajes a toda hora, declaraciones tempranas, «eres diferente a todas»: se siente como conexión, pero es presión con buena iluminación. La intimidad real es más lenta y más sólida: se construye con constancia, no con avalancha. Tu radar nuevo sabe distinguirlas: si el ritmo te angustia, te roba el sueño o te hace abandonar tu vida, no es que «te cuesta el amor»: es que eso no es amor todavía, es intensidad. Bajar el ritmo es tu derecho y tu filtro: quien vale la pena tolera caminar al paso de la calma. Quien solo sabe correr, corre con cualquiera.",
    ejercicio: "Escribe tu «semáforo de ritmo»: qué conductas tempranas te dan luz verde (constancia, respeto a tu tiempo), cuáles ámbar (declaraciones grandes muy pronto) y cuáles roja (presión, celos «de juego», urgencia de exclusividad). Revísalas contra el inicio de tu historia anterior: {frag}. ¿Qué luces no viste entonces?",
    historia: "Cuenta cómo empezó tu historia anterior en cuanto a ritmo: ¿hubo intensidad temprana? ¿Qué confundiste con amor en esas primeras semanas?",
    accion: "Si hay alguien en tu panorama, aplica hoy el semáforo con honestidad y ajusta el ritmo según tu resultado, no según tu miedo a perderlo." },
  { titulo: "Cuida tus límites en lo nuevo",
    audioTitulo: "Cuida tus límites en lo nuevo",
    caso: "Marcos estrenó una frase en su nueva etapa: «me gusta cómo va esto, y mi ritmo es este». La dijo nervioso. La otra persona respondió: «gracias por decirlo claro». Marcos supo que su nuevo sistema funcionaba.",
    guion: "Tus límites no son un obstáculo para el nuevo amor: son el examen de admisión. La persona correcta no se molesta cuando dices tu ritmo, tu horario o tu «esto todavía no»: lo agradece, porque también quiere saber con quién está. Por eso los límites se dicen temprano y con naturalidad, no como discurso ni como prueba secreta. Di lo que necesitas como quien da una dirección útil, no una amenaza. Y observa la respuesta con el cuerpo tranquilo: respeto visible, ajuste real, constancia. El pasado te enseñó el precio de negociar tus límites por miedo a perder a alguien. Ya pagaste esa matrícula: no la pagas dos veces.",
    ejercicio: "Escribe tus 5 límites de la nueva etapa (ritmo de contacto, tiempos para exclusividad, temas de dinero, redes, espacio personal) con su frase exacta para decirlos. Compáralos con los límites que no pusiste cuando empezó tu historia anterior ({frag}).",
    historia: "¿Qué límite te da más vergüenza o miedo decir en algo nuevo? ¿Qué temes que pase si lo dices? Escríbelo hasta que pierda fuerza.",
    accion: "Practica en voz alta tus frases de límite hasta que suenen naturales. Si hay alguien en el panorama, di esta semana el límite que toque: pequeño, claro, temprano." },
  { titulo: "Entrar entero, no a medias",
    audioTitulo: "Entrar entero, no a medias",
    caso: "Al cerrar el ciclo, Daniel escribió: «Si vuelvo a amar, entro entero: con mi historia, mis límites y mi vida llena. Nadie me completa: me acompaña». Lo firmó como quien firma un contrato consigo mismo.",
    guion: "Cerramos el ciclo con tu declaración de entrada. No buscas una mitad: eres una persona completa considerando compartir su vida. Eso cambia todo: no negocias tu proyecto, no escondes tu proceso, no pides permiso para ser quien ya eres. Y si hoy decides que aún no es el momento, también es una conclusión perfecta de este ciclo: preparado no es lo mismo que obligado. Mañana harás el test de cierre del ciclo, y entraremos al último tema del pool: el duelo que regresa. Sí, incluso estando listos, el duelo viejo a veces toca la puerta. Aprenderás a recibirlo sin miedo: como una visita, no como un regreso a vivir ahí.",
    ejercicio: "Escribe tu declaración de entrada (o de espera): «En mi próxima relación yo…» con 8 compromisos contigo (ritmo, límites, comunicación, proyectos, salidas). Si decides esperar, escribe qué seguirás construyendo mientras tanto. Cierra retomando tu historia completa desde esto: {frag}, hasta el tú de hoy.",
    historia: "Escribe una carta breve a tu futura pareja (o a tu futuro yo si decides esperar): quién eres hoy, qué ofreces, qué necesitas, qué ya no aceptas. Sin nombres: es un documento tuyo.",
    accion: "Guarda tu declaración con tu manifiesto y tu Manual de límites. Ya tienes tu constitución personal completa: tres documentos que te representan." }
  ]
});


/* ==========================================================
   TEMA 8 — EL DUELO QUE REGRESA
   ========================================================== */
window.REAVIVA_F2_THEMES.push(
{ id: "duelo-regresa", nombre: "El duelo que regresa",
  enfoque: "Cuando el pasado toca la puerta meses después: entender los regresos del duelo, atenderlos sin miedo y confirmar que ya no vives ahí.",
  dias: [
  { titulo: "Una visita, no un regreso",
    audioTitulo: "Una visita, no un regreso",
    caso: "Un martes cualquiera, meses después, Laura olió un perfume en la calle y el duelo entero le cayó encima en la acera. Duró una tarde. Antes duraba semanas. «Fue una visita», escribió esa noche. «Ya no vive aquí».",
    guion: "Empezamos el último tema del ciclo de temas con una verdad que libera: el duelo puede regresar de visita mucho después de haber sanado lo principal. Una fecha, un olor, una canción, una noticia. No significa que no hayas sanado ni que empieces de cero: significa que esa historia fue importante y el cerebro guarda atajos. La diferencia entre una visita y un regreso es la duración y lo que haces con ella: hoy tienes protocolo, red y evidencia. La visita se atiende —se siente, se nombra, se deja pasar— como se atiende a alguien que ya no vive en tu casa: con respeto, en la sala, sin ofrecerle el cuarto. Esta semana aprendemos a recibir visitas sin miedo y sin mudanza.",
    ejercicio: "Reconstruye tu última «visita» del duelo: disparador, duración, qué hiciste, cuándo se fue. Compárala con un día equivalente de tu inicio ({frag}): ¿qué cambió en duración y en manejo? Escríbelo como evidencia numerada.",
    historia: "¿Cuál fue tu visita más reciente e inesperada? Cuéntala con escenario: qué hacías, qué la disparó y qué pensaste al darte cuenta de que ya no dolía como antes.",
    accion: "Escribe tu frase de visita y déjala en notas del teléfono: «Es una visita. Se atiende y se va. Yo ya no vivo ahí»." },
  { titulo: "Las fechas que pesan",
    audioTitulo: "Las fechas que pesan",
    caso: "El aniversario que fue, el cumpleaños, las fiestas de diciembre: el calendario de Marcos tenía minas. Las marcó todas en enero, con un plan para cada una. Ese diciembre fue el primero en años que no lo tomó por sorpresa.",
    guion: "Hay fechas que pesan antes de llegar: aniversarios, cumpleaños, fiestas, el día en que todo terminó. El truco no es «no sentir» en esas fechas: es llegar preparado. Marca tu calendario emocional una vez al año, con honestidad. Para cada fecha, decide de antemano: ¿se honra, se ignora o se resignifica? Las tres opciones son válidas; lo que no vale es improvisar el mismo día con el corazón en la mano. Resignificar es especialmente poderoso: la fecha que fue de la relación pasa a ser la fecha de tu ritual —una cena contigo, un viaje corto, tu revisión anual de progreso—. El calendario también se puede reconquistar, fecha por fecha.",
    ejercicio: "Haz tu calendario emocional de los próximos 12 meses: lista las fechas sensibles, su origen y tu plan para cada una (honrar, ignorar o resignificar, con la actividad concreta). Conecta la más pesada con tu historia: {frag}. ¿Qué plan la transforma?",
    historia: "¿Cuál es tu fecha más difícil del año y por qué? Escribe qué pasó ese día en el pasado y cómo te gustaría vivirlo el próximo año.",
    accion: "Agenda hoy la primera fecha sensible con su plan ya decidido. La decisión previa es la mitad del alivio." },
  { titulo: "Cuando el ex aparece en sueños",
    audioTitulo: "Cuando el ex aparece en sueños",
    caso: "Daniel despertó sobresaltado: había soñado con su ex, una escena feliz. Se sintió traidor consigo mismo. Al escribirlo entendió: el sueño no era un deseo, era archivo. Su vida despierta seguía clara.",
    guion: "Soñar con tu ex meses después puede inquietar: «¿será que no lo supero?». Cálmate con datos: los sueños son, en gran parte, el cerebro ordenando archivo, no un oráculo de deseos. Aparecen personas del pasado como aparecen casas viejas y escuelas: porque fueron escenarios de tu vida, no porque debas volver a ellos. La interpretación útil no es «¿qué significa?» sino «¿cómo amanecí?»: si amaneces tranquilo, fue archivo; si amaneces activado, aplica tu protocolo de visita y sigue tu día. Tu vida despierta —tus decisiones, tus límites, tu rumbo— es la que define tu proceso. Los sueños no votan.",
    ejercicio: "Si recuerdas un sueño reciente con tu ex, escríbelo y analízalo en frío: emociones dominantes, qué archivo crees que ordenaba, cómo amaneciste. Si no lo recuerdas, escribe cómo reaccionarás la próxima vez usando tu protocolo. Conecta con tu historia: {frag}. ¿Qué escena tuya merece ya pasar a archivo cerrado?",
    historia: "Cuéntanos el sueño con tu ex que más te marcó (o el miedo a tenerlo). ¿Qué creías que significaba entonces, y cómo lo lees hoy?",
    accion: "Hoy, al despertar de cualquier sueño raro, aplica la regla: escríbelo en 3 líneas, clasifícalo («archivo») y empieza tu rutina. Sin rumiación matutina." },
  { titulo: "Noticias de su vida sin ti",
    audioTitulo: "Noticias de su vida sin ti",
    caso: "A Valeria le contaron que su ex se casaba. Esperó el golpe… y sintió una punzada breve y algo inesperado: alivio de no ser ella. Escribió en su diario: «su vida siguió. La mía también. Así debe ser».",
    guion: "Tarde o temprano llegan noticias: una nueva pareja, un matrimonio, un logro, a veces una caída. Cada noticia es una prueba de ácido de tu proceso, y conviene tener la lectura lista: la vida de tu ex siguió, como tenía que seguir, y la tuya también. No estás en una competencia de quién supera primero; estás en tu propia construcción. Si la noticia duele, trátala como visita: protocolo, red, día siguiente. Si no duele, nótalo sin culpa: la indiferencia serena también se celebra. Y una regla de higiene: no colecciones noticias. Que lleguen es inevitable; salir a buscarlas es romper tu propio límite. Tu energía de detective quedó jubilada el día de tu carta de cierre.",
    ejercicio: "Escribe tu guion para recibir noticias: qué te dirás, qué harás la primera hora, a quién se lo contarás y qué NO harás (buscar, comparar, escribir). Prepáralo pensando en la noticia que más temes, que probablemente toca esto: {frag}.",
    historia: "¿Ya recibiste alguna noticia de la vida de tu ex? ¿Cómo reaccionaste por fuera y por dentro? Si no ha llegado, escribe cómo imaginas —de verdad— que reaccionarás.",
    accion: "Reafirma hoy tu higiene informativa: si alguien te trae noticias sin pedirlas, usa tu frase: «te agradezco, y prefiero no saber más de ese tema». Practícala en voz alta." },
  { titulo: "Lo que queda: la cicatriz",
    audioTitulo: "Lo que queda: la cicatriz",
    caso: "Marcos se tocó la historia como quien se toca una cicatriz vieja: estaba ahí, contaba algo, pero no dolía al tacto. «No la quiero borrar», dijo. «Es el mapa de cómo salí».",
    guion: "No todo lo que queda de una historia es herida: también queda la cicatriz. La diferencia es práctica: la herida duele al tacto y se abre; la cicatriz es tejido firme que cuenta una historia sin sangrar. Tu meta nunca fue «que no hubiera pasado»: lo que pasó te formó, te enseñó tus límites, te trajo a este proceso entero. La meta era esta: poder tocar el recuerdo sin que se abra. Habrá días de visita que remuevan algo; aun así, la base es firme. Aprende a nombrar lo tuyo con precisión: «esto ya es cicatriz» o «esto sigue tierno, lo cuido». Esa honestidad fina es la que distingue a quien sanó de quien solo se anestesió.",
    ejercicio: "Haz el mapa de tu cicatriz: de toda tu historia, qué partes ya tocas sin dolor, cuáles siguen tiernas y qué cuidado concreto necesita cada una de las tiernas. Usa el punto de partida como referencia: {frag}. ¿Esa escena ya es cicatriz o sigue tierna? Sé preciso.",
    historia: "Elige un recuerdo que antes te desarmaba y hoy puedes contar completo. Escríbelo aquí, entero, como prueba documental de tu cicatriz.",
    accion: "Haz hoy un gesto de reconciliación con tu historia: visita (o imagina con calma) un lugar de esa época sin carga. Tocar la cicatriz en tus términos también es un entrenamiento." },
  { titulo: "Ayudar desde la cicatriz",
    audioTitulo: "Ayudar desde la cicatriz",
    caso: "Una conocida le contó a Laura su ruptura entre lágrimas. Laura no dio discursos: preparó café y escuchó. Al final, la otra dijo: «se nota que sabes lo que es esto». Laura entendió que su cicatriz también servía.",
    guion: "Hay una etapa final del duelo que no se anuncia: cuando tu historia empieza a servirle a otros. No como lección dictada, sino como compañía creíble: «yo estuve ahí, y se sale». Esa es la cosecha de todo tu proceso: tu cicatriz se vuelve mapa para quien hoy está en su día 3. No necesitas buscarlo ni forzar testimonios; basta estar disponible con la escucha que a ti te salvó. Y tiene un efecto secundario hermoso: cada vez que acompañas desde la cicatriz, confirmas tu propio avance. Ayudar no te regresa al dolor: te gradúa de él. Esta semana, si la vida te pone a alguien en tu antiguo lugar, ya sabes qué hacer: café, escucha, y la frase que a ti te hubiera sostenido.",
    ejercicio: "Escribe el texto que te hubiera servido a ti en tu peor semana: una carta corta, sin consejos arrogantes, con presencia y esperanza realista. Puedes apoyarte en lo que escribiste al inicio de todo esto: {frag}. Esa carta es, también, tu certificado de avance.",
    historia: "¿Has tenido ya la oportunidad de acompañar a alguien en un duelo parecido? Cuéntalo. Si no, escribe a quién de tu entorno ves caminando hacia donde tú estuviste, y qué le dirías hoy.",
    accion: "Guarda tu carta en el teléfono, lista. Cuando aparezca la persona, la envías tal cual. Tu disponibilidad es el acto de hoy." },
  { titulo: "Nueva vuelta, misma dirección",
    audioTitulo: "Nueva vuelta, misma dirección",
    caso: "Al completar su primer recorrido por los ocho temas, Daniel releyó su definición de sí mismo y sonrió: casi todo se había cumplido. Debajo escribió la fecha y una línea: «Nueva vuelta. Misma dirección: hacia mí».",
    guion: "Cerramos el tema del duelo que regresa —y con él, el recorrido completo de temas de la Fase 2— con una mirada larga. Mañana harás el test de cierre del ciclo, y luego el sistema te llevará a una nueva vuelta por estos mismos temas, en el mismo orden, pero con una diferencia enorme: tú. En la segunda vuelta los prompts profundizan, porque tu archivo ya tiene con qué comparar: lo que escribiste la semana pasada, lo que definiste, lo que lograste. Sanar en espiral significa esto: los mismos paisajes, cada vez más arriba. No hay un día final en el que «ya sanaste para siempre»: hay una vida bien vivida con herramientas que funcionan. Y la tienes. Sigue entrando, día a día, como hasta ahora.",
    ejercicio: "Haz tu balance de la primera vuelta completa de Fase 2: por cada tema (autoestima, límites, recaídas, rencor, confianza, propósito, nueva relación, duelo que regresa), escribe en una línea tu avance más claro. Apóyate en tu archivo entero, empezando por donde empezaste: {frag}. Termina con tus 3 propósitos para la segunda vuelta.",
    historia: "Escribe el capítulo actual de tu historia como si lo leyera alguien que acaba de romper: ¿qué le diría tu presente a su día 1? Que sea tu manifiesto de vuelta nueva.",
    accion: "Celebra la vuelta completa hoy: date el gusto que te prometiste en tu mapa de vida. Mañana, test de cierre y a seguir: nueva vuelta, misma dirección." }
  ]
});

/* ============================================================
   MOTOR DE FASE 2 — funciones puras usadas por app.js.
   ============================================================ */

/* Info de Fase 2 para un día absoluto. null si día <= 30. */
function phase2Info(day){
  const d = Number(day) || 0;
  if(d <= 30) return null;
  const f2 = d - 30;
  const cyc0 = Math.floor((f2 - 1) / 7);
  return {
    day: d,
    f2day: f2,
    cycle: cyc0 + 1,
    cycleDay: ((f2 - 1) % 7) + 1,
    vuelta: Math.floor(cyc0 / window.REAVIVA_F2_THEMES.length) + 1,
    themeIndex: cyc0 % window.REAVIVA_F2_THEMES.length,
  };
}

/* Contenido de cualquier día (misma forma que Fase 1:
   { day, part, title, caso, reflexion, ejercicio, accion }).
   Fase 1 → window.REAVIVA_PROGRAM; Fase 2 → generado por ciclo. */
function getDayContent(d){
  d = Number(d) || 1;
  if(d <= 30){
    const p = window.REAVIVA_PROGRAM[d - 1];
    return p ? Object.assign({}, p) : null;
  }
  const info = phase2Info(d);
  const theme = window.REAVIVA_F2_THEMES[info.themeIndex];
  const e = theme.dias[info.cycleDay - 1];
  if(!e) return null;
  const part = "Fase 2 · Ciclo " + info.cycle + " — " + theme.nombre +
    (info.vuelta > 1 ? " · Vuelta " + info.vuelta : "");
  return {
    day: d,
    part: part,
    title: e.titulo,
    audioTitulo: e.audioTitulo || e.titulo,
    caso: e.caso,
    reflexion: e.guion,
    ejercicio: e.ejercicio,
    accion: e.accion,
    f2: true,
    f2info: info,
    theme: theme,
  };
}
window.phase2Info = phase2Info;
window.getDayContent = getDayContent;
