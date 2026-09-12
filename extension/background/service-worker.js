// extension/background/service-worker.js
//
// Orchestration loop: popup -> Page Mapper -> PII Guard -> Backend /reason -> HUD.
// Uses the real PageState schema (shared/schemas/page-state.schema.json) and the
// real backend route. Also wires up the continuous "Verify & Re-plan" loop:
// Page Mapper's startWatching() fires a MutationObserver whenever the page
// changes and pushes a fresh PageState to us via
// chrome.runtime.sendMessage({type: 'cognia:page-state', state}) -- we listen
// for that here and re-run reasoning + HUD automatically, so the user never
// has to manually retrigger anything.

const tabHistory = new Map();
// Remembers each tab's current goal/profile so an auto-pushed page-state
// update (from the MutationObserver) can be reasoned about without asking
// the user again.
const tabSessions = new Map();

function getHistory(tabId) {
  if (!tabHistory.has(tabId)) tabHistory.set(tabId, []);
  return tabHistory.get(tabId);
}

/**
 * Runs PII redaction -> backend /reason -> HUD render for a PageState we
 * already have in hand (either freshly requested, or pushed to us by
 * Page Mapper's MutationObserver).
 */
async function guideFromPageState(tabId, pageState, accessibilityProfile) {
  pageState.accessibility_profile = accessibilityProfile;
  pageState.history = getHistory(tabId);

  const redactedPageState = await chrome.tabs.sendMessage(tabId, {
    type: 'cognia:redact-page-state',
    pageState,
  });

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

  // hud-overlay.js exposes window.renderHUD(guidanceAction) for the
  // orchestrator to call directly -- it does not listen for a runtime message.
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
 * Starts a session: gets the first PageState, runs guidance, AND starts
 * Page Mapper's live watcher so future page changes (the user filling in a
 * field, a modal opening, etc.) automatically trigger a fresh
 * redact -> reason -> render cycle with no further user action needed.
 */
async function startSession(tabId, goal, accessibilityProfile) {
  tabHistory.set(tabId, []);
  tabSessions.set(tabId, { goal, accessibilityProfile });

  // Start Page Mapper's MutationObserver-driven watcher in the page itself.
  // Its internal notify() already calls
  // chrome.runtime.sendMessage({type: 'cognia:page-state', state}) on every
  // change AND on this initial call, so we don't need a separate first
  // request -- the watcher's first scan IS our first PageState.
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (g) => {
      if (window.Cognia && window.Cognia.PageMapper && window.Cognia.PageMapper.startWatching) {
        window.Cognia.PageMapper.startWatching(g, { debounceMs: 400 });
      } else {
        console.error('[Cognia orchestrator] Cognia.PageMapper.startWatching is not available.');
      }
    },
    args: [goal],
  });
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

  // Page Mapper pushes a fresh PageState here every time its
  // MutationObserver fires (user typed something, a field changed, a modal
  // opened, etc.) -- this is what makes the HUD update live without the
  // user re-running anything manually.
  if (request.type === 'cognia:page-state' && sender.tab) {
    const tabId = sender.tab.id;
    const session = tabSessions.get(tabId);
    if (!session) {
      // Page changed before a session was started via the popup -- ignore.
      return false;
    }
    guideFromPageState(tabId, request.state, session.accessibilityProfile).catch((err) =>
      console.error('[Cognia orchestrator] auto re-plan failed:', err)
    );
    return false;
  }

  if (request.action === 'STOP_COGNIA_SESSION') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTabId = tabs[0].id;
      tabSessions.delete(activeTabId);
      chrome.scripting.executeScript({
        target: { tabId: activeTabId },
        func: () => {
          if (window.Cognia && window.Cognia.PageMapper && window.Cognia.PageMapper.stopWatching) {
            window.Cognia.PageMapper.stopWatching();
          }
        },
      });
    });
    return false;
  }
});
