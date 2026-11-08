import {
  AGENT_LANGUAGES,
  AGENT_ROLES,
  type AgentLanguage,
  type AgentRole,
  type ToolName,
} from "@/schemas/agent";

/** Human labels for agent enums: the single source for tables, forms and the test console. */

export const AGENT_ROLE_LABELS: Readonly<Record<AgentRole, string>> = {
  retail_sales: "Retail sales",
  wholesale_sales: "Wholesale sales",
  customer_support: "Customer support",
  order_management: "Order management",
  voice_sales: "Voice sales",
};

/** `{ value, label }` lists for select controls, in schema order. */
export const AGENT_ROLE_OPTIONS = AGENT_ROLES.map((value) => ({
  value,
  label: AGENT_ROLE_LABELS[value],
}));

export const AGENT_LANGUAGE_LABELS: Readonly<Record<AgentLanguage, string>> = {
  bn: "Bangla",
  en: "English",
  banglish: "Banglish",
};

export const AGENT_LANGUAGE_OPTIONS = AGENT_LANGUAGES.map((value) => ({
  value,
  label: AGENT_LANGUAGE_LABELS[value],
}));

export const TOOL_LABELS: Readonly<Record<ToolName, { name: string; description: string }>> = {
  search_products: {
    name: "Search products",
    description: "Finds products in the catalog by name, SKU, category or specification.",
  },
  get_product_details: {
    name: "Product details",
    description: "Reads a product's description, variants, specifications and FAQs.",
  },
  get_price: {
    name: "Get price",
    description: "Looks up the retail or wholesale price, including any sale price.",
  },
  check_stock: {
    name: "Check stock",
    description: "Checks whether a product or variant is in stock.",
  },
  calculate_order_total: {
    name: "Calculate order total",
    description: "Works out line totals and the subtotal for a list of items.",
  },
  lookup_customer: {
    name: "Look up customer",
    description: "Checks whether a customer with a phone number already exists.",
  },
  save_customer_info: {
    name: "Save customer info",
    description: "Creates or updates a customer record with the details they share.",
  },
  escalate_to_human: {
    name: "Escalate to human",
    description: "Hands the conversation over to a team member.",
  },
};

/** Use where the human team role could be confused with an AI agent. */
export const HUMAN_AGENT_ROLE_LABEL = "Sales agent (team member)";
