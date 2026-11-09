"use client";

import { Plus, Trash2 } from "lucide-react";

import { ProductAccessField } from "@/components/agents/product-access-field";
import { ToolPicker } from "@/components/agents/tool-picker";
import type { AgentFormValues } from "@/components/agents/agent-form-model";
import { SelectField } from "@/components/shared/form-controls";
import { SectionCard } from "@/components/shared/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AGENT_LANGUAGE_OPTIONS,
  AGENT_ROLE_OPTIONS,
} from "@/config/agent-labels";
import type { AgentLanguage, AgentRole, AgentStatus, ResponseStyle } from "@/schemas/agent";

interface AgentFormSectionsProps {
  values: AgentFormValues;
  onChange: (updates: Partial<AgentFormValues>) => void;
  onRoleChange: (role: AgentRole) => void;
  disabled?: boolean;
}

export function AgentFormSections({
  values,
  onChange,
  onRoleChange,
  disabled,
}: AgentFormSectionsProps) {
  const addObjective = () => {
    if (values.objectives.length >= 10 || disabled) return;
    onChange({ objectives: [...values.objectives, ""] });
  };

  const updateObjective = (index: number, text: string) => {
    if (disabled) return;
    const next = [...values.objectives];
    next[index] = text;
    onChange({ objectives: next });
  };

  const removeObjective = (index: number) => {
    if (disabled) return;
    onChange({ objectives: values.objectives.filter((_, i) => i !== index) });
  };

  const toggleLanguage = (lang: AgentLanguage) => {
    if (disabled) return;
    const exists = values.languages.includes(lang);
    if (exists) {
      if (values.languages.length <= 1) return; // Must keep at least one
      onChange({ languages: values.languages.filter((l) => l !== lang) });
    } else {
      onChange({ languages: [...values.languages, lang] });
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Basics */}
      <SectionCard
        title="Basics"
        description="Name, role and status for this AI agent."
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="agent-name">Name</Label>
            <Input
              id="agent-name"
              placeholder="e.g. Sales Assistant"
              maxLength={80}
              value={values.name}
              onChange={(e) => onChange({ name: e.target.value })}
              disabled={disabled}
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Role"
              value={values.role}
              options={AGENT_ROLE_OPTIONS}
              onValueChange={(val) => onRoleChange(val as AgentRole)}
              disabled={disabled}
            />

            <SelectField
              label="Status"
              value={values.status}
              options={[
                { value: "inactive", label: "Inactive" },
                { value: "active", label: "Active" },
              ]}
              onValueChange={(val) => onChange({ status: val as AgentStatus })}
              disabled={disabled}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="agent-desc">Description</Label>
              <span className="text-xs text-muted-foreground">
                {values.description.length}/500
              </span>
            </div>
            <Textarea
              id="agent-desc"
              placeholder="Brief summary of what this agent does..."
              maxLength={500}
              rows={2}
              value={values.description}
              onChange={(e) => onChange({ description: e.target.value })}
              disabled={disabled}
            />
          </div>
        </div>
      </SectionCard>

      {/* 2. Personality & Instructions */}
      <SectionCard
        title="Personality & Instructions"
        description="Define tone of voice and detailed behavioural guidelines."
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="agent-personality">Personality & Tone</Label>
              <span className="text-xs text-muted-foreground">
                {values.personality.length}/1000
              </span>
            </div>
            <Textarea
              id="agent-personality"
              placeholder="e.g. Warm, polite, concise..."
              maxLength={1000}
              rows={3}
              value={values.personality}
              onChange={(e) => onChange({ personality: e.target.value })}
              disabled={disabled}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="agent-instructions">Instructions</Label>
              <span className="text-xs text-muted-foreground">
                {values.instructions.length}/8000
              </span>
            </div>
            <Textarea
              id="agent-instructions"
              placeholder="Step-by-step instructions for answering customers..."
              maxLength={8000}
              rows={6}
              value={values.instructions}
              onChange={(e) => onChange({ instructions: e.target.value })}
              disabled={disabled}
            />
          </div>
        </div>
      </SectionCard>

      {/* 3. Objectives */}
      <SectionCard
        title="Objectives"
        description="Key targets the agent should try to achieve during conversations (up to 10)."
      >
        <div className="space-y-3">
          {values.objectives.map((obj, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                placeholder={`Objective ${i + 1}`}
                maxLength={200}
                value={obj}
                onChange={(e) => updateObjective(i, e.target.value)}
                disabled={disabled}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeObjective(i)}
                disabled={disabled}
                aria-label={`Remove objective ${i + 1}`}
              >
                <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
              </Button>
            </div>
          ))}

          {values.objectives.length < 10 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addObjective}
              disabled={disabled}
              className="gap-1.5"
            >
              <Plus className="h-4 w-4" />
              Add objective
            </Button>
          ) : null}
        </div>
      </SectionCard>

      {/* 4. Languages */}
      <SectionCard
        title="Languages"
        description="Languages this agent is allowed to understand and reply in."
      >
        <div className="flex flex-wrap gap-4">
          {AGENT_LANGUAGE_OPTIONS.map((opt) => {
            const isChecked = values.languages.includes(opt.value);
            return (
              <label
                key={opt.value}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                  isChecked
                    ? "border-primary/50 bg-primary/5 font-medium"
                    : "border-border"
                } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 text-primary"
                  checked={isChecked}
                  onChange={() => toggleLanguage(opt.value)}
                  disabled={disabled}
                />
                <span>{opt.label}</span>
              </label>
            );
          })}
        </div>
      </SectionCard>

      {/* 5. Tools */}
      <SectionCard
        title="Tools"
        description="Select the capabilities granted to this agent. Dry runs only during testing."
      >
        <ToolPicker
          selected={values.tools}
          onChange={(tools) => onChange({ tools })}
          disabled={disabled}
        />
      </SectionCard>

      {/* 6. Product Access */}
      <SectionCard
        title="Product Access"
        description="Limit which catalog products this agent can look up or quote."
      >
        <ProductAccessField
          mode={values.productAccessMode}
          categoryIds={values.productAccessCategoryIds}
          onModeChange={(mode) => onChange({ productAccessMode: mode })}
          onCategoryIdsChange={(categoryIds) =>
            onChange({ productAccessCategoryIds: categoryIds })
          }
          disabled={disabled}
        />
      </SectionCard>

      {/* 7. Channels */}
      <SectionCard
        title="Channels"
        description="Communication channels where this agent operates."
      >
        <div className="space-y-3">
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked
              disabled
              className="h-4 w-4 rounded border-gray-300 text-primary"
            />
            <span className="font-medium">Test console</span>
            <Badge variant="secondary" className="text-xs">
              Active
            </Badge>
          </label>

          <label className="flex items-center gap-3 text-sm opacity-60">
            <input
              type="checkbox"
              disabled
              className="h-4 w-4 rounded border-gray-300"
            />
            <span>WhatsApp Business</span>
            <Badge variant="outline" className="text-xs">
              Phase 4
            </Badge>
          </label>

          <label className="flex items-center gap-3 text-sm opacity-60">
            <input
              type="checkbox"
              disabled
              className="h-4 w-4 rounded border-gray-300"
            />
            <span>Voice Calls</span>
            <Badge variant="outline" className="text-xs">
              Phase 6
            </Badge>
          </label>
        </div>
      </SectionCard>

      {/* 8. Escalation to Human */}
      <SectionCard
        title="Escalation to Human"
        description="Conditions under which this agent transfers the conversation to your sales team."
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="escalation-keywords">Keywords (comma-separated, up to 20)</Label>
            <Input
              id="escalation-keywords"
              placeholder="e.g. human, manager, complaint, urgent"
              value={values.escalationKeywords.join(", ")}
              onChange={(e) =>
                onChange({
                  escalationKeywords: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean)
                    .slice(0, 20),
                })
              }
              disabled={disabled}
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={values.escalationOnMissingInfo}
              onChange={(e) => onChange({ escalationOnMissingInfo: e.target.checked })}
              disabled={disabled}
              className="h-4 w-4 rounded border-gray-300 text-primary"
            />
            <span>Escalate when required info cannot be found in the catalog</span>
          </label>

          <div className="space-y-2">
            <Label htmlFor="escalation-turns">
              Max turns before handover (optional, 1–50)
            </Label>
            <Input
              id="escalation-turns"
              type="number"
              min={1}
              max={50}
              placeholder="e.g. 10"
              value={values.escalationMaxTurnsBeforeHandover}
              onChange={(e) => onChange({ escalationMaxTurnsBeforeHandover: e.target.value })}
              disabled={disabled}
              className="w-32"
            />
          </div>
        </div>
      </SectionCard>

      {/* 9. Limits & Response Style */}
      <SectionCard
        title="Limits & Response Style"
        description="Token budget, turn limits and response style."
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Response style"
              value={values.responseStyle}
              options={[
                { value: "concise", label: "Concise" },
                { value: "detailed", label: "Detailed" },
              ]}
              onValueChange={(val) => onChange({ responseStyle: val as ResponseStyle })}
              disabled={disabled}
            />

            <div className="space-y-2">
              <Label htmlFor="model-override">Model Override</Label>
              <Input
                id="model-override"
                placeholder="Default from server (OPENAI_CHAT_MODEL)"
                maxLength={100}
                value={values.model}
                onChange={(e) => onChange({ model: e.target.value })}
                disabled={disabled}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="limit-turns">Max turns per session (1–100)</Label>
              <Input
                id="limit-turns"
                type="number"
                min={1}
                max={100}
                value={values.limitsMaxTurnsPerSession}
                onChange={(e) =>
                  onChange({ limitsMaxTurnsPerSession: Number(e.target.value) })
                }
                disabled={disabled}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="limit-tools">Max tool calls / turn (1–6)</Label>
              <Input
                id="limit-tools"
                type="number"
                min={1}
                max={6}
                value={values.limitsMaxToolCallsPerTurn}
                onChange={(e) =>
                  onChange({ limitsMaxToolCallsPerTurn: Number(e.target.value) })
                }
                disabled={disabled}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="limit-tokens">Max output tokens (100–2000)</Label>
              <Input
                id="limit-tokens"
                type="number"
                min={100}
                max={2000}
                value={values.limitsMaxOutputTokens}
                onChange={(e) =>
                  onChange({ limitsMaxOutputTokens: Number(e.target.value) })
                }
                disabled={disabled}
              />
            </div>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
