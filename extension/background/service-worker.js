// extension/background/service-worker.js

const MOCK_PAGE_STATE = {
  goal: "test goal",
  url: "https://example.com",
  accessibility_profile: "unsure",
  elements: [
    { id: "cognia-el-1-ab12c", role: "button", label: "Submit", state: "default", rect: [0,0,100,40] }
  ]
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "START_COGNIA_SESSION") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTabId = tabs[0].id;

      chrome.tabs.sendMessage(
        activeTabId,
        { type: "cognia:request-page-state", goal: request.goal },
        async (mapperResponse) => {
          const pageState = mapperResponse
            ? { ...mapperResponse, accessibility_profile: request.accessibility_profile }
            : { ...MOCK_PAGE_STATE, goal: request.goal, accessibility_profile: request.accessibility_profile };

          chrome.tabs.sendMessage(activeTabId, { action: "SCRUB_PAGE_STATE", pageState }, async (piiResponse) => {
            if (!piiResponse) {
              console.error("Cognia: PII Guard did not respond — is pii-guard.js registered in manifest.json?");
              return;
            }
            try {
              const backendResponse = await fetch('http://localhost:3000/reason', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(piiResponse.redactedPageState)
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