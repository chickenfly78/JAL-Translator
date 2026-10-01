import assert from "node:assert/strict";
import test from "node:test";
import { createTranslationFlow } from "./translation-flow.js";
import { isTemporaryTranslationError } from "./translation-errors.js";

function waitForEvent(events, predicate) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const poll = () => {
      const event = events.find(predicate);
      if (event) {
        resolve(event);
        return;
      }

      attempts += 1;
      if (attempts >= 50) {
        reject(new Error("Timed out waiting for translation-flow event."));
        return;
      }
      setImmediate(poll);
    };
    poll();
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("a temporary failure can retry one message without broadcasting a duplicate", async () => {
  const events = [];
  let attempts = 0;
  const flow = createTranslationFlow({
    createMessageId: () => "message-1",
    broadcast: (event) => events.push(event),
    translate: async (text) => {
      attempts += 1;
      assert.equal(text, "Xin chào.");
      if (attempts === 1) {
        throw Object.assign(new Error("Service overloaded"), { status: 503 });
      }
      return {
        sourceLanguage: "vi",
        targetLanguage: "ja",
        translatedText: "こんにちは。",
      };
    },
  });

  const messageId = flow.submit({ requestId: "request-1", text: "Xin chào." });
  assert.equal(messageId, "message-1");
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "message");
  assert.equal(events[0].originalText, "Xin chào.");

  const failure = await waitForEvent(
    events,
    (event) => event.type === "translation-error",
  );
  assert.equal(failure.message, "Translation temporarily unavailable");
  assert.equal(failure.retryable, true);
  assert.equal(failure.messageId, messageId);

  assert.equal(flow.retry(messageId), true);
  assert.equal(flow.retry(messageId), true);
  await waitForEvent(events, (event) => event.type === "translation");

  assert.equal(attempts, 2);
  assert.equal(events.filter((event) => event.type === "message").length, 1);
  assert.equal(
    events.filter((event) => event.type === "translation-progress").length,
    1,
  );
  assert.equal(flow.retry(messageId), false);
});

test("several translation requests can be in flight and finish independently", async () => {
  const events = [];
  const pending = new Map();
  const flow = createTranslationFlow({
    createMessageId: (() => {
      let next = 0;
      return () => `message-${++next}`;
    })(),
    broadcast: (event) => events.push(event),
    translate: (text) => {
      const request = deferred();
      pending.set(text, request);
      return request.promise;
    },
  });

  flow.submit({ requestId: "request-vi", text: "Xin chào." });
  flow.submit({ requestId: "request-ja", text: "こんにちは。" });

  assert.equal(events.filter((event) => event.type === "message").length, 2);
  assert.equal(pending.size, 2);

  pending.get("こんにちは。").resolve({
    sourceLanguage: "ja",
    targetLanguage: "vi",
    translatedText: "Xin chào.",
  });
  await waitForEvent(
    events,
    (event) =>
      event.type === "translation" &&
      event.requestId === "request-ja",
  );

  assert.equal(
    events.some(
      (event) =>
        event.type === "translation" &&
        event.requestId === "request-vi",
    ),
    false,
  );

  pending.get("Xin chào.").resolve({
    sourceLanguage: "vi",
    targetLanguage: "ja",
    translatedText: "こんにちは。",
  });
  await waitForEvent(
    events,
    (event) =>
      event.type === "translation" &&
      event.requestId === "request-vi",
  );
});

test("temporary overloads and timeouts are retryable, but permanent errors are not", () => {
  assert.equal(isTemporaryTranslationError({ status: 503 }), true);
  assert.equal(isTemporaryTranslationError({ message: "Model overloaded" }), true);
  assert.equal(
    isTemporaryTranslationError(
      Object.assign(new Error("connection timed out"), { code: "ETIMEDOUT" }),
    ),
    true,
  );
  assert.equal(isTemporaryTranslationError({ status: 401 }), false);
});