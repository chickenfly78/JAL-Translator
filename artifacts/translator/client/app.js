import {
  createSpeechInput,
  resolveSpeechRecognitionLanguage,
} from "./speech-input.js";

const statusCard = document.querySelector("#status-card");
const statusText = document.querySelector("#status-text");
const statusDetail = document.querySelector("#status-detail");
const messageList = document.querySelector("#message-list");
const emptyState = document.querySelector("#empty-state");
const messageForm = document.querySelector("#message-form");
const messageInput = document.querySelector("#message-input");
const sendButton = document.querySelector("#send-button");
const messageError = document.querySelector("#message-error");
const microphoneButton = document.querySelector("#microphone-button");
const voiceLanguageSelect = document.querySelector("#voice-language");
const voiceStatus = document.querySelector("#voice-status");

const languages = {
  vi: { flag: "🇻🇳", name: "Vietnamese", code: "VI" },
  ja: { flag: "🇯🇵", name: "Japanese", code: "JP" },
};

let socket = null;
let reconnectTimer = null;
let reconnectAttempt = 0;
let speechInput = null;
let voiceDraft = "";
const messagesById = new Map();
const messagesByRequestId = new Map();

function updateComposerState() {
  const connected = socket?.readyState === WebSocket.OPEN;
  const listening = speechInput?.isListening === true;
  messageInput.disabled = !connected || listening;
  sendButton.disabled = !connected || listening;
  microphoneButton.disabled =
    !speechInput?.isSupported || (!connected && !listening);
  microphoneButton.textContent = listening ? "Stop" : "🎤";
  microphoneButton.setAttribute(
    "aria-label",
    listening ? "Stop recording" : "Start voice input",
  );
  microphoneButton.dataset.listening = String(listening);
  voiceLanguageSelect.disabled = listening;

  for (const record of new Set([
    ...messagesById.values(),
    ...messagesByRequestId.values(),
  ])) {
    if (record.status === "unavailable") {
      record.retryButton.disabled = !connected;
    }
  }
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

const voiceStatusMessages = {
  ready: "Microphone ready",
  requesting: "Requesting microphone permission…",
  listening: "Listening…",
  stopping: "Stopping microphone…",
  recognized: "Speech recognized. Review or edit it before sending.",
  "permission-denied":
    "Microphone permission denied. Allow access in your browser settings.",
  "microphone-unavailable":
    "Microphone unavailable. Check your device and browser permissions.",
  "connection-unavailable": "Connect to use voice input.",
  "secure-context-required":
    "Voice input requires a secure browser connection.",
  "no-speech": "No speech detected. No message was sent.",
  stopped: "Microphone stopped. No message was sent.",
  timeout: "Speech recognition timed out. Try again.",
  error: "Speech recognition error. Please try again.",
  unavailable: "Speech recognition unavailable in this browser.",
};

function updateVoiceStatus(state) {
  voiceStatus.dataset.state = state;
  voiceStatus.textContent =
    voiceStatusMessages[state] || voiceStatusMessages.error;
  updateComposerState();
}

function updateVoiceTranscript({ finalText, interimText }) {
  const transcript = [finalText, interimText]
    .filter((part) => typeof part === "string" && part.trim())
    .join(" ")
    .trim();
  const draft = voiceDraft.trimEnd();
  messageInput.value =
    draft && transcript
      ? `${draft} ${transcript}`
      : draft || transcript;
}

function isNearNewestMessage() {
  return (
    messageList.scrollHeight -
      messageList.scrollTop -
      messageList.clientHeight <=
    40
  );
}

function scrollMessagesToBottomIfFollowing(shouldFollow) {
  if (shouldFollow) {
    messageList.scrollTop = messageList.scrollHeight;
  }
}

function findMessageRecord(message) {
  if (typeof message.messageId === "string") {
    const record = messagesById.get(message.messageId);
    if (record) return record;
  }

  if (typeof message.requestId === "string") {
    return messagesByRequestId.get(message.requestId) || null;
  }

  return null;
}

function createMessageRecord({ messageId, requestId, originalText }) {
  const shouldFollow = isNearNewestMessage();
  emptyState?.remove();

  const entry = document.createElement("article");
  entry.className = "message-entry";

  const header = document.createElement("div");
  header.className = "message-header";

  const sender = document.createElement("p");
  sender.className = "message-sender";
  sender.textContent = "Participant";
  sender.setAttribute("aria-label", "Participant");

  const direction = document.createElement("span");
  direction.className = "message-direction";
  direction.hidden = true;

  const original = document.createElement("p");
  original.className = "message-original";
  original.textContent = originalText;

  const translated = document.createElement("div");
  translated.className = "message-translation";
  translated.dataset.state = "translating";
  translated.setAttribute("aria-live", "polite");
  translated.setAttribute("aria-atomic", "true");

  const flag = document.createElement("span");
  flag.className = "message-language-flag";
  flag.setAttribute("aria-hidden", "true");
  flag.hidden = true;

  const accessibleLabel = document.createElement("span");
  accessibleLabel.className = "sr-only";

  const translatedText = document.createElement("span");
  translatedText.className = "translated-text";
  translatedText.textContent = "Translating...";

  const retryButton = document.createElement("button");
  retryButton.className = "retry-button";
  retryButton.type = "button";
  retryButton.textContent = "Retry";
  retryButton.setAttribute("aria-label", "Retry translation");
  retryButton.hidden = true;

  translated.append(flag, accessibleLabel, translatedText, retryButton);
  header.append(sender, direction);
  entry.append(header, original, translated);
  messageList.append(entry);

  const record = {
    messageId,
    requestId,
    entry,
    direction,
    sender,
    original,
    translation: translated,
    flag,
    accessibleLabel,
    translatedText,
    retryButton,
    status: "translating",
  };

  if (messageId) messagesById.set(messageId, record);
  if (requestId) messagesByRequestId.set(requestId, record);

  retryButton.addEventListener("click", () => {
    retryTranslation(record);
  });

  scrollMessagesToBottomIfFollowing(shouldFollow);
  return record;
}

function upsertMessage(message) {
  if (typeof message.originalText !== "string") return null;

  let record = findMessageRecord(message);
  if (!record) {
    record = createMessageRecord(message);
  } else {
    record.original.textContent = message.originalText;
  }

  if (typeof message.requestId === "string") {
    record.requestId = message.requestId;
    messagesByRequestId.set(message.requestId, record);
  }

  if (typeof message.messageId === "string") {
    record.messageId = message.messageId;
    messagesById.set(message.messageId, record);
    if (record.requestId && messagesByRequestId.get(record.requestId) === record) {
      messagesByRequestId.delete(record.requestId);
    }
  }

  if (typeof message.sender === "string") {
    record.sender.textContent = message.sender;
  }

  if (message.translationStatus === "translating") {
    showTranslating(record);
  }

  return record;
}

function showTranslating(record) {
  const shouldFollow = isNearNewestMessage();
  record.status = "translating";
  record.translation.dataset.state = "translating";
  record.flag.hidden = true;
  record.accessibleLabel.textContent = "";
  record.translatedText.textContent = "Translating...";
  record.retryButton.hidden = true;
  record.retryButton.disabled = true;
  scrollMessagesToBottomIfFollowing(shouldFollow);
}

function showTranslation(record, message) {
  const shouldFollow = isNearNewestMessage();
  const source = languages[message.sourceLanguage];
  const target = languages[message.targetLanguage];
  if (
    !source ||
    !target ||
    typeof message.translatedText !== "string" ||
    !message.translatedText.trim()
  ) {
    showTranslationFailure(record, {
      message: "Translation could not be completed.",
      retryable: false,
    });
    return;
  }

  record.status = "translated";
  record.sender.textContent = `${source.flag} Participant`;
  record.sender.setAttribute("aria-label", `${source.name} participant`);
  record.direction.textContent = `${source.code} → ${target.code}`;
  record.direction.hidden = false;
  record.original.lang = message.sourceLanguage;
  record.translation.lang = message.targetLanguage;
  record.translation.dataset.state = "translated";
  record.flag.hidden = false;
  record.flag.textContent = target.flag;
  record.accessibleLabel.textContent = `${target.name} translation: `;
  record.translatedText.textContent = message.translatedText;
  record.retryButton.hidden = true;
  record.retryButton.disabled = true;
  scrollMessagesToBottomIfFollowing(shouldFollow);
}

function showTranslationFailure(record, message) {
  const shouldFollow = isNearNewestMessage();
  record.status = message.retryable ? "unavailable" : "failed";
  record.translation.dataset.state = message.retryable ? "unavailable" : "error";
  record.flag.hidden = true;
  record.accessibleLabel.textContent = "";
  record.translatedText.textContent = message.message;
  record.retryButton.hidden = !message.retryable;
  record.retryButton.disabled =
    !message.retryable || socket?.readyState !== WebSocket.OPEN;
  scrollMessagesToBottomIfFollowing(shouldFollow);
}

function retryTranslation(record) {
  if (
    !record.messageId ||
    record.status !== "unavailable" ||
    socket?.readyState !== WebSocket.OPEN
  ) {
    return;
  }

  clearMessageError();
  showTranslating(record);
  try {
    socket.send(JSON.stringify({ type: "retry", messageId: record.messageId }));
  } catch {
    showTranslationFailure(record, {
      message: "Translation temporarily unavailable",
      retryable: true,
    });
    socket.close();
  }
}

function removeMessageRecord(record) {
  record.entry.remove();
  if (record.messageId && messagesById.get(record.messageId) === record) {
    messagesById.delete(record.messageId);
  }
  if (record.requestId && messagesByRequestId.get(record.requestId) === record) {
    messagesByRequestId.delete(record.requestId);
  }

  if (messageList.querySelector(".message-entry") === null && emptyState) {
    messageList.append(emptyState);
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
      upsertMessage(payload);
      return;
    }

    if (payload.type === "translation-progress") {
      const record = findMessageRecord(payload);
      if (record) showTranslating(record);
      return;
    }

    if (payload.type === "translation") {
      const record = findMessageRecord(payload);
      if (record) showTranslation(record, payload);
      return;
    }

    if (payload.type === "translation-error") {
      const record = findMessageRecord(payload);
      if (record) {
        showTranslationFailure(record, payload);
      } else if (typeof payload.message === "string") {
        showMessageError(payload.message);
      }
      return;
    }

    if (payload.type === "error" && typeof payload.message === "string") {
      const record = findMessageRecord(payload);
      if (record) removeMessageRecord(record);
      showMessageError(payload.message);
    }
  });

  currentSocket.addEventListener("close", () => {
    if (socket !== currentSocket) return;

    socket = null;

    const activeRecords = new Set([
      ...messagesById.values(),
      ...messagesByRequestId.values(),
    ]);
    for (const record of activeRecords) {
      if (record.status !== "translating") continue;
      showTranslationFailure(record, {
        message: record.messageId
          ? "Translation temporarily unavailable"
          : "Connection interrupted before the message was confirmed.",
        retryable: Boolean(record.messageId),
      });
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

function sendMessage(messageText) {
  if (speechInput?.isListening) return false;

  const text = String(messageText || "").trim();
  if (!text || socket?.readyState !== WebSocket.OPEN) return false;

  const maxLength =
    Number(messageInput.maxLength) > 0 ? Number(messageInput.maxLength) : 1000;
  if (text.length > maxLength) {
    showMessageError(
      `Messages must be ${maxLength} characters or fewer.`,
    );
    return false;
  }

  const requestId =
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  clearMessageError();
  const record = createMessageRecord({ requestId, originalText: text });

  try {
    socket.send(JSON.stringify({ type: "message", requestId, text }));
    messageInput.value = "";
    voiceDraft = "";
    if (voiceStatus.dataset.state === "recognized") {
      updateVoiceStatus("ready");
    }
    return true;
  } catch {
    removeMessageRecord(record);
    showMessageError("Your message could not be sent. Please try again.");
    socket.close();
    return false;
  }
}

messageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage(messageInput.value);
});

const speechRecognitionConstructor =
  window.SpeechRecognition || window.webkitSpeechRecognition;
const secureContext = window.isSecureContext !== false;
speechInput = createSpeechInput({
  SpeechRecognition: secureContext ? speechRecognitionConstructor : null,
  getLanguage: () =>
    resolveSpeechRecognitionLanguage(
      voiceLanguageSelect.value,
      window.navigator?.language || "",
    ),
  onTranscript: updateVoiceTranscript,
  onStatus: updateVoiceStatus,
});

updateVoiceStatus(
  secureContext
    ? speechInput.isSupported
      ? "ready"
      : "unavailable"
    : "secure-context-required",
);

microphoneButton.addEventListener("click", () => {
  if (speechInput.isListening) {
    speechInput.stop();
    return;
  }

  if (socket?.readyState !== WebSocket.OPEN) {
    updateVoiceStatus("connection-unavailable");
    return;
  }

  voiceDraft = messageInput.value;
  speechInput.start();
});

connectWebSocket();