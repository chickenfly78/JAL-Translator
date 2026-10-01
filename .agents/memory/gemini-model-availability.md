---
name: Gemini API model availability
description: Model access and response formats can vary across user-owned Gemini API keys.
---

For projects using a user's own Gemini API key, verify the chosen model with a small server-side request before shipping. Do not assume an older model ID is still enabled; use bounded retries for temporary overload and show a generic, key-safe error if the provider remains unavailable. Normalize common full language names as well as short codes in structured model responses.

**Why:** On 2026-10-01, a configured key returned 404 for `gemini-2.5-flash` because it was retired for new users, then returned temporary 503 overloads for `gemini-3.8-flash`. `gemini-3-flash-preview` accepted translation requests.

**How to apply:** When a Gemini call fails, first confirm the secret exists without viewing its value, then inspect the provider's model/status error rather than asking the user to re-enter the key. Keep credentials out of logs and browser code.