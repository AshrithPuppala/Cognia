// extension/background/service-worker.js
//
// Orchestration loop: popup -> Page Mapper -> PII Guard -> Backend /reason -> HUD.
//
// Re-plan is now triggered ONLY by the user actually completing the
// spotlighted step (a 'cognia:step-completed' message sent by hud-overlay.js
// when the user clicks/changes the target element) -- NOT by Page Mapper's
// MutationObserver. This avoids the earlier infinite-loop bug entirely:
// rendering the HUD is itself a DOM mutation, and any mutation-driven loop
// (even with a cooldown) will eventually re-trigger on the HUD's own DOM
// changes, or on unrelated page activity (auto-refreshing modals, scroll
// repositioning, etc.). A click-driven loop has no such race: nothing
// re-plans unless the user genuinely acts on the current step.

const tabHistory = new Map();
// Remembers each tab's current goal/profile so a step-completed event can
// trigger a fresh reasoning cycle without asking the user again.
const tabSessions = new Map();

function getHistory(tabId) {
  if (!tabHistory.has(tabId)) tabHistory.set(tabId, []);
  return tabHistory.get(tabId);
}

/**
 * Asks Page Mapper (already loaded as a content script) for a fresh,
 * one-shot PageState snapshot of the tab right now.
 */
async function getFreshPageState(tabId, goal) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (g) => {
      if (window.Cognia && window.Cognia.PageMapper && window.Cognia.PageMapper.getPageState) {
        return window.Cognia.PageMapper.getPageState(g);
      }
      console.error('[Cognia orchestrator] Cognia.PageMapper.getPageState is not available.');
      return null;
    },
    args: [goal],
  });
  return result;
}

/**
 * Runs PII redaction -> backend /reason -> HUD render for a PageState we
 * already have in hand.
 */
async function guideFromPageState(tabId, pageState, accessibilityProfile) {
  if (!pageState) {
    console.error('[Cognia orchestrator] No PageState available, aborting this cycle.');
    return;
  }

  pageState.accessibility_profile = accessibilityProfile;
  pageState.history = getHistory(tabId);

  let redactedPageState;
  try {
    redactedPageState = await chrome.tabs.sendMessage(tabId, {
      type: 'cognia:redact-page-state',
      pageState,
    });
  } catch (err) {
    console.error('[Cognia orchestrator] PII redaction call failed:', err);
    return;
  }

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

  getHistory(tabId).push({ action: guidanceAction.target_element_id, result: 'shown' });

  // hud-overlay.js exposes window.renderHUD(guidanceAction) for us to call
  // directly -- it does not listen for a runtime message.
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (action) => {
      if (typeof window.renderHUD === 'function') {
        window.renderHUD(action);
      } else {
        console.error('[Cognia orchestrator] window.renderHUD is not defined on this page yet.');
      }
    },
    args: [guidanceAction],
  });
}

/**
 * Starts a session: gets the first PageState and runs guidance once.
 * No continuous watcher is started -- subsequent steps are driven entirely
 * by 'cognia:step-completed' messages from the HUD, not by a page-change
 * observer.
 */
async function startSession(tabId, goal, accessibilityProfile) {
  tabHistory.set(tabId, []);
  tabSessions.set(tabId, { goal, accessibilityProfile });

  const pageState = await getFreshPageState(tabId, goal);
  await guideFromPageState(tabId, pageState, accessibilityProfile);
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'START_COGNIA_SESSION') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTabId = tabs[0].id;
      startSession(activeTabId, request.goal, request.accessibilityProfile).catch((err) =>
        console.error('[Cognia orchestrator] failed to start session:', err)
      );
    });
    return false;
  }

  // Fires only when the user actually clicks or changes the spotlighted
  // target element (see hud-overlay.js's 'advance' handler) -- this is the
  // ONLY thing that triggers a re-plan now. Rendering the HUD itself never
  // triggers this, so there is no infinite-loop path.
  if (request.type === 'cognia:step-completed' && sender.tab) {
    const tabId = sender.tab.id;
    const session = tabSessions.get(tabId);
    if (!session) {
      // Step completed after the session ended or before one started -- ignore.
      return false;
    }

    getFreshPageState(tabId, session.goal)
      .then((pageState) => guideFromPageState(tabId, pageState, session.accessibilityProfile))
      .catch((err) => console.error('[Cognia orchestrator] step-completed re-plan failed:', err));
    return false;
  }

  if (request.action === 'STOP_COGNIA_SESSION') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTabId = tabs[0].id;
      tabSessions.delete(activeTabId);
      tabHistory.delete(activeTabId);
    });
    return false;
  }
});