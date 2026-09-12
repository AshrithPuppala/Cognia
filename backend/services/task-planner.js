/**
 * Decides support_level from the accessibility profile (a head start)
 * plus friction detected in the interaction history (the escalation).
 *
 * @param {object} pageState
 * @returns {'normal'|'elevated'|'high'}
 */
function computeSupportLevel(pageState) {
  const profile = pageState.accessibility_profile;
  const history = pageState.history || [];

  let level = 'normal';

  // Profile gives a head start before any friction shows up.
  if (profile === 'low_vision' || profile === 'cognitive_load') {
    level = 'elevated';
  }

  // Friction detection: count repeated/failed attempts in history.
  const strugglingCount = history.filter(
    (entry) => entry.result === 'failed' || entry.result === 'repeated'
  ).length;

  if (strugglingCount >= 2) {
    level = level === 'elevated' ? 'high' : 'elevated';
  }

  return level;
}

/**
 * Decides whether the instruction should also be read aloud.
 * True for profiles that benefit from audio by default, or whenever
 * support_level has escalated (someone struggling benefits from audio
 * regardless of their stated profile).
 *
 * @param {object} pageState
 * @param {'normal'|'elevated'|'high'} supportLevel
 * @returns {boolean}
 */
function computeReadAloud(pageState, supportLevel) {
  const profile = pageState.accessibility_profile;

  if (profile === 'low_vision' || profile === 'unsure') {
    return true;
  }

  if (supportLevel === 'elevated' || supportLevel === 'high') {
    return true;
  }

  return false;
}

module.exports = { computeSupportLevel, computeReadAloud };
