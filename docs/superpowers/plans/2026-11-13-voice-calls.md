# Phase 6: Voice Calls Implementation Plan

1. **Task 1: Permissions, Schemas, Repositories & Firestore Rules**
   - Add `voice:read` and `voice:write` permissions; update `/voice` nav item.
   - Create `src/schemas/voice.ts` and `src/schemas/voice.test.ts`.
   - Create `src/repositories/voice.ts` and `src/repositories/voice.int.test.ts`.
   - Update `firestore.rules` to deny client access to `voiceAccounts` and `voiceCalls`.
2. **Task 2: Voice Adapter Interface, Registry & Mock/Vapi/Twilio Adapters**
   - Create `src/services/voice/types.ts`, `src/services/voice/registry.ts`.
   - Create `src/services/voice/adapters/{mock,vapi,twilio}.ts` and unit tests.
3. **Task 3: Outbound Call Service & Inbound/Tool-Call Webhook Service**
   - Create `src/services/voice/calls.ts` and `src/services/voice/webhooks.ts`.
   - Write integration tests `src/services/voice/calls.int.test.ts` and `src/services/voice/webhooks.int.test.ts`.
4. **Task 4: Voice Integration & Call API Routes**
   - Create `/api/integrations/voice`, `/api/integrations/voice/[id]`, `/api/integrations/voice/[id]/test`.
   - Create `/api/voice/calls`, `/api/voice/calls/[id]`, and `/api/webhooks/voice/[provider]/[accountId]`.
   - Write integration tests for API routes.
5. **Task 5: Voice Integrations UI, `/voice` Console, Quick Call Buttons & Agent Channel**
   - Add **Voice & Telephony** tab to `/integrations` (`voice-card.tsx`, `voice-form-dialog.tsx`).
   - Build `/voice` page (`src/app/(dashboard)/voice/page.tsx`) with KPIs, filters, call detail transcript/audio viewer, and outbound call dialog.
   - Add "AI Call" quick action to Customer Detail and Order Detail.
   - Enable `voice` channel checkbox in `AgentFormSections`.
6. **Task 6: Setup Guides, Checklist, Release Gate & Merge**
   - Create `docs/setup/vapi.md` and `docs/setup/twilio-voice.md`.
   - Update `docs/CHECKLIST.md` and `README.md`.
   - Run full 6-step release gate and merge to `main`.
