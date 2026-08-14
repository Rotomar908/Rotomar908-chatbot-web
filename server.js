// server.js
// Backend del chatbot: combina respuestas predefinidas (rápidas y gratis)
// con una llamada a la API de Groq (gratuita) para todo lo que no esté programado.

const express = require("express");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
require("dotenv").config();

const app = express();

// Permite que tu web (en otro dominio) llame a este backend.
// Pon aquí tu dominio real para más seguridad, ej: origin: "https://tudominio.com"
app.use(cors());

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

// --- Carpeta y archivos donde se guarda todo ---
const LOGS_DIR = path.join(__dirname, "logs");
const CONVERSACIONES_DIR = path.join(LOGS_DIR, "conversaciones");
const ARCHIVO_DATOS_UTILES = path.join(LOGS_DIR, "datos_utiles.txt");

if (!fs.existsSync(CONVERSACIONES_DIR)) {
  fs.mkdirSync(CONVERSACIONES_DIR, { recursive: true });
}

function fechaHoraActual() {
  return new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid" });
}

// Cada sesión (cada visitante) tiene su propio archivo .txt con la conversación completa
function rutaArchivoConversacion(sesionId) {
  const idSeguro = sesionId.replace(/[^a-zA-Z0-9_-]/g, ""); // evita caracteres raros en el nombre de archivo
  return path.join(CONVERSACIONES_DIR, `conversacion_${idSeguro}.txt`);
}

// Guarda cada mensaje (usuario y bot) en el archivo de ESA sesión
function guardarConversacion(sesionId, quien, texto, origen = "") {
  const archivo = rutaArchivoConversacion(sesionId);

  // Si el archivo es nuevo, le ponemos una cabecera con la fecha de inicio
  if (!fs.existsSync(archivo)) {
    fs.writeFileSync(
      archivo,
      `=== Conversación iniciada el ${fechaHoraActual()} | Sesión: ${sesionId} ===\n\n`,
      "utf-8"
    );
  }

  const linea = `[${fechaHoraActual()}] ${quien}${origen ? ` (${origen})` : ""}: ${texto}\n`;
  fs.appendFileSync(archivo, linea, "utf-8");
}

// Palabras clave que indican interés o necesidad real (ajusta esta lista a tu negocio)
const PALABRAS_CLAVE_INTERES = [
  "quiero",
  "necesito",
  "busco",
  "me interesa",
  "interesado",
  "interesada",
  "presupuesto",
  "cotizar",
  "cotización",
  "comprar",
  "contratar",
  "precio",
  "cuánto cuesta",
  "disponibilidad",
  "reservar",
  "agendar",
  "cita",
];

// Detecta email, teléfono, nombre e intereses en el texto del usuario
function extraerDatosUtiles(texto) {
  const regexEmail = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
  const regexTelefono = /(?:\+?\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/g;
  const regexNombre = /(?:me llamo|mi nombre es|soy)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,2})/i;

  const emails = texto.match(regexEmail) || [];
  const telefonosCrudos = texto.match(regexTelefono) || [];
  const telefonos = telefonosCrudos.filter((t) => t.replace(/\D/g, "").length >= 7);

  const matchNombre = texto.match(regexNombre);
  const nombre = matchNombre ? matchNombre[1].trim() : null;

  const textoNorm = texto.toLowerCase();
  const intereses = PALABRAS_CLAVE_INTERES.filter((kw) => textoNorm.includes(kw));

  return { emails, telefonos, nombre, intereses };
}

// Si el mensaje trae algún dato útil (contacto, nombre o interés), lo guarda aparte
function guardarDatosUtilesSiExiste(sesionId, mensajeUsuario) {
  const { emails, telefonos, nombre, intereses } = extraerDatosUtiles(mensajeUsuario);
  const hayAlgoUtil = emails.length || telefonos.length || nombre || intereses.length;
  if (!hayAlgoUtil) return;

  const partes = [
    `[${fechaHoraActual()}]`,
    `[sesion:${sesionId}]`,
    `Mensaje: "${mensajeUsuario}"`,
    `Nombre: ${nombre || "-"}`,
    `Email(s): ${emails.join(", ") || "-"}`,
    `Telefono(s): ${telefonos.join(", ") || "-"}`,
    `Interes/necesidad detectada: ${intereses.length ? intereses.join(", ") : "-"}`,
  ];
  fs.appendFileSync(ARCHIVO_DATOS_UTILES, partes.join(" | ") + "\n", "utf-8");
}

// Cargamos las respuestas predefinidas desde el JSON
function cargarFAQs() {
  const raw = fs.readFileSync(path.join(__dirname, "responses.json"), "utf-8");
  return JSON.parse(raw).faqs;
}

