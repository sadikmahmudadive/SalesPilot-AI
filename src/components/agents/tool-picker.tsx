"use client";

import { Badge } from "@/components/ui/badge";
import { TOOL_LABELS } from "@/config/agent-labels";
import { TOOL_NAMES, WRITE_TOOLS, type ToolName } from "@/schemas/agent";

interface ToolPickerProps {
  selected: ToolName[];
  onChange: (tools: ToolName[]) => void;
  disabled?: boolean;
}

export function ToolPicker({ selected, onChange, disabled }: ToolPickerProps) {
  const selectedSet = new Set(selected);

  const toggle = (tool: ToolName) => {
    if (disabled) return;
    if (selectedSet.has(tool)) {
      onChange(selected.filter((t) => t !== tool));
    } else {
      onChange([...selected, tool]);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {TOOL_NAMES.map((tool) => {
          const info = TOOL_LABELS[tool];
          const isChecked = selectedSet.has(tool);
          const isWrite = WRITE_TOOLS.has(tool);

          return (
            <label
              key={tool}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                isChecked
                  ? "border-primary/50 bg-primary/5"
                  : "border-border hover:border-muted-foreground/30"
              } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
            >
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                checked={isChecked}
                onChange={() => toggle(tool)}
                disabled={disabled}
              />
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium leading-none">{info.name}</span>
                  {isWrite ? (
                    <Badge variant="outline" className="px-1.5 py-0 text-[10px] uppercase text-amber-500">
                      writes data
                    </Badge>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground leading-normal">{info.description}</p>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}
