export function resolveSpeechRecognitionLanguage(selection, browserLanguage = "") {
  if (selection === "vi") return "vi-VN";
  if (selection === "ja") return "ja-JP";

  const locale = String(browserLanguage).trim().toLowerCase();
  if (locale.startsWith("vi")) return "vi-VN";
  if (locale.startsWith("ja")) return "ja-JP";
  return "vi-VN";
}

function getErrorState(error) {
  switch (error) {
    case "not-allowed":
    case "service-not-allowed":
      return "permission-denied";
    case "no-speech":
      return "no-speech";
    case "audio-capture":
      return "microphone-unavailable";
    case "aborted":
      return "stopped";
    default:
      return "error";
  }
}

function getStartErrorState(error) {
  if (
    error?.name === "NotAllowedError" ||
    error?.name === "SecurityError" ||
    error?.name === "NotReadableError"
  ) {
    return error.name === "NotReadableError"
      ? "microphone-unavailable"
      : "permission-denied";
  }

  return "error";
}

export function createSpeechInput({
  SpeechRecognition,
  getLanguage,
  onTranscript = () => {},
  onStatus = () => {},
  timeoutMs = 60_000,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  const isSupported = typeof SpeechRecognition === "function";
  let recognition = null;
  let listening = false;
  let timeoutHandle = null;
  let finalText = "";
  let interimText = "";
  let errorState = null;
  let stoppedByUser = false;
  let timedOut = false;

  function publishTranscript() {
    onTranscript({ finalText, interimText });
  }

  function clearRecognitionTimeout() {
    if (timeoutHandle === null) return;
    clearTimer(timeoutHandle);
    timeoutHandle = null;
  }

  function finish(session, state) {
    if (recognition !== session || !listening) return;

    listening = false;
    clearRecognitionTimeout();
    interimText = "";
    publishTranscript();
    onStatus(
      state ||
        (finalText
          ? "recognized"
          : timedOut
            ? "timeout"
            : stoppedByUser
              ? "stopped"
              : "no-speech"),
    );
  }

  function start() {
    if (!isSupported) {
      onStatus("unavailable");
      return false;
    }
    if (listening) return false;

    let session;
    try {
      session = new SpeechRecognition();
    } catch {
      onStatus("error");
      return false;
    }

    recognition = session;
    listening = true;
    finalText = "";
    interimText = "";
    errorState = null;
    stoppedByUser = false;
    timedOut = false;
    publishTranscript();
    onStatus("requesting");

    try {
      session.lang = getLanguage?.() || "vi-VN";
      session.interimResults = true;
      session.continuous = false;
      session.maxAlternatives = 1;

      session.onstart = () => {
        if (recognition === session && listening) onStatus("listening");
      };

      session.onresult = (event) => {
        if (recognition !== session || !listening) return;

        const finalParts = [];
        const interimParts = [];
        for (let index = 0; index < event.results.length; index += 1) {
          const result = event.results[index];
          const transcript = String(result?.[0]?.transcript || "").trim();
          if (!transcript) continue;
          (result.isFinal ? finalParts : interimParts).push(transcript);
        }

        finalText = finalParts.join(" ");
        interimText = interimParts.join(" ");
        publishTranscript();
      };

      session.onerror = (event) => {
        if (recognition !== session || !listening) return;
        errorState = getErrorState(event?.error);
        finish(session, errorState);
      };

      session.onend = () => {
        finish(session, errorState);
      };

      session.start();
      timeoutHandle = setTimer(() => {
        if (recognition !== session || !listening) return;
        timedOut = true;
        try {
          session.stop();
        } catch {
          finish(session);
        }
      }, timeoutMs);
      return true;
    } catch (error) {
      finish(session, getStartErrorState(error));
      return false;
    }
  }

  function stop() {
    if (!listening || !recognition) return false;

    stoppedByUser = true;
    onStatus("stopping");
    try {
      recognition.stop();
    } catch {
      finish(recognition, finalText ? "recognized" : "stopped");
    }
    return true;
  }

  return {
    isSupported,
    get isListening() {
      return listening;
    },
    start,
    stop,
  };
}