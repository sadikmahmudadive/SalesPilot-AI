"use client";

import { useEffect, useState } from "react";
import { History, Loader2, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface AuditLogItem {
  id: string;
  actorUid: string;
  action: string;
  resource: string;
  resourceId: string;
  createdAt: string | null;
}

export function AuditLogViewer({ canReadAudit }: { canReadAudit: boolean }) {
  const [items, setItems] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(canReadAudit);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    if (!canReadAudit) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/audit-logs?limit=50");
      if (!res.ok) throw new Error("Failed to load audit log");
      const json = (await res.json()) as { items?: AuditLogItem[] };
      setItems(json.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load audit log");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!canReadAudit) return;
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/audit-logs?limit=50");
        if (!res.ok) throw new Error("Failed to load audit log");
        const json = (await res.json()) as { items?: AuditLogItem[] };
        if (!cancelled) setItems(json.items ?? []);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load audit log");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [canReadAudit]);

  if (!canReadAudit) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base font-medium">
            <History className="size-4" />
            Audit Log
          </CardTitle>
          <CardDescription>Only an owner or admin can inspect organization audit history.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-base font-medium">
            <History className="size-4" />
            Audit Log
          </CardTitle>
          <CardDescription>
            Recent mutations recorded across customers, products, orders, integrations, and automations.
          </CardDescription>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        {loading && items.length === 0 ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading audit entries...
          </div>
        ) : error ? (
          <p className="text-sm text-destructive py-4">{error}</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6">No audit entries recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Timestamp</th>
                  <th className="py-2 pr-4 font-medium">Action</th>
                  <th className="py-2 pr-4 font-medium">Resource</th>
                  <th className="py-2 pr-4 font-medium">Resource ID</th>
                  <th className="py-2 font-medium">Actor</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="py-2.5 pr-4 whitespace-nowrap text-muted-foreground tabular-nums">
                      {item.createdAt ? new Date(item.createdAt).toLocaleString() : "—"}
                    </td>
                    <td className="py-2.5 pr-4">
                      <Badge variant="outline" className="font-mono text-[11px]">
                        {item.action}
                      </Badge>
                    </td>
                    <td className="py-2.5 pr-4">{item.resource}</td>
                    <td className="py-2.5 pr-4 font-mono text-xs text-muted-foreground">
                      {item.resourceId}
                    </td>
                    <td className="py-2.5 font-mono text-xs text-muted-foreground">
                      {item.actorUid}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
