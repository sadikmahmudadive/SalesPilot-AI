"use client";

import { useId, useState } from "react";
import { AlertTriangle, Loader2, Truck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useBookShipment,
  useCourierAccounts,
  useCourierLocations,
  type OrderDetail,
} from "@/hooks/use-orders";
import type { CourierAccountSummary } from "@/schemas/courier";
import type { Order } from "@/schemas/order";

import {
  buildBookShipmentPayload,
  validateBookCourierForm,
  type BookCourierFormValues,
} from "./book-courier-model";

interface BookCourierDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: OrderDetail;
  onBooked: (order: Order) => void;
}

export function BookCourierDialog({
  open,
  onOpenChange,
  order,
  onBooked,
}: BookCourierDialogProps) {
  const { data: accountsData, isLoading: loadingAccounts } = useCourierAccounts();
  const accounts = (accountsData?.items ?? []).filter((a) => a.enabled);

  const defaultAccount =
    accounts.find((a) => a.id === order.shipment?.courierAccountId) ||
    accounts.find((a) => a.isDefault) ||
    accounts[0];

  const defaultCod =
    order.paymentMethod === "cod"
      ? (order.totalMinor / 100).toString()
      : "0";

  return open ? (
    <BookCourierDialogBody
      key={`${order.id}-${order.shipment?.bookingState ?? "new"}`}
      order={order}
      accounts={accounts}
      defaultAccountId={defaultAccount?.id ?? ""}
      defaultCod={defaultCod}
      loadingAccounts={loadingAccounts}
      onClose={() => onOpenChange(false)}
      onBooked={onBooked}
    />
  ) : null;
}

