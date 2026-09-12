# Competitor awareness: PageGuide

**Read this once, as a team, before the pitch.** If a judge has seen a similar tool, the worst answer is surprise. The best answer is a confident, specific "yes, and here's exactly how ours is different."

## What PageGuide is
A published research project (Auburn University / University of Virginia, arXiv preprint, ~53-person user study) and shipped Chrome extension. It grounds LLM answers and step-by-step guidance directly in the live page's DOM, so users can verify evidence rather than trusting an AI's claim blindly. It has a "Find" mode (answers questions, highlights the exact supporting text/image) and a "Guide" mode (highlights one target element at a time, one step at a time, sidebar instruction, waits for user click before advancing). It also has a "Page Off" feature that dims the whole page to reduce distraction.

## Where the overlap is real
- Both are Chrome extensions that overlay guidance on a live page without modifying it.
- Both highlight one target element at a time and wait for the user to act.
- Both dim/reduce visual noise as a feature (PageGuide's "Page Off").

**Don't claim "nothing like this exists." A judge who checks will find PageGuide in one search, exactly like we did.**

## Where Cognia is genuinely different

| | PageGuide | Cognia |
|---|---|---|
| Core problem | Verifying AI answers aren't hallucinated (trust in the AI) | Reducing cognitive overload for vulnerable users (trust in the page) |
| Target user | General web users, broad tasks | Older adults, visually/sensory impaired, neurodivergent users — specifically on civic/health portals |
| Visual approach | Additive — draws boxes, arrows, stars, inline citations on top of the page | Subtractive — removes/dims everything except the one thing that matters, adds nothing extra |
| Personalization | None described in their published method | Accessibility profile (low vision / motor / cognitive load) set at intake, shapes support level and instruction style from step one |
| Adaptation over time | Not present in their method | Frustration/friction detection — escalates support level after repeated backtracking |
| Language | Cites the page's existing text verbatim | Actively rewrites dense/bureaucratic labels into plain language |
| Privacy framing | Sends structured DOM content to a cloud LLM for reasoning (reasonable for general browsing) | Explicit PII redaction of sensitive form values before anything leaves the browser — built for government ID / health / payment contexts specifically |

## The one-line answer if asked
"We're aware of PageGuide — it's a research tool focused on verifying AI answers against hallucination for general web use. Cognia is narrower and more specialized: built specifically for the accessibility track, for vulnerable users on civic and health portals, with a subtractive UI, accessibility-profile personalization, and privacy-first redaction that their published method doesn't include."
