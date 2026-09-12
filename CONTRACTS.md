# Contracts

These two shapes are the ONLY thing modules need to agree on. Freeze changes to these — if you need a new field, flag it to the group before changing the schema.

## PageState (Page Mapper → PII Guard → Backend)
See `shared/schemas/page-state.schema.json` and `shared/mocks/mock-page-state.json`.

## GuidanceAction (Backend → HUD)
See `shared/schemas/guidance-action.schema.json` and `shared/mocks/mock-guidance-action.json`.

## Rule of thumb
- Backend and HUD build against `shared/mocks/` until Page Mapper is real.
- Orchestration loop (service-worker.js) is the only file that wires all pieces together — swap one mock at a time, not all at once.

## Recent additions (differentiation features)

Two new fields were added to support the accessibility-profile and read-aloud features. Both are additive — no existing field changed shape, so nothing that already worked needs to change.

- **`PageState.accessibility_profile`** (new, required) — one of `low_vision` / `motor` / `cognitive_load` / `unsure`. Set once by Person 4's popup when the user starts a session, then passed through untouched by Page Mapper and PII Guard. The backend reads it to set a starting `support_level` and decide `read_aloud`.
- **`GuidanceAction.read_aloud`** (new, required) — boolean. Set by the backend (Person 2), read by the HUD (Person 3), which calls the browser's `SpeechSynthesis` API on `instruction` when true.

Do not add further fields without flagging the group first — same rule as before.
