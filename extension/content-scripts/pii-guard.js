// extension/content-scripts/pii-guard.js
//
// Redacts sensitive entered values from a structured PageState object
// (see shared/schemas/page-state.schema.json) before it leaves the browser.
// Operates on pageState.elements[].value / label, not on raw HTML strings —
// the orchestrator no longer sends raw DOM at all.

const SENSITIVE_LABEL_PATTERN = /password|ssn|card\s*number|cvv|pin\b|social\s*security/i;
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_PATTERN = /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g;

function redactString(value) {
  if (typeof value !== 'string') return value;
  return value.replace(EMAIL_PATTERN, '[EMAIL_REDACTED]').replace(PHONE_PATTERN, '[PHONE_REDACTED]');
}

/**
 * Returns a deep copy of pageState with sensitive entered values scrubbed.
 * Keeps structural info (id, role, label, rect, filled/required flags)
 * intact — only the actual typed/selected value is ever touched, per the
 * "sensitive form values never leave the browser" pitch.
 */
function redactPageState(pageState) {
  if (!pageState || !Array.isArray(pageState.elements)) return pageState;

  const redacted = JSON.parse(JSON.stringify(pageState));

  redacted.elements = redacted.elements.map((el) => {
    const isSensitiveField =
      (el.label && SENSITIVE_LABEL_PATTERN.test(el.label)) ||
      (el.role === 'textbox' && el.tag === 'input' && el.value && el.value.length > 0 &&
        (el.label ? SENSITIVE_LABEL_PATTERN.test(el.label) : false));

    if (isSensitiveField) {
      return { ...el, value: el.value != null ? '[PROTECTED_FIELD]' : el.value };
    }

    if (typeof el.value === 'string') {
      return { ...el, value: redactString(el.value) };
    }

    return el;
  });

  return redacted;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'cognia:redact-page-state') {
    sendResponse(redactPageState(request.pageState));
    return true;
  }
});

// Also exposed for direct use / testing in the page console.
window.Cognia = window.Cognia || {};
window.Cognia.PIIGuard = { redactPageState };