// Normaliza texto (minúsculas, sin tildes) para comparar mejor
function normalizar(texto) {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// Busca si el mensaje del usuario coincide con alguna keyword programada
function buscarRespuestaProgramada(mensajeUsuario) {
  const faqs = cargarFAQs();
  const mensajeNorm = normalizar(mensajeUsuario);

  for (const faq of faqs) {
    for (const kw of faq.keywords) {
      if (mensajeNorm.includes(normalizar(kw))) {
        return faq.respuesta;
      }
    }
  }
  return null; // no hay coincidencia -> se usará la API
}

// Llamada a la API de Groq (gratuita) para preguntas no programadas
// Groq usa el mismo formato que OpenAI, solo cambia la URL y el modelo.
async function preguntarAGroq(mensajeUsuario, historial = []) {
  const systemPrompt = `### 1. INFORMACIÓN DE LA EMPRESA (CONTEXTO)
- **Nombre:** Carrocerías Rotomar S.L.
- **Ubicación:** Polígono Industrial El Viso, Málaga, España.
- **Especialidad:** Diseño, fabricación y montaje de carrocerías a medida (furgones, cajas abiertas, plataformas), adaptaciones especiales (isotermos, frigoríficos, plataformas elevadoras), instalación de suspensiones neumáticas y estructuras ligeras de duraluminio.
- **Servicios adicionales:** Reparaciones de carrocerías industriales y gestión de homologaciones oficiales para reformas de vehículos (ITV).
- **Horarios de atención:** Lunes a Viernes de 7:00 a 14:30 -> Horario de verano. / Lunes a Jueves de 8:00 a 14:00 y 15:00 a 17:30 , Viernes 8:00 a 14:30.
- **Contacto directo:** +34 952 340 991 / info@Rotomar.com

---

### 2. TONO Y REGLAS DE COMPORTAMIENTO
- Los clientes no suelen preguntar por el nombre técnico del servicio. Preguntarán si hacemos cosas como *"ponerle estanterías a mi furgoneta"*, *"arreglar una lona rota"*, *"poner una rampa para subir mercancía"* o *"hacer mi furgo isotermo"*.
- **Tu respuesta debe ser:**
  1. Confirmar con entusiasmo que **SÍ** lo hacemos (ej. *"Sí, por supuesto, realizamos ese tipo de transformaciones en nuestro taller..."*).
  2. Ofrecer una explicación muy breve de cómo lo hacemos apoyándote en el catálogo anterior, NUNCA DES PRESUPUESTO.
  3. Si el cliente quiere ver fotos de trabajos anteriores, indícale amablemente que puede visitar nuestra galería en la web oficial **https://rotomar.com** o que el técnico le enviará ejemplos por WhatsApp al contactar con él.
  4. Pasar directamente a pedir sus datos para que un técnico le valore el presupuesto de forma gratuita y sin compromiso.
  5. No quiero que hables mucho simplemente responde en base a lo que pregunta el cliente.
  6. no quiero que digas ningun presupuesto para eso que hable con un humano tu solo enfocate en la informacion.
  7 Quiero que al cerrar la conversascion le proporciones los datos de la empresa para que contacte con nosotros o que el proporcione su direccion para hablar con el
  8. quiero que no digas precios
  9. quiero que seas breve y que no pongas mucho texto tambien y no repitas mucho lo que dices si en el mensaje anterior comentaste algo no lo vuelvas a comentar
---

### 5. CAPTURA DE DATOS PARA PRESUPUESTOS (Conversacional)
Cuando el usuario acceda a que le llamemos para darle un presupuesto, pídele de manera natural (un dato por mensaje, no todos de golpe) la siguiente información:
1. **Nombre de contacto** (y si es empresa o autónomo).
2. **Teléfono de contacto** (obligatorio para la llamada del técnico).
3. **Tipo de vehículo** (Marca, modelo y año).
4. **Detalle del trabajo** que desea realizar.
5. (Mención especial) Recuérdale que tener a mano la **ficha técnica del vehículo** facilitará mucho el proceso cuando le llame el técnico de Rotomar.
Una vez que tengas estos datos, dile al cliente que su solicitud ha sido registrada y que un especialista de Carrocerías Rotomar se pondrá en contacto con el
Tu objetivo principal es identificar la necesidad del cliente (que normalmente te preguntará por un problema o una idea concreta, no por el nombre técnico del servicio), confirmarle de manera cercana si lo hacemos o no, y pedirle sus datos de contacto para que el equipo técnico le dé presupuesto.

---

### 4. TRADUCTOR DE NECESIDADES (¿Qué pide el cliente vs. Qué hacemos?)

Usa esta guía para saber qué responder cuando el cliente te pregunte si "hacéis esto":

*   **Si el cliente dice:** "Quiero camperizar mi furgoneta", "Tengo una autocaravana que se balancea mucho/se mueve con el viento" o "Quiero mejorar la amortiguación".
    *   **Respuesta de la IA:** Confirmar que SÍ. Explicar que somos especialistas en instalar **suspensiones neumáticas** para autocaravanas y campers, lo que mejora drásticamente la estabilidad, la seguridad y el confort al conducir.

*   **Si el cliente dice:** "Quiero meterle estanterías a mi furgoneta", "Quiero hacer mi furgoneta taller", "Necesito organizar mis herramientas dentro de la furgoneta" o "Quiero proteger el suelo/paredes por dentro".
    *   **Respuesta de la IA:** Confirmar que SÍ. Hacemos revestimientos interiores (madera/aluminio) e instalamos mobiliario de taller homologado (estanterías, cajoneras, bancos de trabajo).

*   **Si el cliente dice:** "Tengo un camión de reparto de bebidas/cerveza y necesito arreglarlo/hacer uno" o "Se me ha roto el toldo de la lona del camión".
    *   **Respuesta de la IA:** Confirmar que SÍ. Fabricamos y reparamos **carrocerías botelleras** a medida con toldos de alta resistencia y sistemas que facilitan la carga y descarga.

*   **Si el cliente dice:** "Quiero poner una rampa/plataforma para subir carga detrás del camión" o "Necesito una grúa pequeña para el camión".
    *   **Respuesta de la IA:** Confirmar que SÍ. Instalamos y mantenemos **plataformas elevadoras traseras** y grúas de carga.

*   **Si el cliente dice:** "Quiero hacer mi furgoneta isotermo", "Necesito llevar comida fría" o "Tengo que instalar un motor de frío".
    *   **Respuesta de la IA:** Confirmar que SÍ. Realizamos el aislamiento térmico interior (isotermos) e instalamos equipos de frío comercial homologados.

*   **Si el cliente dice:** "Tengo que pasar la ITV por una reforma que le he hecho al camión/furgoneta" o "Necesito papeles para homologar algo".
    *   **Respuesta de la IA:** Confirmar que SÍ. Al ser fabricantes, nos encargamos de todo el proyecto de reforma técnica y de la gestión de la **homologación oficial** para que pase la ITV sin problemas.

*   **Si el cliente dice:** "Tengo un golpe en la caja del camión", "Se ha roto una bisagra de la puerta trasera", "El basculante/volquete no sube bien" o "Tengo una raja en la lona".
    *   **Respuesta de la IA:** Confirmar que SÍ. Tenemos taller de reparación multimarca para arreglar cualquier desperfecto en carrocerías industriales.
CATÁLOGO DE PRODUCTOS Y SERVICIOS REALES (Según la Web)
Usa esta lista para confirmar si realizamos un trabajo y explicarlo de manera sencilla:

*   **Carrocería de Paquetería:** Cajas cerradas y seguras de gran volumen para transporte de mercancía.
*   **Carrocería Isotérmica y Frigorífica:** Furgones isotermos y cajas frigoríficas de diferentes espesores y volúmenes, con equipos de refrigeración completamente integrados para chasis cabina, vehículos portantes o remolques.
*   **Carrocería Botellera:** Soluciones especializadas para la distribución de bebidas (con toldos de alta resistencia).
*   **Carrocería Abierta:** Estructuras abiertas adaptadas a las necesidades específicas de carga.
*   **Carrocería Volquete / Basculante y Multibasculante:** Diseñadas para construcción, agricultura y ganadería, construidas con materiales de alta resistencia (hierro, duraluminio, etc.) con sistemas de cilindro telescópico, mando en cabina y toma de fuerza.
*   **Tauliner y Semitauliner:** Carrocerías de lonas correderas para facilitar una carga lateral rápida.
*   **Revestimientos y Protecciones Interiores:** Revestimiento interior de furgonetas (suelos de madera fenólica o duraluminio, laterales, etc.) para proteger la zona de carga.
*   **Equipamiento Profesional:** Instalación de plataformas elevadoras traseras, grúas de carga, estanterías o módulos de trabajo/taller para furgonetas.
*   **Suspensión Neumática:** Expertos en la instalación de suspensiones neumáticas homologadas para camiones, furgonetas, autocaravanas y campers. Mejoran la estabilidad, reducen el balanceo por viento y optimizan la conducción bajo carga.
*   **Reparaciones y Mantenimiento:** Reparaciones homologadas de golpes, lonas, toldos, sistemas hidráulicos o estructuras metálicas para prolongar la vida útil de cualquier carrocería industrial.
*   **Homologaciones Oficiales:** Nos encargamos de tramitar toda la documentación y proyectos de reforma técnica necesarios para que el vehículo pase la ITV sin problemas.

---
---`;

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      max_tokens: 120,
      temperature: 0.3, // más bajo = respuestas más controladas y predecibles (0 a 2). Sube si la ves demasiado robótica.
      messages: [
        { role: "system", content: systemPrompt },
        ...historial,
        { role: "user", content: mensajeUsuario },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Error de la API de Groq: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  return (
    data.choices?.[0]?.message?.content ||
    "Lo siento, no he podido generar una respuesta."
  );
}

// Endpoint principal del chat
app.post("/api/chat", async (req, res) => {
  try {
    const { mensaje, historial, sesionId } = req.body;

    if (!mensaje || typeof mensaje !== "string") {
      return res.status(400).json({ error: "Falta el campo 'mensaje'." });
    }

    const idSesion = sesionId || "sin-id";

    // Guardamos el mensaje del usuario y revisamos si trae datos útiles
    guardarConversacion(idSesion, "Usuario", mensaje);
    guardarDatosUtilesSiExiste(idSesion, mensaje);

    // 1) Intentamos responder con las reglas programadas (rápido, sin coste de API)
    const respuestaProgramada = buscarRespuestaProgramada(mensaje);
    if (respuestaProgramada) {
      guardarConversacion(idSesion, "Bot", respuestaProgramada, "programada");
      return res.json({ respuesta: respuestaProgramada, origen: "programada" });
    }

    // 2) Si no hay coincidencia, usamos la API de Groq (gratuita) como respaldo
    if (!GROQ_API_KEY) {
      const msj =
        "No tengo una respuesta programada para eso y la conexión con la IA no está configurada todavía.";
      guardarConversacion(idSesion, "Bot", msj, "sin_api");
      return res.status(200).json({ respuesta: msj, origen: "sin_api" });
    }

    const respuestaIA = await preguntarAGroq(mensaje, historial || []);
    guardarConversacion(idSesion, "Bot", respuestaIA, "ia");
    return res.json({ respuesta: respuestaIA, origen: "ia" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

// Endpoint para marcar que una conversación ha terminado (se llama cuando el cliente cierra el chat)
app.post("/api/finalizar-conversacion", (req, res) => {
  try {
    const { sesionId } = req.body;
    if (!sesionId) return res.status(400).json({ error: "Falta 'sesionId'." });

    const archivo = rutaArchivoConversacion(sesionId);
    if (fs.existsSync(archivo)) {
      fs.appendFileSync(
        archivo,
        `\n=== Conversación finalizada el ${fechaHoraActual()} ===\n`,
        "utf-8"
      );
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

// Contraseña simple para ver tus datos desde el navegador (cámbiala en las variables de entorno de Render)
const CLAVE_PANEL = process.env.CLAVE_PANEL || "cambia-esta-clave";

function comprobarClave(req, res) {
  if (req.query.clave !== CLAVE_PANEL) {
    res.status(401).send("Clave incorrecta. Añade ?clave=TU_CLAVE al final de la URL.");
    return false;
  }
  return true;
}

// Ver el resumen de leads (nombre, email, teléfono, interés) desde el navegador
app.get("/panel/leads", (req, res) => {
  if (!comprobarClave(req, res)) return;
  if (!fs.existsSync(ARCHIVO_DATOS_UTILES)) {
    return res.type("text/plain").send("Todavía no hay leads guardados.");
  }
  res.type("text/plain").send(fs.readFileSync(ARCHIVO_DATOS_UTILES, "utf-8"));
});

// Ver la lista de conversaciones disponibles
app.get("/panel/conversaciones", (req, res) => {
  if (!comprobarClave(req, res)) return;
  const archivos = fs.existsSync(CONVERSACIONES_DIR) ? fs.readdirSync(CONVERSACIONES_DIR) : [];
  if (archivos.length === 0) {
    return res.type("text/plain").send("Todavía no hay conversaciones guardadas.");
  }
  const lista = archivos
    .map((a) => `/panel/conversaciones/${a.replace(".txt", "")}?clave=${CLAVE_PANEL}`)
    .join("\n");
  res.type("text/plain").send(`Conversaciones disponibles:\n\n${lista}`);
});

// Ver una conversación concreta
app.get("/panel/conversaciones/:id", (req, res) => {
  if (!comprobarClave(req, res)) return;
  const archivo = rutaArchivoConversacion(req.params.id);
  if (!fs.existsSync(archivo)) {
    return res.status(404).type("text/plain").send("No existe esa conversación.");
  }
  res.type("text/plain").send(fs.readFileSync(archivo, "utf-8"));
});

app.listen(PORT, () => {
  console.log(`Servidor del chatbot escuchando en http://localhost:${PORT}`);
});
