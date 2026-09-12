// extension/background/service-worker.js
//
// Orchestration loop: popup -> Page Mapper -> PII Guard -> Backend /reason -> HUD.
// Rewritten to use the real PageState schema (shared/schemas/page-state.schema.json)
// and the real backend route, instead of raw HTML strings.

// Simple per-tab interaction history, used for frustration/support_level
// escalation on the backend. Not persisted across browser restarts.
const tabHistory = new Map();

function getHistory(tabId) {
  if (!tabHistory.has(tabId)) tabHistory.set(tabId, []);
  return tabHistory.get(tabId);
}

async function runCogniaLoop(tabId, goal, accessibilityProfile) {
  // 1. Ask Person 1's Page Mapper (already listening for this message type
  //    in page-mapper.js) for the real, structured PageState.
  const pageState = await chrome.tabs.sendMessage(tabId, {
    type: 'cognia:request-page-state',
    goal,
  });

  if (!pageState || !pageState.elements) {
    console.error('[Cognia orchestrator] Page Mapper did not return a valid PageState', pageState);
    return;
  }

  // 2. Attach the fields the backend needs that Page Mapper doesn't produce.
  pageState.accessibility_profile = accessibilityProfile;
  pageState.history = getHistory(tabId);

  // 3. Ask the PII Guard content script to redact sensitive values in place.
  //    Operates on the structured PageState, not raw HTML.
  const redactedPageState = await chrome.tabs.sendMessage(tabId, {
    type: 'cognia:redact-page-state',
    pageState,
  });

  // 4. Call the real backend endpoint.
  let guidanceAction;
  try {
    const response = await fetch('http://localhost:3000/reason', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(redactedPageState),
    });
    guidanceAction = await response.json();
  } catch (err) {
    console.error('[Cognia orchestrator] Backend call failed:', err);
    return;
  }

  // 5. Record this step in history so future calls can detect repeated
  //    attempts / escalate support_level.
  getHistory(tabId).push({ action: guidanceAction.target_element_id, result: 'shown' });

  // 6. Hand the GuidanceAction to Person 3's HUD content script.
  //    NOTE: confirm hud-overlay.js actually listens for this message shape
  //    (action: "UPDATE_HUD") — if it instead expects a direct call to
  //    window.renderHUD(), this message needs to change to match.
  chrome.tabs.sendMessage(tabId, { action: 'UPDATE_HUD', data: guidanceAction });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'START_COGNIA_SESSION') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTabId = tabs[0].id;
      tabHistory.set(activeTabId, []); // fresh history for a new session
      runCogniaLoop(activeTabId, request.goal, request.accessibilityProfile).catch((err) =>
        console.error('[Cognia orchestrator] loop failed:', err)
      );
    });
    return true;
  }

  // Re-run the loop (e.g. triggered by Page Mapper's MutationObserver
  // noticing the user filled something in) using the same goal/profile.
  if (request.action === 'COGNIA_RESCAN') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTabId = tabs[0].id;
      runCogniaLoop(activeTabId, request.goal, request.accessibilityProfile).catch((err) =>
        console.error('[Cognia orchestrator] rescan failed:', err)
      );
    });
    return true;
  }
});
