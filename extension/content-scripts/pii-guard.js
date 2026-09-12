// extension/content-scripts/pii-guard.js

function redactPII(htmlString) {
  if (!htmlString) return "";
  let cleaned = htmlString;
  
  cleaned = cleaned.replace(/value=["']([^"']+)["']/gi, 'value="[REDACTED]"');
  cleaned = cleaned.replace(/<input[^>]*type=["'](password|card|cvv|ssn|text|email|tel)["'][^>]*>/gi, (match) => {
    return match.replace(/value=["']([^"']+)["']/gi, 'value="[PROTECTED_FIELD]"');
  });
  cleaned = cleaned.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL_REDACTED]');
  cleaned = cleaned.replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[PHONE_REDACTED]');
  
  return cleaned;
}

// Listen for scrub requests from the background Orchestrator
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "SCRUB_DOM") {
    const safeDom = redactPII(request.rawDom);
    sendResponse({ sanitizedDom: safeDom });
  }
  return true; 
});
