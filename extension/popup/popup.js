document.getElementById('start-btn').addEventListener('click', () => {
  const intent = document.getElementById('user-intent').value;
  chrome.runtime.sendMessage({
    action: "START_COGNIA_SESSION",
    goal: intent
  });
  window.close();
});
