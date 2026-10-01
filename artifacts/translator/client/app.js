const statusCard = document.querySelector("#status-card");
const statusText = document.querySelector("#status-text");
const statusDetail = document.querySelector("#status-detail");
const messageList = document.querySelector("#message-list");
const emptyState = document.querySelector("#empty-state");
const messageForm = document.querySelector("#message-form");
const messageInput = document.querySelector("#message-input");
const sendButton = document.querySelector("#send-button");

let socket = null;
let reconnectTimer = null;
let reconnectAttempt = 0;

function showConnection(state, label, detail) {
  statusCard.dataset.state = state;
  statusText.textContent = label;
  statusDetail.textContent = detail;

  const connected = state === "connected";
  messageInput.disabled = !connected;
  sendButton.disabled = !connected;
}

function appendMessage(message) {
  emptyState?.remove();

  const entry = document.createElement("article");
  entry.className = "message-entry";

  const sender = document.createElement("p");
  sender.className = "message-sender";
  sender.textContent = "Participant";

  const text = document.createElement("p");
  text.className = "message-bubble";
  text.textContent = message.text;

  entry.append(sender, text);
  messageList.append(entry);
  messageList.scrollTop = messageList.scrollHeight;
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
      "Messages are live across connected browsers.",
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

    if (payload.type === "message" && typeof payload.text === "string") {
      appendMessage(payload);
    } else if (payload.type === "error" && typeof payload.message === "string") {
      statusDetail.textContent = payload.message;
    }
  });

  currentSocket.addEventListener("close", () => {
    if (socket !== currentSocket) return;

    socket = null;
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
  if (!text || socket?.readyState !== WebSocket.OPEN) return;

  try {
    socket.send(JSON.stringify({ type: "message", text }));
    messageInput.value = "";
    messageInput.focus();
  } catch {
    showConnection(
      "unavailable",
      "WebSocket disconnected",
      "Your message could not be sent. Reconnecting automatically…",
    );
    socket.close();
  }
});

connectWebSocket();