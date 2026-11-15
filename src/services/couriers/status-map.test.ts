import { describe, expect, it } from "vitest";

import {
  mapCourierStatus,
  mapMockStatus,
  mapPathaoStatus,
  mapRedxStatus,
  mapSteadfastStatus,
  toOrderLifecycleEffect,
} from "./status-map";

describe("courier status mappings", () => {
  describe("mapSteadfastStatus", () => {
    it("maps Steadfast statuses accurately", () => {
      expect(mapSteadfastStatus("in_review")).toBe("booked");
      expect(mapSteadfastStatus("pending")).toBe("pending_pickup");
      expect(mapSteadfastStatus("picked")).toBe("picked_up");
      expect(mapSteadfastStatus("in_transit")).toBe("in_transit");
      expect(mapSteadfastStatus("holding")).toBe("out_for_delivery");
      expect(mapSteadfastStatus("delivered")).toBe("delivered");
      expect(mapSteadfastStatus("partial_delivered")).toBe("partial_delivered");
      expect(mapSteadfastStatus("cancelled")).toBe("cancelled");
      expect(mapSteadfastStatus("hold")).toBe("on_hold");
      expect(mapSteadfastStatus("return")).toBe("returned");
      expect(mapSteadfastStatus("returned")).toBe("returned");
      expect(mapSteadfastStatus("unexpected_raw_status")).toBe("unknown");
    });
  });

  describe("mapPathaoStatus", () => {
    it("maps Pathao statuses accurately with case and format variations", () => {
      expect(mapPathaoStatus("Pending")).toBe("pending_pickup");
      expect(mapPathaoStatus("Accepted")).toBe("pending_pickup");
      expect(mapPathaoStatus("Picking")).toBe("pending_pickup");
      expect(mapPathaoStatus("Picked")).toBe("picked_up");
      expect(mapPathaoStatus("In_Transit")).toBe("in_transit");
      expect(mapPathaoStatus("At_Sorting_Hub")).toBe("in_transit");
      expect(mapPathaoStatus("Assigned_For_Delivery")).toBe("out_for_delivery");
      expect(mapPathaoStatus("Delivered")).toBe("delivered");
      expect(mapPathaoStatus("Partial_Delivery")).toBe("partial_delivered");
      expect(mapPathaoStatus("Return")).toBe("returned");
      expect(mapPathaoStatus("Returned")).toBe("returned");
      expect(mapPathaoStatus("Cancelled")).toBe("cancelled");
      expect(mapPathaoStatus("On_Hold")).toBe("on_hold");
      expect(mapPathaoStatus("unknown_status")).toBe("unknown");
    });
  });

  describe("mapRedxStatus", () => {
    it("maps RedX statuses accurately", () => {
      expect(mapRedxStatus("pickup-pending")).toBe("pending_pickup");
      expect(mapRedxStatus("picked-up")).toBe("picked_up");
      expect(mapRedxStatus("received-at-hub")).toBe("in_transit");
      expect(mapRedxStatus("delivery-in-progress")).toBe("out_for_delivery");
      expect(mapRedxStatus("delivered")).toBe("delivered");
      expect(mapRedxStatus("partial-delivered")).toBe("partial_delivered");
      expect(mapRedxStatus("returned-to-hub")).toBe("returned");
      expect(mapRedxStatus("cancelled")).toBe("cancelled");
      expect(mapRedxStatus("hold")).toBe("on_hold");
      expect(mapRedxStatus("unknown_code")).toBe("unknown");
    });
  });

  describe("mapMockStatus", () => {
    it("maps mock statuses directly", () => {
      expect(mapMockStatus("booked")).toBe("booked");
      expect(mapMockStatus("delivered")).toBe("delivered");
      expect(mapMockStatus("unknown")).toBe("unknown");
    });
  });

  describe("mapCourierStatus", () => {
    it("delegates to the correct provider", () => {
      expect(mapCourierStatus("steadfast", "delivered")).toBe("delivered");
      expect(mapCourierStatus("pathao", "Delivered")).toBe("delivered");
      expect(mapCourierStatus("redx", "delivered")).toBe("delivered");
      expect(mapCourierStatus("mock", "delivered")).toBe("delivered");
    });
  });

  describe("toOrderLifecycleEffect", () => {
    it("maps in_transit or picked_up to shipped and commitStock", () => {
      expect(toOrderLifecycleEffect("picked_up")).toEqual({
        targetOrderStatus: "shipped",
        commitStock: true,
      });
      expect(toOrderLifecycleEffect("in_transit")).toEqual({
        targetOrderStatus: "shipped",
        commitStock: true,
      });
      expect(toOrderLifecycleEffect("out_for_delivery")).toEqual({
        targetOrderStatus: "shipped",
        commitStock: true,
      });
    });

    it("maps delivered and partial_delivered to delivered and codCollected", () => {
      expect(toOrderLifecycleEffect("delivered")).toEqual({
        targetOrderStatus: "delivered",
        codCollected: true,
      });
      expect(toOrderLifecycleEffect("partial_delivered")).toEqual({
        targetOrderStatus: "delivered",
        codCollected: true,
      });
    });

    it("maps returned to returned", () => {
      expect(toOrderLifecycleEffect("returned")).toEqual({
        targetOrderStatus: "returned",
      });
    });

    it("returns null for non-advancing or intermediate statuses", () => {
      expect(toOrderLifecycleEffect("booked")).toBeNull();
      expect(toOrderLifecycleEffect("pending_pickup")).toBeNull();
      expect(toOrderLifecycleEffect("on_hold")).toBeNull();
      expect(toOrderLifecycleEffect("unknown")).toBeNull();
    });
  });
});
