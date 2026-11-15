/**
 * Meta WhatsApp Cloud API types. Pure types module.
 */

export interface WhatsAppProfile {
  name: string;
}

export interface WhatsAppContact {
  profile: WhatsAppProfile;
  wa_id: string;
}

export interface WhatsAppTextMessage {
  body: string;
}

export interface WhatsAppInboundMessage {
  from: string;
  id: string;
  timestamp: string;
  type: "text" | "interactive" | "button" | "image" | "audio" | "document" | "unknown";
  text?: WhatsAppTextMessage;
  interactive?: {
    type: string;
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string; description?: string };
  };
}

export interface WhatsAppStatus {
  id: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: string;
  recipient_id: string;
  errors?: Array<{
    code: number;
    title: string;
    message?: string;
    error_data?: { details: string };
  }>;
}

export interface WhatsAppValueChange {
  messaging_product: "whatsapp";
  metadata: {
    display_phone_number: string;
    phone_number_id: string;
  };
  contacts?: WhatsAppContact[];
  messages?: WhatsAppInboundMessage[];
  statuses?: WhatsAppStatus[];
}

export interface WhatsAppWebhookEntry {
  id: string;
  changes: Array<{
    value: WhatsAppValueChange;
    field: string;
  }>;
}

export interface WhatsAppWebhookPayload {
  object: "whatsapp_business_account";
  entry: WhatsAppWebhookEntry[];
}
