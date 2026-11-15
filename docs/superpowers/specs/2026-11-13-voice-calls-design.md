# Phase 6: Voice Calls Design Spec

**Date:** 2026-11-13
**Status:** Approved

## 1. Goal

Enable SalesPilot AI organizations to place and receive AI-powered voice calls via webhook-based Voice AI providers (**Vapi**, **Twilio Voice TwiML**, and a **Mock** adapter for testing), route live voice tool calls to existing SalesPilot AI agent tools (`channel: "voice"`), and review call logs, AI summaries, outcomes, transcripts, and audio recordings in the dashboard.

## 2. Architecture Overview

Because SalesPilot AI runs on Next.js App Router + Vercel serverless functions, all voice integrations operate over HTTPS webhooks and REST APIs (no persistent WebSocket servers required):

- **Vapi (`vapi`)**: Outbound calls initiated via `POST https://api.vapi.ai/call`. Inbound/outbound tool calls (`tool-calls`), live status updates (`status-update`), and final transcripts/recordings (`end-of-call-report`) are delivered to `POST /api/webhooks/voice/vapi/[accountId]`.
- **Twilio Voice (`twilio`)**: Outbound calls initiated via Twilio REST API (`Calls.json`). Interactive turn-based AI speech loops are served via TwiML `<Gather input="speech">` webhooks, and final call status/recording callbacks are handled on the same webhook endpoint.
- **Mock (`mock`)**: Deterministic adapter for unit tests, integration tests against Firebase emulators, and sandbox demos without external credentials.

## 3. Data Model & Security

### Permissions (`src/lib/security/permissions.ts`)
- `voice:read`: `owner`, `admin`, `agent`, `viewer`
- `voice:write`: `owner`, `admin`, `agent`

### Collections (`firestore.rules`)
- `voiceAccounts/{id}`: Server-only (`allow read, write: if false`). Credentials encrypted at rest using `sealSecret` (`AES-256-GCM`). Never returned to client APIs (`VoiceAccountSummary` only).
- `voiceCalls/{id}`: Server-only (`allow read, write: if false`), accessed exclusively through tenant-scoped API routes (`withApi` + `voice:read`/`voice:write`).

### Consent Enforcement
- Outbound calls check the resolved customer's `consentStatus`.
- If `consentStatus === "denied"`, outbound call initiation fails with `409 Conflict` (`"Customer has opted out of calls and messages"`).

## 4. Capabilities

1. **Integrations (`/integrations`)**: New **Voice & Telephony** tab for connecting Vapi, Twilio Voice, or Mock accounts, testing connections, and copying the per-account inbound/tool webhook URL.
2. **Voice Calls Console (`/voice`)**: Call history table with direction/status filters, KPI strip, outbound AI call dialog, and a call detail viewer with audio recording playback, AI summary, outcome selector, and full transcript.
3. **Quick Call Actions**: "AI Call" buttons on Customer Detail and Order Detail pages (respecting customer consent).
4. **AI Agent Channel Activation**: Enable the `voice` channel checkbox in the AI Agent form and execute agent tools with `channel: "voice"` during live voice calls.
