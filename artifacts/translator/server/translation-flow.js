import { randomUUID } from "node:crypto";
import { isTemporaryTranslationError } from "./translation-errors.js";

export function createTranslationFlow({
  translate,
  broadcast,
  onFailure = () => {},
  createMessageId = randomUUID,
  maxFailedEntries = 500,
}) {
  const messages = new Map();

  function pruneFailedEntries() {
    let failedCount = 0;
    for (const message of messages.values()) {
      if (message.status === "failed") failedCount += 1;
    }

    if (failedCount <= maxFailedEntries) return;

    for (const [messageId, message] of messages) {
      if (message.status !== "failed") continue;
      messages.delete(messageId);
      failedCount -= 1;
      if (failedCount <= maxFailedEntries) break;
    }
  }

  async function performTranslation(message) {
    let translation;
    try {
      translation = await translate(message.text);
    } catch (error) {
      const unsupported = error?.code === "UNSUPPORTED_LANGUAGE";
      const retryable = !unsupported && isTemporaryTranslationError(error);

      message.status = "failed";
      if (retryable) {
        messages.delete(message.messageId);
        messages.set(message.messageId, message);
        pruneFailedEntries();
      } else {
        messages.delete(message.messageId);
      }

      try {
        onFailure({ error, unsupported, retryable });
      } catch {
        // Logging failures must not prevent a client-safe result from being sent.
      }

      broadcast({
        type: "translation-error",
        messageId: message.messageId,
        requestId: message.requestId,
        retryable,
        message: unsupported
          ? "Please enter a message in Vietnamese or Japanese."
          : retryable
            ? "Translation temporarily unavailable"
            : "Translation could not be completed.",
      });
      return;
    }

    messages.delete(message.messageId);
    message.status = "translated";
    broadcast({
      type: "translation",
      messageId: message.messageId,
      requestId: message.requestId,
      ...translation,
    });
  }

  function submit({ requestId, text }) {
    const message = {
      messageId: createMessageId(),
      requestId,
      text,
      status: "translating",
    };

    messages.set(message.messageId, message);
    broadcast({
      type: "message",
      messageId: message.messageId,
      requestId: message.requestId,
      sender: "Participant",
      originalText: message.text,
      translationStatus: "translating",
      sentAt: new Date().toISOString(),
    });

    void performTranslation(message);
    return message.messageId;
  }

  function retry(messageId) {
    const message = messages.get(messageId);
    if (!message) return false;
    if (message.status === "translating") return true;
    if (message.status !== "failed") return false;

    message.status = "translating";
    broadcast({
      type: "translation-progress",
      messageId: message.messageId,
      requestId: message.requestId,
    });
    void performTranslation(message);
    return true;
  }

  return { submit, retry };
}