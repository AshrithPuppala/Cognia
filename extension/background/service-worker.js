// extension/background/service-worker.js

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "START_COGNIA_SESSION") {
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      const activeTabId = tabs[0].id;
      
      // Request DOM from Person 1's script
      chrome.tabs.sendMessage(activeTabId, { action: "MAP_PAGE" }, (mapperResponse) => {
        const rawDom = mapperResponse ? mapperResponse.rawDom : document.body.innerHTML;
        
        // Pass to your PII Guard
        chrome.tabs.sendMessage(activeTabId, { action: "SCRUB_DOM", rawDom: rawDom }, async (piiResponse) => {
          
          // Send scrubbed payload to Person 2's backend proxy
          const backendResponse = await fetch('http://localhost:3000/api/reason', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              url: tabs[0].url, 
              domSnippet: piiResponse.sanitizedDom, 
              goal: request.goal 
            })
          });
          
          const guidanceData = await backendResponse.json();
          
          // Send AI output to Person 3's visual HUD overlay
          chrome.tabs.sendMessage(activeTabId, { action: "UPDATE_HUD", data: guidanceData });
        });
      });
    });
  }
});
