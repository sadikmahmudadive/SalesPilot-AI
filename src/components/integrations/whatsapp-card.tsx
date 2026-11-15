"use client";

/**
 * Integrations > Platform: connect this workspace's WhatsApp business number. The access token is
 * write-only (the API never returns it). The webhook URL, verify token and app secret belong to the
 * platform's Meta app and are configured by the platform admin, not here.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, Loader2, MessageCircle, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, apiFetch } from "@/lib/api/client";
import type {
  WhatsAppConnectionSummary,
  WhatsAppNumberOption,
} from "@/schemas/whatsapp-connection";

const API = "/api/integrations/whatsapp";

const messageOf = (err: unknown, fallback: string) =>
  err instanceof ApiError ? err.message : fallback;

function StatusLine({ summary }: { summary: WhatsAppConnectionSummary }) {
  if (!summary.connected) {
    return <p className="text-xs text-muted-foreground">Not connected</p>;
  }
  if (!summary.enabled) {
    return (
      <p className="text-xs text-amber-600">
        Connected but disabled: messages are not sent or received
      </p>
    );
  }
  if (summary.lastTestResult === "ok") {
    return (
      <p className="inline-flex items-center gap-1.5 text-xs text-emerald-600">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Connected: {summary.displayPhoneNumber ?? summary.phoneNumberId}
        {summary.verifiedName ? ` · ${summary.verifiedName}` : ""}
      </p>
    );
  }
  if (summary.lastTestResult === "failed") {
    return (
      <p className="inline-flex items-center gap-1.5 text-xs text-destructive">
        <XCircle className="h-3.5 w-3.5" />
        Test failed — check the IDs and token
      </p>
    );
  }
  return <p className="text-xs text-muted-foreground">Saved, not tested yet</p>;
}

const numberLabel = (n: WhatsAppNumberOption) =>
  [n.displayPhoneNumber ?? n.phoneNumberId, n.verifiedName].filter(Boolean).join(" · ");

/**
 * First-time connect: paste the access token, the platform finds the numbers it can use. One number
 * connects straight away; several are offered to pick from.
 */
