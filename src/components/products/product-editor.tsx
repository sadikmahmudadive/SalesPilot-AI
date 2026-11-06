"use client";

import { Boxes, Lock } from "lucide-react";

import { PlaceholderCard } from "@/components/dashboard/placeholder-card";
import { ProductForm } from "@/components/products/product-form";
import { BackLink } from "@/components/shared/back-link";
import { QueryErrorState } from "@/components/shared/query-error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useProduct } from "@/hooks/use-products";
import { ApiError } from "@/lib/api/client";
import { can, type Role } from "@/lib/security/permissions";

function EditorSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-4">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-72" />
      <Skeleton className="h-64 w-full rounded-xl" />
      <Skeleton className="h-40 w-full rounded-xl" />
    </div>
  );
}

/** Loads one product for the editor; renders the form once it is there. */
function EditProduct({ id, canWrite }: { id: string; canWrite: boolean }) {
  const query = useProduct(id);
  const product = query.data;

  if (query.isPending) {
    return (
      <div>
        <BackLink href="/products">All products</BackLink>
        <p className="sr-only" role="status">
          Loading product
        </p>
        <EditorSkeleton />
      </div>
    );
  }

  if (!product) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div>
        <BackLink href="/products">All products</BackLink>
        {notFound ? (
          <PlaceholderCard icon={Boxes} heading="Product not found">
            This product may have been removed, or the link is incorrect.
          </PlaceholderCard>
        ) : (
          <QueryErrorState
            title="This product could not be loaded"
            error={query.error}
            onRetry={() => void query.refetch()}
            retrying={query.isFetching}
          />
        )}
      </div>
    );
  }

  return <ProductForm key={product.id} product={product} canWrite={canWrite} />;
}

/** The product editor page body: `/products/new` (no `id`) or `/products/[id]`. */
export function ProductEditor({ id, role }: { id?: string; role: Role }) {
  const canWrite = can(role, "products:write");

  if (id === undefined) {
    if (!canWrite) {
      return (
        <div>
          <BackLink href="/products">All products</BackLink>
          <PlaceholderCard icon={Lock} heading="You cannot add products">
            Only owners and admins can add products. You can still browse the catalogue.
          </PlaceholderCard>
        </div>
      );
    }
    return <ProductForm canWrite />;
  }
  return <EditProduct id={id} canWrite={canWrite} />;
}
