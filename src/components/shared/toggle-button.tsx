"use client";

import { Button } from "@/components/ui/button";

interface ToggleButtonProps {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  children: React.ReactNode;
  disabled?: boolean;
  className?: string;
}

/** On/off filter button. Announced as a toggle (`aria-pressed`) and operable with Enter and Space. */
export function ToggleButton({
  pressed,
  onPressedChange,
  children,
  disabled,
  className,
}: ToggleButtonProps) {
  return (
    <Button
      type="button"
      variant={pressed ? "secondary" : "outline"}
      aria-pressed={pressed}
      disabled={disabled}
      className={className}
      onClick={() => onPressedChange(!pressed)}
    >
      {children}
    </Button>
  );
}
