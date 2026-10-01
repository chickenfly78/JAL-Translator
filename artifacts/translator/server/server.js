import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { translateText } from "./gemini.js";

const clientDirectory = resolve(
  fileURLToPath(new URL("../client/", import.meta.url)),
);
const port = Number(process.env.PORT || 3000);
const maxMessageLength = 1000;

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid PORT value: ${process.env.PORT}`);
}

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function send(response, statusCode, body, contentType = "text/plain; charset=utf-8") {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

async function handleRequest(request, response) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    send(response, 405, "Method not allowed");
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(
      new URL(request.url || "/", "http://localhost").pathname,
    );
  } catch {
    send(response, 400, "Bad request");
    return;
  }

  if (pathname === "/status") {
    send(
      response,
      200,
      request.method === "HEAD" ? "" : JSON.stringify({ status: "connected" }),
      "application/json; charset=utf-8",
    );
    return;
  }

  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = resolve(clientDirectory, relativePath);

  if (filePath !== clientDirectory && !filePath.startsWith(`${clientDirectory}${sep}`)) {
    send(response, 403, "Forbidden");
    return;
  }

  try {
    const file = await readFile(filePath);
    const contentType =
      contentTypes[extname(filePath)] || "application/octet-stream";

    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
    });
    response.end(request.method === "HEAD" ? undefined : file);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EISDIR") {
      send(response, 404, "Not found");
      return;
    }

    process.stderr.write(`Unable to serve request: ${error.message}\n`);
    send(response, 500, "Internal server error");
  }
}

const server = createServer(handleRequest);
const webSocketServer = new WebSocketServer({
  noServer: true,
  maxPayload: 8 * 1024,
});

server.on("upgrade", (request, socket, head) => {
  let pathname;

  try {
    pathname = new URL(request.url || "/", "http://localhost").pathname;
  } catch {
    socket.destroy();
    return;
  }

  if (pathname !== "/ws") {
    socket.destroy();
    return;
  }

  webSocketServer.handleUpgrade(request, socket, head, (webSocketClient) => {
    webSocketServer.emit("connection", webSocketClient, request);
  });
});

function sendSocketError(client, requestId, message) {
  if (client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify({ type: "error", requestId, message }));
  }
}

function broadcast(message) {
  const encoded = JSON.stringify(message);
  for (const recipient of webSocketServer.clients) {
    if (recipient.readyState === WebSocket.OPEN) {
      recipient.send(encoded);
    }
  }
}

async function translateAndBroadcast(client, text, requestId) {
  try {
    const translation = await translateText(text);
    broadcast({
      type: "message",
      requestId,
      sender: "Participant",
      originalText: text,
      ...translation,
      sentAt: new Date().toISOString(),
    });
  } catch (error) {
    const isUnsupportedLanguage = error?.code === "UNSUPPORTED_LANGUAGE";
    if (!isUnsupportedLanguage) {
      process.stderr.write("Gemini translation request failed.\n");
    }

    sendSocketError(
      client,
      requestId,
      isUnsupportedLanguage
        ? "Please enter a message in Vietnamese or Japanese."
        : "Translation failed. Please try again.",
    );
  }
}

webSocketServer.on("connection", (client) => {
  client.on("message", (data, isBinary) => {
    if (isBinary) {
      client.close(1003, "Text messages only");
      return;
    }

    let payload;
    try {
      payload = JSON.parse(data.toString());
    } catch {
      sendSocketError(client, null, "Message must be valid JSON.");
      return;
    }

    if (payload?.type !== "message" || typeof payload.text !== "string") {
      sendSocketError(client, payload?.requestId, "Message text is required.");
      return;
    }

    const text = payload.text.trim();
    if (!text) return;

    if (text.length > maxMessageLength) {
      sendSocketError(
        client,
        payload.requestId,
        `Messages must be ${maxMessageLength} characters or fewer.`,
      );
      return;
    }

    const requestId =
      typeof payload.requestId === "string" && payload.requestId.length <= 100
        ? payload.requestId
        : randomUUID();
    void translateAndBroadcast(client, text, requestId);
  });

  client.on("error", (error) => {
    process.stderr.write(`WebSocket client error: ${error.message}\n`);
  });
});

webSocketServer.on("error", (error) => {
  process.stderr.write(`WebSocket server error: ${error.message}\n`);
});

server.listen(port, "0.0.0.0", () => {
  process.stdout.write(`Translator server listening on port ${port}\n`);
});

server.on("error", (error) => {
  process.stderr.write(`Translator server error: ${error.message}\n`);
  process.exitCode = 1;
});