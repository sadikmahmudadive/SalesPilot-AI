"use client";

import { FaqsEditor, SpecsEditor } from "@/components/products/product-content-editors";
import type { ProductFormApi } from "@/components/products/product-form-validation";
import { VariantEditor } from "@/components/products/variant-editor";
import { SectionCard } from "@/components/shared/section-card";

/** The repeating sections of the editor: variants, specifications and FAQs. */
export function ProductContentSections({ form }: { form: ProductFormApi }) {
  return (
    <>
      <SectionCard
        title="Variants"
        description="Sizes and colors you stock separately. Each variant has its own stock count."
      >
        <VariantEditor form={form} />
      </SectionCard>
      <SectionCard
        title="Specifications"
        description="Facts shoppers ask about, such as material or warranty."
      >
        <SpecsEditor form={form} />
      </SectionCard>
      <SectionCard title="FAQs" description="Short questions and answers about this product.">
        <FaqsEditor form={form} />
      </SectionCard>
    </>
  );
}
