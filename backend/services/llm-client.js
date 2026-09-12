const fs = require('fs');
const path = require('path');

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
// Swap to 'llama-3.1-8b-instant' while iterating for speed;
// use 'llama-3.3-70b-versatile' for the real demo (better at following
// the plain-language rewrite instruction).
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

const SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, '../prompts/reasoner-system-prompt.md'),
  'utf-8'
);

/**
 * Calls Groq's chat completions endpoint in JSON mode, asking the model
 * to decide the next target element + a plain-language instruction.
 *
 * @param {object} pageState - the PageState JSON from the extension
 * @param {string} supportLevel - 'normal' | 'elevated' | 'high' (already computed)
 * @returns {Promise<object>} shape matching the GuidanceAction fields the LLM is responsible for
 */
async function getGuidanceFromLLM(pageState, supportLevel) {
  // Keep validIds reading from the FULL list — this is the safety check
  // against the LLM inventing an id, and must not be narrowed.
  const validIds = (pageState.elements || []).map((el) => el.id);

  // Only send elements that are actually visible/interactable/unobscured —
  // cuts token count drastically (89 elements -> ~23 on a real page) and
  // is required to stay under Groq's 8000 TPM limit, not just an
  // optimization.
  const relevantElements = (pageState.elements || []).filter(
    (el) => el.visible && el.interactable && !el.obscured
  );

  // Strip fields the LLM doesn't need (pixel coordinates, tag names, full
  // state object) — the HUD needs rect, the reasoner doesn't.
  const trimmedElements = relevantElements.map((el) => ({
    id: el.id,
    role: el.role,
    label: el.label || el.placeholder || null,
    filled: el.state.filled,
    required: el.state.required,
    checked: el.state.checked,
  }));

  const userContent = JSON.stringify({
    goal: pageState.goal,
    accessibility_profile: pageState.accessibility_profile,
    support_level: supportLevel,
    elements: trimmedElements,
    history: pageState.history || [],
  });

  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  };

  let raw;
  try {
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Groq API error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    raw = data.choices?.[0]?.message?.content;
  } catch (err) {
    console.error('Groq request failed, using fallback:', err.message);
    return buildFallback(pageState, validIds);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error('Failed to parse LLM JSON output, using fallback:', raw);
    return buildFallback(pageState, validIds);
  }

  // Defensive check: never trust an element id the model invented.
  if (!validIds.includes(parsed.target_element_id)) {
    console.warn(
      `LLM returned unknown target_element_id "${parsed.target_element_id}", falling back`
    );
    return buildFallback(pageState, validIds);
  }

  return {
    targetElementId: parsed.target_element_id,
    instruction: parsed.instruction || 'Continue to the next step.',
    stepIndex: parsed.step ?? (pageState.history?.length || 0) + 1,
    totalSteps: parsed.total_steps ?? validIds.length,
    dimAllExcept: [parsed.target_element_id],
  };
}

/**
 * Safe fallback used when the Groq call fails, times out, or returns
 * something invalid. Picks the first unfilled, interactable element it can
 * find so the demo never hard-crashes.
 *
 * NOTE: `state` from the real Page Mapper is an object
 * ({ disabled, filled, required, readOnly, focused, expanded, checked,
 * selectedOptionText }), not a string like "empty"/"filled" — match against
 * `state.filled` accordingly.
 */
function buildFallback(pageState, validIds) {
  const elements = pageState.elements || [];
  const candidates = elements.filter(
    (el) => el.interactable !== false && el.state && !el.state.disabled
  );
  const nextUnfilled =
    candidates.find((el) => el.state && el.state.filled === false) ||
    candidates[0] ||
    elements[0];

  return {
    targetElementId: nextUnfilled ? nextUnfilled.id : validIds[0],
    instruction: nextUnfilled
      ? `Fill in ${nextUnfilled.label || nextUnfilled.placeholder || 'this field'}.`
      : 'Continue with the next step.',
    stepIndex: (pageState.history?.length || 0) + 1,
    totalSteps: elements.length,
    dimAllExcept: nextUnfilled ? [nextUnfilled.id] : [],
  };
}

module.exports = { getGuidanceFromLLM };
