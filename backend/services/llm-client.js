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

const MAX_ELEMENTS = 40;

/**
 * Keeps only elements the user could actually act on right now, and strips
 * each one down to the handful of fields the reasoner actually needs.
 * Real captured pages can have 80-100+ elements with deep nested `state`/
 * `rect` objects — sending all of that blows past Groq's per-request token
 * limit (8000 TPM on the free tier). The HUD and fallback logic still get
 * the full untrimmed `pageState.elements` — only the LLM call uses this.
 */
function buildLLMElements(elements) {
  const relevantElements = (elements || []).filter(
    (el) => el.visible !== false && el.interactable !== false && el.obscured !== true
  );

  const cappedElements = relevantElements.slice(0, MAX_ELEMENTS);

  return cappedElements.map((el) => ({
    id: el.id,
    role: el.role,
    label: el.label || el.placeholder || null,
    filled: el.state ? !!el.state.filled : undefined,
    required: el.state ? !!el.state.required : undefined,
    checked: el.state ? el.state.checked : undefined,
  }));
}

/**
 * Calls Groq's chat completions endpoint in JSON mode, asking the model
 * to decide the next target element + a plain-language instruction.
 *
 * @param {object} pageState - the PageState JSON from the extension
 * @param {string} supportLevel - 'normal' | 'elevated' | 'high' (already computed)
 * @returns {Promise<object>} shape matching the GuidanceAction fields the LLM is responsible for
 */
async function getGuidanceFromLLM(pageState, supportLevel) {
  const validIds = (pageState.elements || []).map((el) => el.id);
  const llmElements = buildLLMElements(pageState.elements);

  const userContent = JSON.stringify({
    goal: pageState.goal,
    accessibility_profile: pageState.accessibility_profile,
    support_level: supportLevel,
    elements: llmElements,
    history: pageState.history || [],
  });

  // Verify the trim actually ran before every request — cheap sanity check
  // that catches a stale/un-reloaded server before it wastes a Groq call.
  console.log(
    `[llm-client] sending ${llmElements.length}/${(pageState.elements || []).length} elements, payload length ${userContent.length} chars`
  );

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

const FILLABLE_ROLES = new Set([
  'textbox', 'combobox', 'checkbox', 'radio', 'spinbutton', 'slider', 'switch',
]);

/**
 * Safe fallback used when the Groq call fails, times out, or returns
 * something invalid. Picks the first unfilled, on-screen, fillable-form
 * element it can find so the demo never hard-crashes and never lands on a
 * decorative link or an off-screen skip-nav element.
 *
 * NOTE: `state` from the real Page Mapper is an object
 * ({ disabled, filled, required, readOnly, focused, expanded, checked,
 * selectedOptionText }), not a string like "empty"/"filled" — match against
 * `state.filled` accordingly.
 */
function buildFallback(pageState, validIds) {
  const elements = pageState.elements || [];
  const candidates = elements.filter(
    (el) =>
      el.interactable !== false &&
      el.visible !== false &&
      el.obscured !== true &&
      el.state &&
      !el.state.disabled &&
      FILLABLE_ROLES.has(el.role)
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
