"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, UserX } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { PlaceholderCard } from "@/components/dashboard/placeholder-card";
import { CustomerFormDialog } from "@/components/customers/customer-form";
import {
  ConsentCard,
  DetailsCard,
  LaterPanels,
  StatsCard,
  TagsCard,
} from "@/components/customers/customer-profile-sections";
import { DeleteCustomerDialog } from "@/components/customers/delete-customer-dialog";
import { BackLink } from "@/components/shared/back-link";
import { QueryErrorState } from "@/components/shared/query-error-state";
import { SegmentBadge } from "@/components/customers/segment-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TYPE_LABELS } from "@/config/customer-labels";
import { useCustomer } from "@/hooks/use-customers";
import { ApiError } from "@/lib/api/client";
import { can, type Role } from "@/lib/security/permissions";

function ProfileSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-4">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-72" />
      <Skeleton className="h-48 w-full rounded-xl" />
      <Skeleton className="h-28 w-full rounded-xl" />
    </div>
  );
}

export function CustomerProfile({ id, role }: { id: string; role: Role }) {
  const router = useRouter();
  const canWrite = can(role, "customers:write");
  const query = useCustomer(id);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const customer = query.data;

  if (query.isPending) {
    return (
      <div>
        <BackLink href="/customers">All customers</BackLink>
        <p className="sr-only" role="status">
          Loading customer
        </p>
        <ProfileSkeleton />
      </div>
    );
  }

  if (!customer) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div>
        <BackLink href="/customers">All customers</BackLink>
        {notFound ? (
          <PlaceholderCard icon={UserX} heading="Customer not found">
            This customer may have been deleted, or the link is incorrect.
          </PlaceholderCard>
        ) : (
          <QueryErrorState
            title="This customer could not be loaded"
            error={query.error}
            onRetry={() => void query.refetch()}
            retrying={query.isFetching}
          />
        )}
      </div>
    );
  }

  return (
    <div>
      <BackLink href="/customers">All customers</BackLink>
      <PageHeader
        title={customer.fullName}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <SegmentBadge segment={customer.segment} />
            <Badge variant="outline">{TYPE_LABELS[customer.customerType]}</Badge>
          </span>
        }
        actions={
          canWrite ? (
            <>
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil aria-hidden="true" />
                Edit
              </Button>
              <Button variant="destructive" onClick={() => setDeleting(true)}>
                <Trash2 aria-hidden="true" />
                Delete
              </Button>
            </>
          ) : null
        }
      />
      <div className="space-y-4">
        <DetailsCard customer={customer} />
        <div className="grid gap-4 lg:grid-cols-2">
          <TagsCard tags={customer.tags} />
          <ConsentCard consent={customer.consent} />
        </div>
        <StatsCard customer={customer} />
        <LaterPanels />
      </div>
      {canWrite ? (
        <CustomerFormDialog open={editing} onOpenChange={setEditing} customer={customer} />
      ) : null}
      <DeleteCustomerDialog
        customer={deleting ? customer : null}
        onOpenChange={setDeleting}
        onDeleted={() => router.push("/customers")}
      />
    </div>
  );
}
