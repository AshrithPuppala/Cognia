document.getElementById('start-btn').addEventListener('click', () => {
  const intent = document.getElementById('user-intent').value;
  const accessibilityProfile = document.getElementById('access-profile').value;
  chrome.runtime.sendMessage({
    action: "START_COGNIA_SESSION",
    goal: intent,
    accessibility_profile: accessibilityProfile
  });
  window.close();
});