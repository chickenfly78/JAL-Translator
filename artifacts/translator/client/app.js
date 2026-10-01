const statusCard = document.querySelector("#status-card");
const statusText = document.querySelector("#status-text");
const statusDetail = document.querySelector("#status-detail");
const messageList = document.querySelector("#message-list");
const emptyState = document.querySelector("#empty-state");
const messageForm = document.querySelector("#message-form");
const messageInput = document.querySelector("#message-input");
const sendButton = document.querySelector("#send-button");
const messageProcessing = document.querySelector("#message-processing");
const messageError = document.querySelector("#message-error");

const languages = {
  vi: { flag: "🇻🇳", name: "Vietnamese" },
  ja: { flag: "🇯🇵", name: "Japanese" },
};

let socket = null;
let reconnectTimer = null;
let reconnectAttempt = 0;
let pendingRequestId = null;

function updateComposerState() {
  const connected = socket?.readyState === WebSocket.OPEN;
  const waitingForTranslation = pendingRequestId !== null;
  messageInput.disabled = !connected || waitingForTranslation;
  sendButton.disabled = !connected || waitingForTranslation;
}

function showConnection(state, label, detail) {
  statusCard.dataset.state = state;
  statusText.textContent = label;
  statusDetail.textContent = detail;
  updateComposerState();
}

function showMessageError(message) {
  messageError.textContent = message;
  messageError.hidden = false;
}

function clearMessageError() {
  messageError.textContent = "";
  messageError.hidden = true;
}

function appendMessage(message) {
  const source = languages[message.sourceLanguage];
  const target = languages[message.targetLanguage];
  if (
    !source ||
    !target ||
    typeof message.originalText !== "string" ||
    typeof message.translatedText !== "string"
  ) {
    return;
  }

  emptyState?.remove();

  const entry = document.createElement("article");
  entry.className = "message-entry";

  const sender = document.createElement("p");
  sender.className = "message-sender";
  sender.textContent = `${source.flag} Participant`;
  sender.setAttribute("aria-label", `${source.name} participant`);

  const original = document.createElement("p");
  original.className = "message-original";
  original.lang = message.sourceLanguage;
  original.textContent = message.originalText;

  const translated = document.createElement("p");
  translated.className = "message-translation";
  translated.lang = message.targetLanguage;

  const flag = document.createElement("span");
  flag.className = "message-language-flag";
  flag.setAttribute("aria-hidden", "true");
  flag.textContent = target.flag;

  const accessibleLabel = document.createElement("span");
  accessibleLabel.className = "sr-only";
  accessibleLabel.textContent = `${target.name} translation: `;

  const translatedText = document.createElement("span");
  translatedText.className = "translated-text";
  translatedText.textContent = message.translatedText;

  translated.append(flag, accessibleLabel, translatedText);
  entry.append(sender, original, translated);
  messageList.append(entry);
  messageList.scrollTop = messageList.scrollHeight;

  if (message.requestId === pendingRequestId) {
    pendingRequestId = null;
    messageInput.value = "";
    messageProcessing.hidden = true;
    clearMessageError();
    updateComposerState();
  }
}

function scheduleReconnect() {
  if (reconnectTimer !== null) return;

  const delay = Math.min(1000 * 2 ** reconnectAttempt, 15000);
  reconnectAttempt += 1;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    connectWebSocket();
  }, delay);
}

function connectWebSocket() {
  if (
    socket &&
    (socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  showConnection(
    "connecting",
    "Connecting to WebSocket…",
    "Opening the live message connection.",
  );

  const socketUrl = new URL("/ws", window.location.href);
  socketUrl.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";

  try {
    socket = new WebSocket(socketUrl);
  } catch {
    socket = null;
    showConnection(
      "unavailable",
      "WebSocket disconnected",
      "Reconnecting automatically…",
    );
    scheduleReconnect();
    return;
  }

  const currentSocket = socket;

  currentSocket.addEventListener("open", () => {
    if (socket !== currentSocket) return;

    reconnectAttempt = 0;
    showConnection(
      "connected",
      "WebSocket connected",
      "Messages and translations are live across connected browsers.",
    );
  });

  currentSocket.addEventListener("message", (event) => {
    if (socket !== currentSocket) return;

    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }

    if (payload.type === "message") {
      appendMessage(payload);
      return;
    }

    if (payload.type === "error" && typeof payload.message === "string") {
      if (payload.requestId && payload.requestId !== pendingRequestId) return;

      pendingRequestId = null;
      messageProcessing.hidden = true;
      updateComposerState();
      showMessageError(payload.message);
    }
  });

  currentSocket.addEventListener("close", () => {
    if (socket !== currentSocket) return;

    socket = null;
    if (pendingRequestId !== null) {
      pendingRequestId = null;
      messageProcessing.hidden = true;
      showMessageError(
        "The connection was interrupted before translation finished. Please try again.",
      );
    }

    showConnection(
      "unavailable",
      "WebSocket disconnected",
      "Reconnecting automatically…",
    );
    scheduleReconnect();
  });

  currentSocket.addEventListener("error", () => {
    if (socket === currentSocket) currentSocket.close();
  });
}

messageForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const text = messageInput.value.trim();
  if (
    !text ||
    socket?.readyState !== WebSocket.OPEN ||
    pendingRequestId !== null
  ) {
    return;
  }

  pendingRequestId =
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  clearMessageError();
  messageProcessing.hidden = false;
  messageProcessing.textContent = "Translating and sharing…";
  updateComposerState();

  try {
    socket.send(JSON.stringify({ type: "message", requestId: pendingRequestId, text }));
  } catch {
    pendingRequestId = null;
    messageProcessing.hidden = true;
    updateComposerState();
    showMessageError("Your message could not be sent. Please try again.");
    socket.close();
  }
});

connectWebSocket();