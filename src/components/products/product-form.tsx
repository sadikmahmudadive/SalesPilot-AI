"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArrowLeft, Loader2 } from "lucide-react";
import { useForm, type FieldPath } from "react-hook-form";
import { toast } from "sonner";

import { FormAlert } from "@/components/auth/form-alert";
import { PageHeader } from "@/components/dashboard/page-header";
import { AvailabilityBadge } from "@/components/products/availability-badge";
import { ArchiveProductDialog } from "@/components/products/archive-product-dialog";
import { ImageGallery } from "@/components/products/image-gallery";
import { ProductContentSections } from "@/components/products/product-content-sections";
import { AvailabilityField, BasicsFields, PricingFields } from "@/components/products/product-form-fields";
import {
  buildProductPatch,
  EMPTY_PRODUCT_VALUES,
  prepareProductBody,
  productToFormValues,
  type ProductFormValues,
} from "@/components/products/product-form-model";
import { mapProductApiError, productResolver, validateProductForm } from "@/components/products/product-form-validation";
import { DiscardChangesDialog } from "@/components/shared/discard-changes-dialog";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { useCreateProduct, useUpdateProduct } from "@/hooks/use-products";
import { useRevealAlert } from "@/hooks/use-reveal-alert";
import { useBeforeUnloadGuard } from "@/hooks/use-unsaved-changes";
import { asApiError } from "@/lib/api/map-error";
import type { Product } from "@/schemas/product";

const LIST_PATH = "/products";
const LIST_ROOTS = new Set(["variants", "specs", "faqs"]);
const INVALID_MESSAGE = "Some fields need attention. Check the highlighted fields below.";

interface ProductFormProps {
  /** Present when editing. */
  product?: Product;
  canWrite: boolean;
}

/**
 * Create / edit page for a product. Editing sends only what changed (see `buildProductPatch`);
 * people without write access see the same page read-only. Leaving with unsaved edits asks first
 * (in-app Cancel / Back) or relies on the browser prompt (closing or reloading the tab).
 */
