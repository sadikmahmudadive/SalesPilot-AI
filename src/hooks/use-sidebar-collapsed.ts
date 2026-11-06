"use client";

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "sp.sidebar.collapsed";
const CHANGE_EVENT = "sp:sidebar-collapsed";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

// Used only when localStorage throws (blocked / private mode) so the toggle still works for this page view.
let memoryFallback: boolean | null = null;

function readSnapshot(): boolean {
  if (memoryFallback !== null) return memoryFallback;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

// The server (and the hydration pass) always renders expanded, so there is no hydration mismatch;
// the stored preference is applied right after hydration.
const readServerSnapshot = (): boolean => false;

/** Sidebar collapse preference, persisted in localStorage and synced across tabs. */
export function useSidebarCollapsed(): readonly [boolean, (next: boolean) => void] {
  const collapsed = useSyncExternalStore(subscribe, readSnapshot, readServerSnapshot);
  const setCollapsed = useCallback((next: boolean) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      memoryFallback = null;
    } catch {
      memoryFallback = next;
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);
  return [collapsed, setCollapsed] as const;
}
