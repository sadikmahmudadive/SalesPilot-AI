"use client";

import { useId, useState } from "react";
import { X } from "lucide-react";

import { addTags, MAX_TAGS } from "@/components/customers/customer-form-model";
import { FieldError } from "@/components/customers/form-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  error?: string;
}

/** Chip input: Enter or comma adds the typed tag (blur too), each chip has a labelled remove button. */
export function TagInput({ value, onChange, error }: TagInputProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const [draft, setDraft] = useState("");
  const full = value.length >= MAX_TAGS;

  function commit(raw: string) {
    if (raw.trim()) onChange(addTags(value, raw));
    setDraft("");
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Tags</Label>
      <Input
        id={id}
        value={draft}
        disabled={full}
        placeholder={full ? `Maximum of ${MAX_TAGS} tags` : "Type a tag and press Enter"}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${hintId} ${errorId}` : hintId}
        onChange={(e) => {
          const next = e.target.value;
          if (next.includes(",")) commit(next);
          else setDraft(next);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault(); // never submit the form from the tag box
            commit(draft);
          } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => commit(draft)}
      />
      <p id={hintId} className="text-xs text-muted-foreground">
        Separate tags with a comma or Enter. Up to {MAX_TAGS}.
      </p>
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Selected tags">
          {value.map((tag) => (
            <li key={tag}>
              <Badge variant="secondary" className="h-6 gap-1 pr-1">
                {tag}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="size-4 rounded-full"
                  aria-label={`Remove tag ${tag}`}
                  onClick={() => onChange(value.filter((t) => t !== tag))}
                >
                  <X aria-hidden="true" />
                </Button>
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
      <FieldError id={errorId} message={error} />
    </div>
  );
}
