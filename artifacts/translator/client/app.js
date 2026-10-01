const statusCard = document.querySelector("#status-card");
const statusText = document.querySelector("#status-text");
const statusDetail = document.querySelector("#status-detail");
const checkedAt = document.querySelector("#checked-at");
const checkButton = document.querySelector("#check-button");

let requestInProgress = false;

function showState(state, label, detail) {
  statusCard.dataset.state = state;
  statusText.textContent = label;
  statusDetail.textContent = detail;
}

async function checkServer() {
  if (requestInProgress) return;
  requestInProgress = true;
  checkButton.disabled = true;
  checkButton.textContent = "Checking…";
  showState("checking", "Checking server…", "Checking whether the server is reachable.");

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch("/status", {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }

    showState("connected", "Server connected", "The status endpoint responded successfully.");
  } catch (error) {
    const detail = error.name === "AbortError"
      ? "The server did not respond in time. Try checking again."
      : "The server is unavailable right now. Try checking again.";
    showState("unavailable", "Server unavailable", detail);
  } finally {
    window.clearTimeout(timeout);
    checkedAt.textContent = `LAST CHECK · ${new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date())}`;
    checkButton.disabled = false;
    checkButton.textContent = "Check connection";
    requestInProgress = false;
  }
}

checkButton.addEventListener("click", checkServer);
checkServer();
window.setInterval(checkServer, 15000);