function QuickConnect({
  onConnected,
  onManual,
}: {
  onConnected: (next: WhatsAppConnectionSummary) => void;
  onManual: () => void;
}) {
  const [token, setToken] = useState("");
  const [numbers, setNumbers] = useState<WhatsAppNumberOption[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // "find" or the phoneNumberId connecting
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);

  async function guarded(kind: string, action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(kind);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(messageOf(err, "Something went wrong. Try again."));
    } finally {
      lock.current = false;
      setBusy(null);
    }
  }

  const connect = async (n: WhatsAppNumberOption) => {
    const next = await apiFetch<WhatsAppConnectionSummary>(API, {
      method: "PUT",
      body: {
        phoneNumberId: n.phoneNumberId,
        businessAccountId: n.businessAccountId,
        accessToken: token,
        enabled: true,
      },
    });
    toast.success(`Connected ${numberLabel(n)}`);
    onConnected(next);
  };

  const find = () =>
    guarded("find", async () => {
      const found = await apiFetch<{ numbers: WhatsAppNumberOption[] }>(`${API}/numbers`, {
        method: "POST",
        body: { accessToken: token },
      });
      setNumbers(found.numbers);
      const only = found.numbers.length === 1 ? found.numbers[0] : undefined;
      if (only) await connect(only);
    });

  return (
    <div className="space-y-4">
      <form
        className="space-y-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void find();
        }}
      >
        <Label htmlFor="wa-quick-token">Access token</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="wa-quick-token"
            type="password"
            autoComplete="new-password"
            value={token}
            disabled={busy !== null}
            onChange={(e) => {
              setToken(e.target.value);
              setNumbers(null);
            }}
            placeholder="Paste your permanent WhatsApp access token"
            className="sm:flex-1"
          />
          <Button type="submit" size="sm" disabled={busy !== null || token.trim().length < 20}>
            {busy === "find" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Connect WhatsApp
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          We find your number from the token. Nothing else to type.
        </p>
      </form>

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}

      {numbers && numbers.length > 1 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-foreground">Choose the number to connect</p>
          <ul className="space-y-2">
            {numbers.map((n) => (
              <li key={n.phoneNumberId}>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void guarded(n.phoneNumberId, () => connect(n))}
                  className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="min-w-0 truncate font-medium">{numberLabel(n)}</span>
                  {busy === n.phoneNumberId ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                  ) : (
                    <span className="shrink-0 text-xs text-muted-foreground">Connect</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {numbers && numbers.length === 0 ? (
        <p className="text-xs text-amber-600">
          The token works, but Meta did not tell us which numbers it covers. Enter the IDs manually
          below.
        </p>
      ) : null}

      <details className="rounded-xl border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">
          How do I get an access token?
        </summary>
        <ol className="mt-2 list-decimal space-y-1 pl-4">
          <li>Open Meta Business Settings and go to Users &gt; System users.</li>
          <li>Create a system user with the Admin role (or pick an existing one).</li>
          <li>
            Under Assign assets, give it full control of the platform&apos;s app and your WhatsApp
            account.
          </li>
          <li>
            Click Generate token, choose the platform&apos;s app, set expiry to Never, and tick
            whatsapp_business_messaging and whatsapp_business_management.
          </li>
          <li>Copy the token and paste it above.</li>
        </ol>
      </details>

      <button
        type="button"
        onClick={onManual}
        className="cursor-pointer text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        Enter the IDs manually instead
      </button>
    </div>
  );
}

export function WhatsAppCard() {
  const [manual, setManual] = useState(false);
  const [summary, setSummary] = useState<WhatsAppConnectionSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [businessAccountId, setBusinessAccountId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState<"save" | "test" | "delete" | null>(null);
  const lock = useRef(false);

  const apply = useCallback((next: WhatsAppConnectionSummary) => {
    setSummary(next);
    setPhoneNumberId(next.phoneNumberId ?? "");
    setBusinessAccountId(next.businessAccountId ?? "");
    setEnabled(next.connected ? next.enabled : true);
    setAccessToken("");
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiFetch<WhatsAppConnectionSummary>(API)
      .then((s) => {
        if (!cancelled) apply(s);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(messageOf(err, "Couldn't load the WhatsApp connection"));
      });
    return () => {
      cancelled = true;
    };
  }, [apply]);

  /** Runs one action at a time (double-submit guard). */
  async function run(kind: "save" | "test" | "delete", action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(kind);
    try {
      await action();
    } finally {
      lock.current = false;
      setBusy(null);
    }
  }

  const test = async () => {
    const next = await apiFetch<WhatsAppConnectionSummary>(`${API}/test`, { method: "POST" });
    apply(next);
    if (next.lastTestResult === "ok") toast.success("WhatsApp number verified");
    else toast.error("Meta did not accept these details");
  };

  const save = () =>
    run("save", async () => {
      try {
        const next = await apiFetch<WhatsAppConnectionSummary>(API, {
          method: "PUT",
          body: {
            phoneNumberId,
            businessAccountId,
            ...(accessToken.trim() ? { accessToken } : {}),
            enabled,
          },
        });
        // The server verifies the number and token with Meta before saving.
        apply(next);
        toast.success("WhatsApp number verified and saved");
      } catch (err) {
        toast.error(messageOf(err, "Couldn't save the WhatsApp number"));
      }
    });

  const retest = () =>
    run("test", async () => {
      try {
        await test();
      } catch (err) {
        toast.error(messageOf(err, "Couldn't test the WhatsApp number"));
      }
    });

  const disconnect = () => {
    if (
      !confirm("Disconnect this WhatsApp number? Messages to it will stop reaching this workspace.")
    )
      return;
    void run("delete", async () => {
      try {
        await apiFetch<void>(API, { method: "DELETE" });
        apply(await apiFetch<WhatsAppConnectionSummary>(API));
        setManual(false);
        toast.success("WhatsApp number disconnected");
      } catch (err) {
        toast.error(messageOf(err, "Couldn't disconnect the WhatsApp number"));
      }
    });
  };

  const webhookUrl =
    typeof window !== "undefined" && summary
      ? `${window.location.origin}${summary.webhookUrl}`
      : "";

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-5 space-y-4 md:col-span-2">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
            <MessageCircle className="h-4 w-4" /> WhatsApp business number
          </h3>
          <p className="text-xs text-muted-foreground">
            Customers message this number; the AI, your team and automations reply from it.
          </p>
        </div>
        {summary ? <StatusLine summary={summary} /> : null}
      </div>

      {loadError ? (
        <p className="text-xs text-destructive">{loadError}</p>
      ) : !summary ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : !summary.connected && !manual ? (
        <QuickConnect onConnected={apply} onManual={() => setManual(true)} />
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={busy !== null} className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="wa-phone-number-id">Phone Number ID</Label>
              <Input
                id="wa-phone-number-id"
                inputMode="numeric"
                autoComplete="off"
                value={phoneNumberId}
                onChange={(e) => setPhoneNumberId(e.target.value)}
                placeholder="From WhatsApp > API Setup"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wa-business-account-id">WhatsApp Business Account ID</Label>
              <Input
                id="wa-business-account-id"
                inputMode="numeric"
                autoComplete="off"
                value={businessAccountId}
                onChange={(e) => setBusinessAccountId(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wa-access-token">Access token</Label>
              <Input
                id="wa-access-token"
                type="password"
                autoComplete="new-password"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder={
                  summary.hasAccessToken
                    ? "Saved — leave blank to keep"
                    : "Permanent system user token"
                }
              />
            </div>
          </fieldset>

          <label className="inline-flex items-center gap-2 text-xs text-foreground">
            <input
              type="checkbox"
              checked={enabled}
              disabled={busy !== null}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Enabled (send and receive messages for this workspace)
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={busy !== null}>
              {busy === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Save
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy !== null || !summary.connected}
              onClick={() => void retest()}
            >
              {busy === "test" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Test
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy !== null || !summary.connected}
              onClick={disconnect}
            >
              {busy === "delete" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Disconnect
            </Button>
            {!summary.connected ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy !== null}
                onClick={() => setManual(false)}
              >
                Back to simple connect
              </Button>
            ) : null}
          </div>
        </form>
      )}

      {summary ? (
        <div className="space-y-2 rounded-xl border bg-muted/20 px-3 py-2 text-[11px]">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium text-foreground">
                Webhook URL (the platform&apos;s Meta app)
              </p>
              <p className="truncate font-mono text-muted-foreground">
                {webhookUrl || summary.webhookUrl}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(webhookUrl || summary.webhookUrl);
                toast.success("Webhook URL copied");
              }}
              className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-lg border px-2 py-1 font-medium hover:bg-muted"
            >
              <Copy className="h-3 w-3" /> Copy
            </button>
          </div>
          <p
            className={
              summary.platformWebhookReady
                ? "text-muted-foreground"
                : "inline-flex items-center gap-1.5 text-amber-600"
            }
          >
            {summary.platformWebhookReady ? null : <AlertTriangle className="h-3.5 w-3.5" />}
            The webhook URL, verify token and app secret belong to the platform&apos;s Meta app and
            are set by the platform admin.
            {summary.platformWebhookReady
              ? ""
              : " They are not configured yet, so no messages can arrive."}
          </p>
        </div>
      ) : null}
    </div>
  );
}
