const express = require('express');
const router = express.Router();
const mockGuidanceAction = require('../../shared/mocks/mock-guidance-action.json');
const { getGuidanceFromLLM } = require('../services/llm-client');
const { computeSupportLevel, computeReadAloud } = require('../services/task-planner');

// Toggle this to false once llm-client.js is wired up and tested.
// Keeping it true early on lets Person 3 (HUD) and Person 4 (orchestration)
// build against a real, live endpoint before the LLM call works.
const USE_MOCK = process.env.USE_MOCK_REASON === 'true';

router.post('/', async (req, res) => {
  try {
    const pageState = req.body;

    if (!pageState || !pageState.elements) {
      return res.status(400).json({ error: 'Request body must be a valid PageState object' });
    }

    if (USE_MOCK) {
      return res.json(mockGuidanceAction);
    }

    // 1. Deterministic logic first (cheap, no LLM call needed)
    const supportLevel = computeSupportLevel(pageState);
    const readAloud = computeReadAloud(pageState, supportLevel);

    // 2. LLM reasons about *which* element and *what* the instruction says
    const { targetElementId, instruction, stepIndex, totalSteps, dimAllExcept } =
      await getGuidanceFromLLM(pageState, supportLevel);

    const guidanceAction = {
      target_element_id: targetElementId,
      instruction,
      support_level: supportLevel,
      read_aloud: readAloud,
      step: stepIndex,
      total_steps: totalSteps,
      dim_all_except: dimAllExcept,
    };

    res.json(guidanceAction);
  } catch (err) {
    console.error('Error in /reason:', err);
    res.status(500).json({ error: 'Failed to generate guidance action' });
  }
});

module.exports = router;
