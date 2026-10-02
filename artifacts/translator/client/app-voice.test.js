import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import {
  createSpeechInput,
  resolveSpeechRecognitionLanguage,
} from "./speech-input.js";

class FakeElement {
  constructor() {
    this.children = [];
    this.parent = null;
    this.listeners = new Map();
    this.dataset = {};
    this.attributes = {};
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.maxLength = 1000;
    this.scrollTop = 0;
    this.scrollHeight = 1000;
    this.clientHeight = 200;
    this._text = "";
  }

  set textContent(value) {
    this._text = String(value);
    for (const child of this.children) child.parent = null;
    this.children = [];
  }

  get textContent() {
    return this._text + this.children.map((child) => child.textContent).join("");
  }

  append(...nodes) {
    for (const node of nodes) {
      if (node.parent) node.remove();
      node.parent = this;
      this.children.push(node);
    }
  }

  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }

  addEventListener(type, callback) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(callback);
    this.listeners.set(type, listeners);
  }

  emit(type, event = {}) {
    for (const callback of this.listeners.get(type) || []) callback(event);
  }

  click() {
    if (!this.disabled && !this.hidden) this.emit("click");
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  querySelector(selector) {
    const className = selector.startsWith(".") ? selector.slice(1) : "";
    for (const child of this.children) {
      if (child.className?.split(/\s+/).includes(className)) return child;
      const nested = child.querySelector(selector);
      if (nested) return nested;
    }
    return null;
  }
}

