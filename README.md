# Chatbot para tu web (híbrido: reglas + IA)

Este proyecto te da un chatbot que:

1. **Responde al instante** las preguntas frecuentes que tú programes (horarios, precios, envíos, etc.) — sin coste ni latencia de API.
2. **Usa la API de Groq (gratuita)** como respaldo para todo lo que no esté programado, así nunca se queda "sin respuesta".

## Estructura

```
chatbot/
├── server.js          # Backend (Node + Express)
├── responses.json     # Tus respuestas programadas (edítalo libremente)
├── package.json
├── .env.example        # Copia esto a .env y añade tu API key
└── public/
    ├── index.html      # Página de ejemplo con el widget
    ├── widget.js       # Lógica del chat (sin frameworks)
    └── widget.css      # Estilos del chat
```

## 1. Instalación

```bash
cd chatbot
npm install
cp .env.example .env
```

Abre `.env` y añade tu clave de la API de Groq (es gratuita, no pide tarjeta):

```
GROQ_API_KEY=gsk_xxxxxxxx
GROQ_MODEL=llama-3.3-70b-versatile
```

(La consigues en console.groq.com/keys. Tiene un límite de peticiones gratis por minuto/día, más que suficiente para un chatbot de soporte normal.)

## 2. Arrancar el servidor

```bash
npm start
```

Abre `http://localhost:3000` y verás la página de ejemplo con el chat abajo a la derecha.

## 3. Programar tus propias respuestas

Edita `responses.json`. Cada entrada tiene:

```json
{
  "id": "envios",
  "keywords": ["envio", "entrega", "tarda"],
  "respuesta": "Los envíos tardan entre 2 y 5 días hábiles."
}
```

- Si el mensaje del usuario contiene cualquiera de las `keywords`, se devuelve esa `respuesta` directamente (no se llama a la IA, así ahorras costes en las preguntas más comunes).
- Si no hay ninguna coincidencia, el mensaje se envía a Groq, que responde de forma natural usando el `system prompt` que puedes personalizar en `server.js` (línea del `systemPrompt`, ahí describes tu negocio, tono, límites, etc.).

## 4. Incrustar el widget en tu página web real

Solo necesitas copiar 2 líneas en el HTML de tu web:

```html
<div id="chatbot-widget"></div>
<script src="https://tu-dominio.com/widget.js"></script>
```

Y asegurarte de que `widget.css` también se sirve desde tu dominio (el propio `widget.js` no lo carga automáticamente si tu web ya tiene su propio sistema de estilos; en ese caso simplemente añade también `<link rel="stylesheet" href="widget.css">`).

Si tu backend (`server.js`) vive en un dominio distinto al de la web donde pones el widget, cambia `API_URL` en `widget.js` por la URL completa, por ejemplo:

```js
const API_URL = "https://api.tuempresa.com/api/chat";
```

y habilita CORS en `server.js` (añadiendo el paquete `cors`).

## 5. Guardado automático de conversaciones y datos útiles

El bot guarda todo automáticamente en la carpeta `logs/` (se crea sola la primera vez que alguien escribe):

- **`logs/conversaciones/conversacion_<id-de-sesion>.txt`** — un archivo por cada cliente/visitante, con toda su conversación completa (fecha de inicio, cada mensaje, y fecha de cierre cuando termina).
- **`logs/datos_utiles.txt`** — un resumen con solo las líneas donde detecta algo útil de cualquier cliente: nombre (si dice "me llamo..." o "mi nombre es..."), email, teléfono, o palabras que indican interés real (quiero, necesito, presupuesto, contratar, comprar, cita, etc.).

El archivo de cada cliente se va completando mensaje a mensaje en tiempo real, y queda marcado como "finalizada" automáticamente cuando el cliente cierra la ventana del chat o cierra la pestaña/navegador.

Puedes abrir esos `.txt` en cualquier momento con el Bloc de notas para ver conversaciones completas o leads.

**Para ajustar qué cuenta como "interés":** edita la lista `PALABRAS_CLAVE_INTERES` en `server.js` y añade o quita palabras según tu negocio.

⚠️ **Importante — privacidad:**
- Esos archivos contendrán datos personales (nombres, emails, teléfonos) — trátalos con cuidado y cumple la normativa de protección de datos que aplique en tu país (ej. RGPD en España/UE).
- No subas la carpeta `logs/` a repositorios públicos (añádela a tu `.gitignore` si usas Git).
- Considera informar a los usuarios de tu web de que sus mensajes se guardan (una nota de privacidad simple es suficiente en la mayoría de los casos).

## 6. Desplegar el backend

Cualquier hosting que soporte Node.js sirve: Render, Railway, Fly.io, un VPS propio, etc. Solo necesitas:
- Subir la carpeta del proyecto
- Configurar la variable de entorno `GROQ_API_KEY` en el panel del hosting
- Ejecutar `npm install && npm start`

## Notas de seguridad

- **Nunca** pongas tu `GROQ_API_KEY` en el código del frontend (widget.js). Siempre debe vivir en el servidor (`.env`), porque cualquiera podría verla si abre las herramientas de desarrollador del navegador.
- Puedes añadir un límite de mensajes por usuario/IP en `server.js` si te preocupa el abuso o el coste.
