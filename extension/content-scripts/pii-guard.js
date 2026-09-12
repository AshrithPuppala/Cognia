// extension/content-scripts/pii-guard.js

const SENSITIVE_LABEL_PATTERN = /ssn|social security|password|card number|cvv/i;
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const PHONE_PATTERN = /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/;

function redactPageState(pageState) {
  const redacted = JSON.parse(JSON.stringify(pageState)); // deep copy, keep structure intact
  redacted.elements = (redacted.elements || []).map((el) => {
    const looksSensitiveLabel = SENSITIVE_LABEL_PATTERN.test(el.label || "");
    const looksSensitiveValue =
      typeof el.value === "string" && (EMAIL_PATTERN.test(el.value) || PHONE_PATTERN.test(el.value));

    if ((el.state === "filled" || el.state === "selected") && (looksSensitiveLabel || looksSensitiveValue)) {
      return { ...el, value: "[REDACTED]" };
    }
    return el; // id, role, label, rect always untouched
  });
  return redacted;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "SCRUB_PAGE_STATE") {
    sendResponse({ redactedPageState: redactPageState(request.pageState) });
  }
  return true;
});
