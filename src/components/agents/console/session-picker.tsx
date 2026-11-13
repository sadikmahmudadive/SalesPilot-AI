"use client";

import { History, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAgentSessions, useCreateSession } from "@/hooks/use-agent-sessions";
import { formatDate } from "@/lib/format";

interface SessionPickerProps {
  agentId: string;
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  disabled?: boolean;
}

export function SessionPicker({
  agentId,
  selectedSessionId,
  onSelectSession,
  disabled,
}: SessionPickerProps) {
  const sessionsQuery = useAgentSessions(agentId);
  const createMutation = useCreateSession(agentId);

  const sessions = sessionsQuery.data?.items ?? [];

  const handleCreate = async () => {
    if (disabled || createMutation.isPending) return;
    const created = await createMutation.mutateAsync();
    onSelectSession(created.id);
  };

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <History className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Session:</span>
      </div>

      <Select
        value={selectedSessionId ?? ""}
        onValueChange={onSelectSession}
        disabled={disabled || sessions.length === 0}
      >
        <SelectTrigger className="h-8 w-44 sm:w-56 text-xs">
          <SelectValue placeholder="Choose session..." />
        </SelectTrigger>
        <SelectContent>
          {sessions.map((s) => (
            <SelectItem key={s.id} value={s.id} className="text-xs">
              {formatDate(s.createdAt)} ({s.turnCount} turns)
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleCreate}
        disabled={disabled || createMutation.isPending}
        className="h-8 gap-1 text-xs"
      >
        <Plus className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">New session</span>
      </Button>
    </div>
  );
}
