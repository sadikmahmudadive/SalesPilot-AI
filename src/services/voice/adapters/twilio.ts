import { createHmac, timingSafeEqual } from "node:crypto";

import { fetchOutboundJson } from "@/lib/api/outbound-http";
import { ValidationError } from "@/lib/errors";
import { unsealSecret } from "@/lib/security/secret-box";
import type { CallStatus, VoiceAccount } from "@/schemas/voice";

import type {
  InitiateVoiceCallInput,
  InitiateVoiceCallOutput,
  VoiceProviderAdapter,
  VoiceWebhookEvent,
  VoiceWebhookRequest,
} from "../types";

interface TwilioCredentials {
  accountSid: string;
  authToken: string;
}

function getCredentials(account: VoiceAccount): TwilioCredentials {
  const json = unsealSecret(account.credentials);
  const parsed = JSON.parse(json) as Record<string, unknown>;
  const accountSid = typeof parsed.accountSid === "string" ? parsed.accountSid.trim() : "";
  const authToken = typeof parsed.authToken === "string" ? parsed.authToken.trim() : "";
  if (!accountSid || !authToken) {
    throw new ValidationError(
      undefined,
      "Twilio Voice requires accountSid and authToken credentials",
    );
  }
  return { accountSid, authToken };
}

function basicAuthHeader(creds: TwilioCredentials): string {
  return `Basic ${Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64")}`;
}

function mapTwilioStatus(raw: string | undefined): CallStatus {
  const s = (raw ?? "").toLowerCase();
  if (s === "queued" || s === "initiated") return "queued";
  if (s === "ringing") return "ringing";
  if (s === "in-progress" || s === "answered") return "in_progress";
  if (s === "completed") return "completed";
  if (s === "busy") return "busy";
  if (s === "no-answer") return "no_answer";
  if (s === "canceled") return "canceled";
  if (s === "failed") return "failed";
  return "in_progress";
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function buildTwimlGather(sayText: string, actionUrl: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<Response>",
    `  <Gather input="speech" action="${escapeXml(actionUrl)}" method="POST" speechTimeout="auto">`,
    `    <Say>${escapeXml(sayText)}</Say>`,
    "  </Gather>",
    `  <Say>We did not receive any response. Goodbye.</Say>`,
    "</Response>",
  ].join("\n");
}

export function buildTwimlHangup(sayText: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<Response>",
    `  <Say>${escapeXml(sayText)}</Say>`,
    "  <Hangup/>",
    "</Response>",
  ].join("\n");
}

export class TwilioVoiceAdapter implements VoiceProviderAdapter {
  readonly id = "twilio" as const;

  async testConnection(account: VoiceAccount): Promise<void> {
    const creds = getCredentials(account);
    await fetchOutboundJson(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(creds.accountSid)}.json`,
      {
        method: "GET",
        headers: { Authorization: basicAuthHeader(creds) },
        timeoutMs: 10_000,
      },
    );
  }

  async initiateCall(
    account: VoiceAccount,
    input: InitiateVoiceCallInput,
  ): Promise<InitiateVoiceCallOutput> {
    const creds = getCredentials(account);
    const fromNumber =
      typeof account.publicConfig.fromNumber === "string"
        ? account.publicConfig.fromNumber.trim()
        : "";
    if (!fromNumber) {
      throw new ValidationError(
        undefined,
        "Twilio Voice requires a fromNumber in configuration",
      );
    }

    const params = new URLSearchParams({
      To: input.toPhoneE164,
      From: fromNumber,
      Url: input.webhookUrl,
      StatusCallback: input.webhookUrl,
      StatusCallbackEvent: "initiated ringing answered completed",
      Record: "true",
    });

    const res = await fetchOutboundJson<Record<string, unknown>>(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(creds.accountSid)}/Calls.json`,
      {
        method: "POST",
        headers: {
          Authorization: basicAuthHeader(creds),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
        timeoutMs: 15_000,
      },
    );

    const sid = typeof res.sid === "string" ? res.sid : "";
    if (!sid) {
      throw new Error("Twilio did not return a Call Sid");
    }

    return {
      providerCallId: sid,
      status: mapTwilioStatus(typeof res.status === "string" ? res.status : "queued"),
      raw: res,
    };
  }

  async verifyWebhook(account: VoiceAccount, req: VoiceWebhookRequest): Promise<boolean> {
    const sig = req.headers["x-twilio-signature"];
    if (sig) {
      const { authToken } = getCredentials(account);
      // Standard Twilio signature verification: URL + sorted form params concatenated
      let base = req.url;
      if (req.body && typeof req.body === "object") {
        const record = req.body as Record<string, unknown>;
        for (const key of Object.keys(record).sort()) {
          const val = record[key];
          if (typeof val === "string") {
            base += `${key}${val}`;
          }
        }
      }
      const expected = createHmac("sha1", authToken).update(base).digest("base64");
      const a = Buffer.from(expected, "utf8");
      const b = Buffer.from(sig, "utf8");
      return a.length === b.length && timingSafeEqual(a, b);
    }

    if (account.webhookSecret) {
      const expected = unsealSecret(account.webhookSecret);
      const provided = req.headers["x-voice-secret"] ?? "";
      const a = Buffer.from(expected, "utf8");
      const b = Buffer.from(provided, "utf8");
      return a.length === b.length && timingSafeEqual(a, b);
    }

    return true;
  }

  parseWebhook(req: VoiceWebhookRequest): VoiceWebhookEvent | null {
    const body = req.body as Record<string, unknown> | null;
    if (!body || typeof body !== "object") return null;

    const callSid = typeof body.CallSid === "string" ? body.CallSid : "";
    if (!callSid) return null;

    const speechResult = typeof body.SpeechResult === "string" ? body.SpeechResult : undefined;
    const callStatus = typeof body.CallStatus === "string" ? body.CallStatus : undefined;
    const fromPhone = typeof body.From === "string" ? body.From : undefined;
    const toPhone = typeof body.To === "string" ? body.To : undefined;

    // StatusCallback with terminal or lifecycle status and no SpeechResult
    if (
      callStatus &&
      !speechResult &&
      ["completed", "busy", "no-answer", "canceled", "failed"].includes(callStatus.toLowerCase())
    ) {
      const durationRaw =
        typeof body.CallDuration === "string" ? Number(body.CallDuration) : undefined;
      return {
        kind: "status_update",
        providerCallId: callSid,
        status: mapTwilioStatus(callStatus),
        fromPhone,
        toPhone,
        durationSeconds:
          durationRaw !== undefined && Number.isFinite(durationRaw)
            ? Math.max(0, Math.round(durationRaw))
            : undefined,
        recordingUrl: typeof body.RecordingUrl === "string" ? body.RecordingUrl : null,
        raw: body,
      };
    }

    // Interactive TwiML turn (initial answer or SpeechResult)
    return {
      kind: "twilio_turn",
      providerCallId: callSid,
      speechResult,
      fromPhone,
      toPhone,
      callStatus,
      isInitialGather: !speechResult,
    };
  }
}

export const twilioVoiceAdapter = new TwilioVoiceAdapter();
