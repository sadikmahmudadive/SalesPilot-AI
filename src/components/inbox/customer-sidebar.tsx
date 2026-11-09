"use client";

import Link from "next/link";
import { ExternalLink, Phone, User } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Conversation } from "@/schemas/inbox";

export function CustomerSidebar({
  conversation,
}: {
  conversation: Conversation | null;
}) {
  if (!conversation) return null;

  return (
    <div className="w-72 border-l border-border/50 bg-card/40 flex flex-col h-full overflow-y-auto p-4 space-y-6">
      {/* Profile Overview */}
      <div className="flex flex-col items-center text-center space-y-2 pt-2">
        <div className="w-14 h-14 rounded-full bg-primary/10 border-2 border-primary/20 flex items-center justify-center">
          <span className="text-xl font-bold text-primary">
            {conversation.contactName.charAt(0).toUpperCase()}
          </span>
        </div>
        <div>
          <h3 className="text-sm font-bold text-foreground">{conversation.contactName}</h3>
          <p className="text-xs text-muted-foreground">{conversation.contactPhoneE164}</p>
        </div>
        <Badge variant="outline" className="text-xs border-primary/30 text-primary">
          WhatsApp Contact
        </Badge>
      </div>

      {/* Contact Details */}
      <div className="space-y-3 pt-2 border-t border-border/40 text-xs">
        <h4 className="font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">
          Contact Information
        </h4>

        <div className="flex items-center gap-2.5 text-foreground">
          <Phone className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span className="truncate">{conversation.contactPhoneE164}</span>
        </div>

        <div className="pt-1">
          <a
            href={`https://wa.me/${conversation.contactPhoneE164.replace(/\D/g, "")}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1.5 font-medium"
          >
            Open in WhatsApp Web
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      {/* Automation & Agent Assignment */}
      <div className="space-y-3 pt-2 border-t border-border/40 text-xs">
        <h4 className="font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">
          AI & Assignment
        </h4>

        <div className="p-2.5 rounded-lg bg-background/50 border border-border/40 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-[11px]">Mode</span>
            <span className="font-medium text-[11px] text-foreground capitalize">
              {conversation.status.replace("_", " ")}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-[11px]">Channel</span>
            <span className="font-medium text-[11px] text-emerald-400 capitalize">
              {conversation.channel}
            </span>
          </div>
        </div>
      </div>

      {/* CRM Actions */}
      <div className="pt-2 border-t border-border/40">
        <Button asChild variant="outline" size="sm" className="w-full text-xs gap-1.5">
          <Link href="/customers">
            <User className="w-3.5 h-3.5" />
            Manage in CRM
          </Link>
        </Button>
      </div>
    </div>
  );
}
