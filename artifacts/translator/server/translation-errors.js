const retryableStatuses = new Set([408, 429, 500, 502, 503, 504]);
const temporaryErrorPattern =
  /overload|high demand|too many requests|service unavailable|temporarily unavailable|timed?\s*out|timeout|\b503\b/i;
const temporaryErrorCodes = new Set([
  "ECONNRESET",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
]);

export function isTemporaryTranslationError(error) {
  const status = Number(error?.status ?? error?.statusCode);
  if (retryableStatuses.has(status)) return true;

  const codes = [
    error?.code,
    error?.cause?.code,
    error?.name,
    error?.cause?.name,
  ]
    .filter(Boolean)
    .map((code) => String(code).toUpperCase());

  if (codes.some((code) => temporaryErrorCodes.has(code) || code.includes("TIMEOUT"))) {
    return true;
  }

  const message = [
    error?.message,
    error?.cause?.message,
    error?.statusText,
  ]
    .filter(Boolean)
    .join(" ");

  return temporaryErrorPattern.test(message);
}