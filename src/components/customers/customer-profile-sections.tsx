import { MessageSquare, ShoppingBag } from "lucide-react";

import { PlaceholderCard } from "@/components/dashboard/placeholder-card";
import { CustomerTags } from "@/components/customers/customer-tags";
import { Badge } from "@/components/ui/badge";
import { SectionCard as Section } from "@/components/shared/section-card";
import { CONSENT_LABELS, CONSENT_VARIANTS, LANGUAGE_LABELS } from "@/config/customer-labels";
import { formatDate, formatDateOr, formatDateTime, formatMoneyMinor } from "@/lib/format";
import type { Customer } from "@/schemas/customer";

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words">{children}</dd>
    </div>
  );
}

const NOT_PROVIDED = <span className="text-muted-foreground">Not provided</span>;

export function DetailsCard({ customer: c }: { customer: Customer }) {
  const language = c.preferences?.language;
  return (
    <Section title="Details">
      <dl className="grid gap-4 sm:grid-cols-2">
        <Fact label="Phone">{c.phone}</Fact>
        <Fact label="WhatsApp">{c.whatsappNumber ?? NOT_PROVIDED}</Fact>
        <Fact label="Email">{c.email ?? NOT_PROVIDED}</Fact>
        <Fact label="Lead source">{c.leadSource ?? NOT_PROVIDED}</Fact>
        <Fact label="Address">{c.address ?? NOT_PROVIDED}</Fact>
        <Fact label="Assigned agent ID">
          {c.assignedAgentId ?? <span className="text-muted-foreground">Unassigned</span>}
        </Fact>
        <Fact label="Preferred language">{language ? LANGUAGE_LABELS[language] : NOT_PROVIDED}</Fact>
        <Fact label="Notes">{c.preferences?.notes ?? NOT_PROVIDED}</Fact>
      </dl>
    </Section>
  );
}

export function TagsCard({ tags }: { tags: readonly string[] }) {
  return (
    <Section title="Tags">
      {tags.length > 0 ? (
        <CustomerTags tags={tags} max={tags.length} />
      ) : (
        <p className="text-sm text-muted-foreground">No tags yet.</p>
      )}
    </Section>
  );
}

export function ConsentCard({ consent }: { consent: Customer["consent"] }) {
  return (
    <Section title="Messaging consent">
      <dl className="grid gap-4 sm:grid-cols-3">
        <Fact label="Status">
          <Badge variant={CONSENT_VARIANTS[consent.status]}>{CONSENT_LABELS[consent.status]}</Badge>
        </Fact>
        <Fact label="Source">{consent.source ?? NOT_PROVIDED}</Fact>
        <Fact label="Recorded on">{consent.at ? formatDateTime(consent.at) : NOT_PROVIDED}</Fact>
      </dl>
    </Section>
  );
}

export function StatsCard({ customer: c }: { customer: Customer }) {
  return (
    <Section title="Activity">
      <dl className="grid gap-4 sm:grid-cols-3">
        <Fact label="Total spent">{formatMoneyMinor(c.totalSpendMinor)}</Fact>
        <Fact label="Last activity">{formatDateOr(c.lastInteractionAt, "No activity yet")}</Fact>
        <Fact label="Customer since">{formatDate(c.createdAt)}</Fact>
      </dl>
    </Section>
  );
}

/** The two panels that arrive with later roadmap phases. */
export function LaterPanels() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <PlaceholderCard icon={MessageSquare} heading="Conversations">
        Available in a later release.
      </PlaceholderCard>
      <PlaceholderCard icon={ShoppingBag} heading="Orders">
        Available in a later release.
      </PlaceholderCard>
    </div>
  );
}
