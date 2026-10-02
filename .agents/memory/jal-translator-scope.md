---
name: JAL Translator incremental updates
description: Product scope rules for future JAL Translator changes.
---

Treat JAL Translator updates as incremental: preserve the working Gemini translation, language detection, WebSocket connection/status/reconnect behavior, and existing visual style. Avoid changing the Gemini API implementation, secrets, or server architecture unless a stated behavior requires it. Do not add database or file persistence.

**Why:** The user specified that the V1.3 work should improve the existing app without rebuilding or replacing working V1.2 functionality.

**How to apply:** Start with the current message renderer and make the smallest client/server changes that satisfy the requested behavior; explain any necessary protocol change and keep it limited to that behavior.