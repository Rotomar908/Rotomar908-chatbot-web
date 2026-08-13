// widget.js
// Widget de chat sin dependencias. Solo hay que incluir este script + widget.css
// y ajustar API_URL si el backend está en otro dominio.

(function () {
  // ⚠️ IMPORTANTE: cambia esta URL por la de tu backend ya desplegado (ej. Render, Railway, etc.)
  // Ejemplo: "https://mi-chatbot.onrender.com"
  const BASE_URL = "https://rotomar908-chatbot-web.onrender.com";
  const API_URL = `${BASE_URL}/api/chat`;
  const FINALIZAR_URL = `${BASE_URL}/api/finalizar-conversacion`;

  const contenedor = document.getElementById("chatbot-widget");

  contenedor.innerHTML = `
    <button class="cb-launcher" id="cb-launcher" aria-label="Abrir chat">Asistente</button>
    <div class="cb-window" id="cb-window">
      <div class="cb-header">
        <div>
          <div class="cb-header-title">Asistente virtual</div>
          <div class="cb-header-sub">Normalmente responde al instante</div>
        </div>
        <button class="cb-close" id="cb-close" aria-label="Cerrar chat">×</button>
      </div>
      <div class="cb-messages" id="cb-messages"></div>
      <div class="cb-inputbar">
        <input type="text" class="cb-input" id="cb-input" placeholder="Escribe tu mensaje..." />
        <button class="cb-send" id="cb-send" aria-label="Enviar">➤</button>
      </div>
    </div>
  `;

  const launcher = document.getElementById("cb-launcher");
  const ventana = document.getElementById("cb-window");
  const cerrar = document.getElementById("cb-close");
  const mensajesEl = document.getElementById("cb-messages");
  const input = document.getElementById("cb-input");
  const botonEnviar = document.getElementById("cb-send");

  let historial = []; // guarda la conversación para dar contexto a la IA
  let abierto = false;

  // Identificador único por visitante, para agrupar sus mensajes en el log del servidor
  function obtenerSesionId() {
    let id = localStorage.getItem("cb_sesion_id");
    if (!id) {
      id = "sesion_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
      localStorage.setItem("cb_sesion_id", id);
    }
    return id;
  }
  const sesionId = obtenerSesionId();

  launcher.addEventListener("click", () => {
    abierto = !abierto;
    ventana.classList.toggle("cb-open", abierto);
    if (abierto && mensajesEl.children.length === 0) {
      agregarMensaje("bot", "¡Hola! 👋 ¿En qué puedo ayudarte hoy?");
    }
  });

  cerrar.addEventListener("click", () => {
    abierto = false;
    ventana.classList.remove("cb-open");
    if (mensajesEl.children.length > 0) {
      finalizarConversacion();
    }
  });

  // Avisa al servidor de que esta conversación terminó, para que quede marcado en su archivo .txt
  function finalizarConversacion() {
    const payload = JSON.stringify({ sesionId });
    // sendBeacon es más fiable que fetch cuando el usuario está cerrando la pestaña/ventana
    if (navigator.sendBeacon) {
      navigator.sendBeacon(
        FINALIZAR_URL,
        new Blob([payload], { type: "application/json" })
      );
    } else {
      fetch(FINALIZAR_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      });
    }
  }

  // También marcamos el final si el usuario cierra la pestaña o navega a otra página
  window.addEventListener("pagehide", () => {
    if (mensajesEl.children.length > 0) finalizarConversacion();
  });

  function agregarMensaje(tipo, texto) {
    const div = document.createElement("div");
    div.className = `cb-msg ${tipo}`;
    div.textContent = texto;
    mensajesEl.appendChild(div);
    mensajesEl.scrollTop = mensajesEl.scrollHeight;
    return div;
  }

  async function enviarMensaje() {
    const texto = input.value.trim();
    if (!texto) return;

    agregarMensaje("user", texto);
    input.value = "";
    botonEnviar.disabled = true;

    const indicadorEscribiendo = agregarMensaje("bot typing", "Escribiendo...");

    try {
      const resp = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mensaje: texto, historial, sesionId }),
      });

      const data = await resp.json();
      indicadorEscribiendo.remove();

      if (data.error) {
        agregarMensaje("bot", "Ha ocurrido un error. Inténtalo de nuevo en unos segundos.");
      } else {
        agregarMensaje("bot", data.respuesta);
        // Actualizamos el historial (solo si vino de la IA, para dar contexto en la siguiente pregunta)
        historial.push({ role: "user", content: texto });
        historial.push({ role: "assistant", content: data.respuesta });
        // Limitamos el historial para no enviar mensajes de más
        if (historial.length > 10) historial = historial.slice(-10);
      }
    } catch (err) {
      indicadorEscribiendo.remove();
      agregarMensaje("bot", "No se pudo conectar con el servidor.");
    } finally {
      botonEnviar.disabled = false;
      input.focus();
    }
  }

  botonEnviar.addEventListener("click", enviarMensaje);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") enviarMensaje();
  });
})();
