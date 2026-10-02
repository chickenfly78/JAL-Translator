import assert from "node:assert/strict";
import test from "node:test";
import {
  createSpeechInput,
  resolveSpeechRecognitionLanguage,
} from "./speech-input.js";

function createRecognitionHarness(options = {}) {
  const instances = [];
  class FakeRecognition {
    constructor() {
      this.results = [];
      this.startCount = 0;
      this.stopCount = 0;
      instances.push(this);
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

  const transcripts = [];
  const statuses = [];
  const input = createSpeechInput({
    SpeechRecognition: FakeRecognition,
    getLanguage: () => "vi-VN",
    onTranscript: (transcript) => transcripts.push(transcript),
    onStatus: (status) => statuses.push(status),
    ...options,
  });

  return { input, instances, transcripts, statuses };
}

function speechResult(transcript, isFinal) {
  const alternative = { transcript };
  const result = [alternative];
  result.isFinal = isFinal;
  return result;
}

test("speech language selection uses Vietnamese, Japanese, and an honest Auto fallback", () => {
  assert.equal(resolveSpeechRecognitionLanguage("vi", "ja-JP"), "vi-VN");
  assert.equal(resolveSpeechRecognitionLanguage("ja", "vi-VN"), "ja-JP");
  assert.equal(resolveSpeechRecognitionLanguage("auto", "ja-JP"), "ja-JP");
  assert.equal(resolveSpeechRecognitionLanguage("auto", "vi-VN"), "vi-VN");
  assert.equal(resolveSpeechRecognitionLanguage("auto", "en-US"), "vi-VN");
});

test("interim text stays separate and final text remains after recognition ends", () => {
  const { input, instances, transcripts, statuses } = createRecognitionHarness();
  assert.equal(input.start(), true);
  const recognition = instances[0];

  recognition.onresult({
    results: [speechResult("Xin chào", false)],
  });
  assert.deepEqual(transcripts.at(-1), {
    finalText: "",
    interimText: "Xin chào",
  });

  recognition.onresult({
    results: [
      speechResult("Xin chào", true),
      speechResult("mọi người", false),
    ],
  });
  recognition.onend();

  assert.deepEqual(transcripts.at(-1), {
    finalText: "Xin chào",
    interimText: "",
  });
  assert.equal(statuses.at(-1), "recognized");
  assert.equal(input.isListening, false);
});

test("permission denial is reported and ends the listening state", () => {
  const { input, instances, statuses } = createRecognitionHarness();
  input.start();
  instances[0].onerror({ error: "not-allowed" });

  assert.equal(statuses.at(-1), "permission-denied");
  assert.equal(input.isListening, false);
});

test("no speech and a manual stop never produce final transcript text", () => {
  const noSpeech = createRecognitionHarness();
  noSpeech.input.start();
  noSpeech.instances[0].onerror({ error: "no-speech" });
  assert.equal(noSpeech.statuses.at(-1), "no-speech");
  assert.equal(noSpeech.transcripts.at(-1).finalText, "");

  const stopped = createRecognitionHarness();
  stopped.input.start();
  assert.equal(stopped.input.stop(), true);
  assert.equal(stopped.statuses.at(-1), "stopped");
  assert.equal(stopped.transcripts.at(-1).finalText, "");
});

test("recognition timeout stops the microphone and reports a timeout", () => {
  let timeoutCallback;
  const harness = createRecognitionHarness({
    timeoutMs: 1234,
    setTimer(callback, delay) {
      assert.equal(delay, 1234);
      timeoutCallback = callback;
      return 1;
    },
    clearTimer() {},
  });

  harness.input.start();
  timeoutCallback();
  assert.equal(harness.instances[0].stopCount, 1);
  assert.equal(harness.statuses.at(-1), "timeout");
  assert.equal(harness.input.isListening, false);
});

test("unsupported browsers report unavailable without creating a recognition session", () => {
  const statuses = [];
  const input = createSpeechInput({
    SpeechRecognition: null,
    onStatus: (status) => statuses.push(status),
  });

  assert.equal(input.isSupported, false);
  assert.equal(input.start(), false);
  assert.deepEqual(statuses, ["unavailable"]);
});