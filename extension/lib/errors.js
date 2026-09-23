// ScreenSync Standard Error Taxonomy (Plan §3.5 & D5)
// Frozen error codes and structured error factory with retryable classification.

export const ERROR_CODES = Object.freeze({
  NO_GRANT: 'NO_GRANT',
  RESTRICTED_PAGE: 'RESTRICTED_PAGE',
  NO_ACTIVE_TAB: 'NO_ACTIVE_TAB',
  TAB_CLOSED: 'TAB_CLOSED',
  BAD_ARGS: 'BAD_ARGS',
  TIMEOUT: 'TIMEOUT',
  CDP_ATTACH_FAILED: 'CDP_ATTACH_FAILED',
  SCRIPT_INJECT_FAILED: 'SCRIPT_INJECT_FAILED',
  HUB_OFFLINE: 'HUB_OFFLINE',
  USER_DENIED: 'USER_DENIED',
  INTERNAL: 'INTERNAL',
  NOT_ACTIONABLE: 'NOT_ACTIONABLE',
  ELEMENT_NOT_FOUND: 'ELEMENT_NOT_FOUND',
  STRICT_MODE_VIOLATION: 'STRICT_MODE_VIOLATION',
  USER_CONFIRMATION_REQUIRED: 'USER_CONFIRMATION_REQUIRED',
  USER_DECLINED: 'USER_DECLINED',
  APPROVAL_TIMEOUT: 'APPROVAL_TIMEOUT',
  TAB_BUSY: 'TAB_BUSY',
  CAPTURE_UNAVAILABLE: 'CAPTURE_UNAVAILABLE',
});

/**
 * Creates a structured error object conforming to { ok: false, code, message, error, retryable, ...extra }.
 * @param {string} code - Key from ERROR_CODES or a valid string code.
 * @param {string} message - Human-readable explanation with optional remedy.
 * @param {boolean} [retryable=false] - Whether the agent should retry this call.
 * @param {Record<string, unknown>} [extra={}] - Additional diagnostic properties.
 */
export function makeError(code, message, retryable = false, extra = {}) {
  const normCode = ERROR_CODES[code] || code || ERROR_CODES.INTERNAL;
  return {
    ok: false,
    code: normCode,
    message: String(message || 'An error occurred during execution.'),
    error: String(message || normCode),
    retryable: Boolean(retryable),
    ...extra,
  };
}
