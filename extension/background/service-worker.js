// extension/background/service-worker.js

const MOCK_PAGE_STATE = { /* paste shared/mocks/mock-page-state.json here for standalone testing */ };

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "START_COGNIA_SESSION") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTabId = tabs[0].id;

      chrome.tabs.sendMessage(
        activeTabId,
        { action: "MAP_PAGE", goal: request.goal, accessibility_profile: request.accessibility_profile },
        async (mapperResponse) => {
          // Use the mock until Person 1's real getPageState() is wired in
          const pageState = mapperResponse || { ...MOCK_PAGE_STATE, goal: request.goal, accessibility_profile: request.accessibility_profile };

          chrome.tabs.sendMessage(activeTabId, { action: "SCRUB_PAGE_STATE", pageState }, async (piiResponse) => {
            const redactedPageState = piiResponse.redactedPageState;

            try {
              const backendResponse = await fetch('http://localhost:3000/reason', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(redactedPageState)
              });
              const guidanceData = await backendResponse.json();
              chrome.tabs.sendMessage(activeTabId, { action: "UPDATE_HUD", data: guidanceData });
            } catch (err) {
              console.error("Cognia: backend call failed", err);
            }
          });
        }
      );
    });
  }
});