export function ProductForm({ product, canWrite }: ProductFormProps) {
  const router = useRouter();
  const create = useCreateProduct();
  const update = useUpdateProduct();
  const submitLock = useRef(false);
  const [pending, setPending] = useState(false);
  // `reveal`: the failure has no field to focus, so the banner itself is scrolled to and focused.
  const [formError, setFormError] = useState<{ message: string; requestId?: string; reveal?: boolean } | null>(null);
  const alertRef = useRevealAlert(formError?.reveal ? formError : null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [archiving, setArchiving] = useState(false);

  // The edit diff is taken against the last saved values, not against the (refreshing) query data.
  const [baseline, setBaseline] = useState<ProductFormValues>(() =>
    product ? productToFormValues(product) : EMPTY_PRODUCT_VALUES,
  );
  const form = useForm<ProductFormValues>({ resolver: productResolver, defaultValues: baseline });
  const { handleSubmit, setError, setFocus, getValues, reset, formState } = form;

  const isEdit = product !== undefined;
  const dirty = formState.isDirty;
  useBeforeUnloadGuard(dirty && canWrite);

  function leave() {
    router.push(LIST_PATH);
  }
  function requestLeave() {
    if (dirty && canWrite) setConfirmDiscard(true);
    else leave();
  }

  function showServerError(error: unknown) {
    const mapped = mapProductApiError(asApiError(error));
    for (const field of mapped.fields) {
      const name = LIST_ROOTS.has(field.name) ? `${field.name}.root` : field.name;
      setError(name as FieldPath<ProductFormValues>, { type: "server", message: field.message });
    }
    const first = mapped.fields.find((f) => !LIST_ROOTS.has(f.name));
    if (first) setFocus(first.name as FieldPath<ProductFormValues>);
    setFormError(
      mapped.formError ? { message: mapped.formError, requestId: mapped.requestId, reveal: !first } : null,
    );
  }

  async function save() {
    if (submitLock.current) return; // synchronous guard: two quick submits cannot both pass
    submitLock.current = true;
    setPending(true);
    setFormError(null);
    try {
      const { body } = validateProductForm(getValues());
      if (!body) return;
      if (product) {
        const patch = buildProductPatch(prepareProductBody(baseline).body, body);
        if (Object.keys(patch).length === 0) {
          toast.info("No changes to save");
          return;
        }
        const saved = await update.mutateAsync({ id: product.id, body: patch });
        const next = productToFormValues(saved);
        setBaseline(next); // the server assigns ids to new variants: they must be sent from now on
        reset(next);
        toast.success("Product updated");
      } else {
        const created = await create.mutateAsync(body);
        reset(getValues()); // not dirty any more: leaving for the new product's page is not a "discard"
        toast.success("Product added");
        router.replace(`${LIST_PATH}/${encodeURIComponent(created.id)}`);
      }
    } catch (error) {
      showServerError(error);
    } finally {
      submitLock.current = false;
      setPending(false);
    }
  }

  const name = product?.name ?? "";
  const archived = product?.archived === true;

  return (
    <div>
      <Button variant="ghost" size="sm" className="-ml-2.5 mb-3" onClick={requestLeave}>
        <ArrowLeft aria-hidden="true" />
        All products
      </Button>
      <PageHeader
        title={isEdit ? name : "New product"}
        description={
          isEdit ? (
            <span className="flex flex-wrap items-center gap-2">
              <AvailabilityBadge availability={product.availability} />
              <span className="font-mono text-xs">{product.sku}</span>
            </span>
          ) : (
            "Add a product to your catalogue. You can add images later."
          )
        }
        actions={
          isEdit && canWrite && !archived ? (
            <Button variant="outline" onClick={() => setArchiving(true)}>
              <Archive aria-hidden="true" />
              Archive
            </Button>
          ) : null
        }
      />

      {!canWrite ? (
        <p className="mb-4 rounded-lg border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          You have view-only access to products. Ask an owner or admin to make changes.
        </p>
      ) : null}
      {archived && canWrite ? (
        <p className="mb-4 rounded-lg border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          This product is archived. To restore it, set Availability to Active or Draft and save.
        </p>
      ) : null}

      <form
        onSubmit={(event) =>
          void handleSubmit(save, () => {
            setFormError({ message: INVALID_MESSAGE });
          })(event)
        }
        noValidate
        aria-label={isEdit ? `Edit ${name}` : "New product"}
      >
        <FormAlert ref={alertRef} message={formError?.message}>
          {formError?.requestId ? <p className="text-xs">Reference: {formError.requestId}</p> : null}
        </FormAlert>
        {/* A disabled fieldset disables every control inside it, which is all read-only mode needs. */}
        <fieldset disabled={!canWrite} className="m-0 min-w-0 space-y-4 border-0 p-0">
          <SectionCard title="Basics">
            <BasicsFields form={form} canWrite={canWrite} />
          </SectionCard>
          <SectionCard title="Pricing" description="Type prices in taka, for example 1200 or 1,200.50.">
            <PricingFields form={form} />
          </SectionCard>
          <SectionCard
            title="Availability"
            description="Draft products are not offered to customers. Archive a product to retire it."
          >
            <AvailabilityField form={form} archived={archived} />
          </SectionCard>
          <ProductContentSections form={form} />
          <SectionCard title="Images">
            <ImageGallery images={baseline.images} productName={name} />
          </SectionCard>
        </fieldset>

        <div className="mt-6 flex flex-wrap justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" onClick={requestLeave} disabled={pending}>
            {canWrite ? "Cancel" : "Back to products"}
          </Button>
          {canWrite ? (
            <Button type="submit" disabled={pending} aria-busy={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              {isEdit ? "Save changes" : "Add product"}
            </Button>
          ) : null}
        </div>
      </form>

      <DiscardChangesDialog open={confirmDiscard} onOpenChange={setConfirmDiscard} onDiscard={leave} />
      {product && canWrite ? (
        <ArchiveProductDialog
          product={archiving ? product : null}
          onOpenChange={setArchiving}
          onArchived={() => {
            reset(getValues()); // the page is being left: nothing is left to "discard"
            leave();
          }}
        />
      ) : null}
    </div>
  );
}