function createClientHarness({ speechSupported = true } = {}) {
  const selectors = [
    "#status-card",
    "#status-text",
    "#status-detail",
    "#message-list",
    "#empty-state",
    "#message-form",
    "#message-input",
    "#send-button",
    "#message-error",
    "#microphone-button",
    "#voice-language",
    "#voice-status",
  ];
  const elements = new Map(selectors.map((selector) => [selector, new FakeElement()]));
  elements.get("#voice-language").value = "auto";
  elements.get("#message-list").append(elements.get("#empty-state"));
  const sent = [];

  class FakeWebSocket {
    static OPEN = 1;
    static CONNECTING = 0;

    constructor(url) {
      this.url = url;
      this.readyState = FakeWebSocket.CONNECTING;
      this.listeners = new Map();
      FakeWebSocket.instance = this;
      setTimeout(() => {
        this.readyState = FakeWebSocket.OPEN;
        this.emit("open");
      }, 0);
    }

    addEventListener(type, callback) {
      const listeners = this.listeners.get(type) || [];
      listeners.push(callback);
      this.listeners.set(type, listeners);
    }

    emit(type, event = {}) {
      for (const callback of this.listeners.get(type) || []) callback(event);
    }

    send(data) {
      const payload = JSON.parse(data);
      sent.push(payload);
      if (payload.type !== "message") return;

      const messageId = `server-${payload.requestId}`;
      const sourceLanguage = /[ぁ-ヿ一-龯]/u.test(payload.text) ? "ja" : "vi";
      const targetLanguage = sourceLanguage === "ja" ? "vi" : "ja";
      setTimeout(() => {
        this.emit("message", {
          data: JSON.stringify({
            type: "message",
            messageId,
            requestId: payload.requestId,
            sender: "Participant",
            originalText: payload.text,
            translationStatus: "translating",
          }),
        });
        this.emit("message", {
          data: JSON.stringify({
            type: "translation",
            messageId,
            requestId: payload.requestId,
            sourceLanguage,
            targetLanguage,
            translatedText: "Test translation",
          }),
        });
      }, 0);
    }

    close() {
      this.readyState = 3;
      this.emit("close");
    }
  }

  class FakeSpeechRecognition {
    static instances = [];

    constructor() {
      this.startCount = 0;
      this.stopCount = 0;
      FakeSpeechRecognition.instances.push(this);
    }

    start() {
      this.startCount += 1;
      this.onstart?.();
    }

    stop() {
      this.stopCount += 1;
      this.onend?.();
    }
  }

  const appPath = new URL("./app.js", import.meta.url);
  return readFile(appPath, "utf8").then((source) => {
    const appSource = source.replace(
      /^import\s*\{\s*createSpeechInput,\s*resolveSpeechRecognitionLanguage\s*,?\s*\}\s*from\s*["']\.\/speech-input\.js["'];\s*/,
      "",
    );
    assert.notEqual(appSource, source, "The client speech-input import is present.");

    const context = vm.createContext({
      document: {
        querySelector: (selector) => elements.get(selector),
        createElement: () => new FakeElement(),
      },
      window: {
        location: { href: "https://translator.test/", protocol: "https:" },
        isSecureContext: true,
        navigator: { language: "en-US" },
        SpeechRecognition: speechSupported ? FakeSpeechRecognition : undefined,
        setTimeout,
        clearTimeout,
      },
      WebSocket: FakeWebSocket,
      URL,
      Date,
      Math,
      Map,
      Set,
      crypto: { randomUUID: () => `request-${sent.length + 1}` },
      setTimeout,
      clearTimeout,
      createSpeechInput,
      resolveSpeechRecognitionLanguage,
    });
    vm.runInContext(appSource, context);

    return {
      elements,
      sent,
      FakeSpeechRecognition,
    };
  });
}

function speechResult(transcript, isFinal) {
  const result = [{ transcript }];
  result.isFinal = isFinal;
  return result;
}

async function waitFor(predicate, label) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const result = predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

test("voice transcript is editable and sends once through the existing text WebSocket path", async () => {
  const { elements, sent, FakeSpeechRecognition } = await createClientHarness();
  const microphone = elements.get("#microphone-button");
  const input = elements.get("#message-input");
  const form = elements.get("#message-form");
  const messageList = elements.get("#message-list");

  await waitFor(() => !microphone.disabled, "WebSocket connection");
  input.value = "Draft:";
  microphone.click();
  const recognition = FakeSpeechRecognition.instances[0];
  assert.equal(recognition.lang, "vi-VN", "Auto falls back to Vietnamese for an English browser locale.");
  assert.equal(input.disabled, true);
  assert.equal(elements.get("#voice-language").disabled, true);

  recognition.onresult({
    results: [speechResult("Xin chào", false)],
  });
  assert.equal(input.value, "Draft: Xin chào");
  assert.equal(sent.filter((payload) => payload.type === "message").length, 0);

  recognition.onresult({
    results: [speechResult("Xin chào.", true)],
  });
  recognition.onend();
  assert.equal(input.value, "Draft: Xin chào.");
  assert.match(elements.get("#voice-status").textContent, /Speech recognized/);
  assert.equal(input.disabled, false);

  input.value = "Xin chào, edited.";
  form.emit("submit", { preventDefault() {} });
  assert.equal(input.value, "");
  assert.equal(sent.filter((payload) => payload.type === "message").length, 1);
  assert.equal(sent.find((payload) => payload.type === "message").text, "Xin chào, edited.");

  await waitFor(
    () => messageList.querySelector(".message-entry")?.querySelector(".message-translation")?.dataset.state === "translated",
    "existing translation flow",
  );
  assert.equal(
    messageList.children.filter((child) => child.className === "message-entry").length,
    1,
  );

  input.value = "こんにちは。";
  form.emit("submit", { preventDefault() {} });
  assert.equal(sent.filter((payload) => payload.type === "message").length, 2);
  assert.equal(sent.at(-1).text, "こんにちは。");
});

test("permission denial and unsupported browsers are visible without creating messages", async () => {
  const supported = await createClientHarness();
  await waitFor(
    () => !supported.elements.get("#microphone-button").disabled,
    "WebSocket connection",
  );
  supported.elements.get("#microphone-button").click();
  supported.FakeSpeechRecognition.instances[0].onerror({ error: "not-allowed" });
  assert.match(
    supported.elements.get("#voice-status").textContent,
    /permission denied/i,
  );
  assert.equal(
    supported.sent.filter((payload) => payload.type === "message").length,
    0,
  );
  assert.equal(
    supported.elements
      .get("#message-list")
      .children.filter((child) => child.className === "message-entry").length,
    0,
  );

  const unsupported = await createClientHarness({ speechSupported: false });
  await waitFor(
    () => unsupported.elements.get("#status-card").dataset.state === "connected",
    "WebSocket connection",
  );
  assert.equal(unsupported.elements.get("#microphone-button").disabled, true);
  assert.match(
    unsupported.elements.get("#voice-status").textContent,
    /unavailable/i,
  );
  assert.equal(unsupported.elements.get("#message-input").disabled, false);
});