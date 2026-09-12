document.getElementById('start-btn').addEventListener('click', () => {
  const goal = document.getElementById('user-intent').value;
  const accessibilityProfile = document.getElementById('accessibility-profile').value;

  chrome.runtime.sendMessage({
    action: 'START_COGNIA_SESSION',
    goal,
    accessibilityProfile,
  });

  window.close();
});
