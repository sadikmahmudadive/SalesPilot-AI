"use client";

import { useMemo, useState } from "react";
import { PackageSearch, SearchX } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { PlaceholderCard } from "@/components/dashboard/placeholder-card";
import { AdjustDialog } from "@/components/inventory/adjust-dialog";
import { InventoryCardList, InventoryTable } from "@/components/inventory/inventory-table";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { PagedListView } from "@/components/shared/paged-list";
import { ToggleButton } from "@/components/shared/toggle-button";
import { Button } from "@/components/ui/button";
import { LOW_STOCK_THRESHOLD } from "@/config/inventory";
import { useInventory } from "@/hooks/use-inventory";
import { countLabel, PAGE_SIZE } from "@/lib/list-ui";
import { can, type Role } from "@/lib/security/permissions";
import type { InventoryListItem } from "@/schemas/inventory";

const NOUN = { singular: "stock item", plural: "stock items" };

export function InventoryList({ role }: { role: Role }) {
  const canWrite = can(role, "inventory:write");
  const [lowStock, setLowStock] = useState(false);
  const [adjusting, setAdjusting] = useState<InventoryListItem | null>(null);

  const query = useInventory({ lowStock, limit: PAGE_SIZE });
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  // The dialog shows the freshest numbers: the row in the list when it is still there.
  const adjustingLive = useMemo(
    () => (adjusting ? (items.find((i) => i.id === adjusting.id) ?? adjusting) : null),
    [adjusting, items],
  );

  const empty = lowStock ? (
    <PlaceholderCard icon={SearchX} heading="Nothing is running low">
      Every stock item has more than {LOW_STOCK_THRESHOLD} available.
      <span className="mt-4 block">
        <Button variant="outline" onClick={() => setLowStock(false)}>
          Show all stock
        </Button>
      </span>
    </PlaceholderCard>
  ) : (
    <PlaceholderCard icon={PackageSearch} heading="No stock to show yet">
      Stock appears here once you add products. Each product, or each of its variants, gets a stock count.
    </PlaceholderCard>
  );

  return (
    <div>
      <PageHeader
        title="Inventory"
        description="What you have on hand, what is reserved for orders, and what is available to sell."
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <ToggleButton pressed={lowStock} onPressedChange={setLowStock}>
          Low stock only (available {LOW_STOCK_THRESHOLD} or fewer)
        </ToggleButton>
      </div>
      <PagedListView query={query} items={items} noun={NOUN} skeleton={<ListSkeleton />} empty={empty}>
        {(rows) => {
          const table = {
            items: rows,
            canWrite,
            caption: `Inventory, ${countLabel(rows.length, "stock item")} shown`,
            onAdjust: setAdjusting,
          };
          return (
            <>
              <InventoryTable {...table} />
              <InventoryCardList {...table} />
            </>
          );
        }}
      </PagedListView>
      {canWrite ? (
        <AdjustDialog item={adjustingLive} onOpenChange={(open) => !open && setAdjusting(null)} />
      ) : null}
    </div>
  );
}