function BookCourierDialogBody({
  order,
  accounts,
  defaultAccountId,
  defaultCod,
  loadingAccounts,
  onClose,
  onBooked,
}: {
  order: OrderDetail;
  accounts: CourierAccountSummary[];
  defaultAccountId: string;
  defaultCod: string;
  loadingAccounts: boolean;
  onClose: () => void;
  onBooked: (order: Order) => void;
}) {
  const accountSelectId = useId();
  const weightInputId = useId();
  const codInputId = useId();
  const citySelectId = useId();
  const zoneSelectId = useId();
  const areaSelectId = useId();
  const noteInputId = useId();

  const [form, setForm] = useState<BookCourierFormValues>({
    courierAccountId: defaultAccountId,
    weightKg: order.shipment?.weightKg?.toString() ?? "0.5",
    codAmount: defaultCod,
    cityId: order.shipment?.location?.cityId ?? "",
    cityName: order.shipment?.location?.cityName ?? "",
    zoneId: order.shipment?.location?.zoneId ?? "",
    zoneName: order.shipment?.location?.zoneName ?? "",
    areaId: order.shipment?.location?.areaId ?? "",
    areaName: order.shipment?.location?.areaName ?? "",
    note: "",
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const bookMutation = useBookShipment(order.id);

  const selectedAccount = accounts.find((a) => a.id === form.courierAccountId);
  const requiresLocation =
    selectedAccount?.provider === "pathao" || selectedAccount?.provider === "redx";

  // Locations hierarchy
  const { data: citiesData, isLoading: loadingCities } = useCourierLocations(
    selectedAccount?.provider,
    "city",
  );
  const { data: zonesData, isLoading: loadingZones } = useCourierLocations(
    selectedAccount?.provider,
    "zone",
    form.cityId || null,
  );
  const { data: areasData, isLoading: loadingAreas } = useCourierLocations(
    selectedAccount?.provider,
    "area",
    form.zoneId || null,
  );

  const cities = citiesData?.items ?? [];
  const zones = zonesData?.items ?? [];
  const areas = areasData?.items ?? [];

  const handleAccountChange = (accountId: string) => {
    setForm((prev) => ({
      ...prev,
      courierAccountId: accountId,
      cityId: "",
      cityName: "",
      zoneId: "",
      zoneName: "",
      areaId: "",
      areaName: "",
    }));
  };

  const handleCityChange = (cityId: string) => {
    const selected = cities.find((c) => c.id === cityId);
    setForm((prev) => ({
      ...prev,
      cityId,
      cityName: selected?.name ?? "",
      zoneId: "",
      zoneName: "",
      areaId: "",
      areaName: "",
    }));
  };

  const handleZoneChange = (zoneId: string) => {
    const selected = zones.find((z) => z.id === zoneId);
    setForm((prev) => ({
      ...prev,
      zoneId,
      zoneName: selected?.name ?? "",
      areaId: "",
      areaName: "",
    }));
  };

  const handleAreaChange = (areaId: string) => {
    const selected = areas.find((a) => a.id === areaId);
    setForm((prev) => ({
      ...prev,
      areaId,
      areaName: selected?.name ?? "",
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const fieldErrors = validateBookCourierForm(form, requiresLocation);
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }

    try {
      const payload = buildBookShipmentPayload(form);
      const updated = await bookMutation.mutateAsync(payload);
      toast.success("Shipment booked successfully");
      onBooked(updated);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to book shipment");
    }
  };

  const isUnknownState = order.shipment?.bookingState === "booking_unknown";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="size-5 text-primary" />
            Book Courier Shipment
          </DialogTitle>
          <DialogDescription>
            Dispatch order {order.orderNumber} with an integrated logistics partner.
          </DialogDescription>
        </DialogHeader>

        {isUnknownState ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Unconfirmed Booking State</p>
              <p className="mt-0.5 text-muted-foreground">
                The previous booking timed out or returned an error. Resubmitting will lookup any
                already created parcel by invoice to prevent duplicate parcels.
              </p>
            </div>
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {/* Account Selector */}
          <div className="space-y-1.5">
            <Label htmlFor={accountSelectId}>Courier Account</Label>
            {loadingAccounts ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground p-2">
                <Loader2 className="size-3.5 animate-spin" /> Loading courier accounts...
              </div>
            ) : accounts.length === 0 ? (
              <p className="text-xs text-destructive">
                No active courier accounts found. Please configure a courier integration first.
              </p>
            ) : (
              <select
                id={accountSelectId}
                value={form.courierAccountId}
                onChange={(e) => handleAccountChange(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.label} ({acc.provider.toUpperCase()})
                    {acc.isDefault ? " - Default" : ""}
                    {acc.mode === "sandbox" || acc.mode === "mock" ? " [Test Mode]" : ""}
                  </option>
                ))}
              </select>
            )}
            {errors.courierAccountId ? (
              <p className="text-xs text-destructive">{errors.courierAccountId}</p>
            ) : null}
          </div>

          {/* Cascading Location Pickers if Required */}
          {requiresLocation ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-lg border bg-muted/30">
              <div className="space-y-1 sm:col-span-2">
                <span className="text-xs font-semibold text-foreground">Delivery Location</span>
                <p className="text-[11px] text-muted-foreground">
                  {selectedAccount?.provider.toUpperCase()} requires matching city and zone.
                </p>
              </div>

              {/* City */}
              <div className="space-y-1">
                <Label htmlFor={citySelectId} className="text-xs">City / Division</Label>
                <select
                  id={citySelectId}
                  value={form.cityId}
                  onChange={(e) => handleCityChange(e.target.value)}
                  disabled={loadingCities || cities.length === 0}
                  className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">Select City</option>
                  {cities.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {errors.cityId ? <p className="text-xs text-destructive">{errors.cityId}</p> : null}
              </div>

              {/* Zone */}
              <div className="space-y-1">
                <Label htmlFor={zoneSelectId} className="text-xs">Thana / Zone</Label>
                <select
                  id={zoneSelectId}
                  value={form.zoneId}
                  onChange={(e) => handleZoneChange(e.target.value)}
                  disabled={!form.cityId || loadingZones || zones.length === 0}
                  className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">Select Zone</option>
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name}
                    </option>
                  ))}
                </select>
                {errors.zoneId ? <p className="text-xs text-destructive">{errors.zoneId}</p> : null}
              </div>

              {/* Area */}
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor={areaSelectId} className="text-xs">Area (Optional)</Label>
                <select
                  id={areaSelectId}
                  value={form.areaId}
                  onChange={(e) => handleAreaChange(e.target.value)}
                  disabled={!form.zoneId || loadingAreas || areas.length === 0}
                  className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">Select Area (Optional)</option>
                  {areas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}

          {/* Weight & COD */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={weightInputId}>Weight (kg)</Label>
              <Input
                id={weightInputId}
                type="number"
                step="0.1"
                min="0.1"
                value={form.weightKg}
                onChange={(e) => setForm((prev) => ({ ...prev, weightKg: e.target.value }))}
                placeholder="0.5"
              />
              {errors.weightKg ? <p className="text-xs text-destructive">{errors.weightKg}</p> : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={codInputId}>COD Amount (৳)</Label>
              <Input
                id={codInputId}
                type="number"
                step="1"
                min="0"
                value={form.codAmount}
                onChange={(e) => setForm((prev) => ({ ...prev, codAmount: e.target.value }))}
                placeholder="0"
              />
              {errors.codAmount ? <p className="text-xs text-destructive">{errors.codAmount}</p> : null}
            </div>
          </div>

          {/* Delivery Note */}
          <div className="space-y-1.5">
            <Label htmlFor={noteInputId}>Special Delivery Instructions (Optional)</Label>
            <Input
              id={noteInputId}
              value={form.note}
              onChange={(e) => setForm((prev) => ({ ...prev, note: e.target.value }))}
              placeholder="e.g. Call before delivery, handle with care"
              maxLength={200}
            />
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={bookMutation.isPending}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={bookMutation.isPending || accounts.length === 0}
              className="gap-2"
            >
              {bookMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Confirm Booking
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
