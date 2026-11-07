import { Brand } from "@/components/shared/logo";

export { Brand };

const POINTS = [
  "Every customer conversation in one inbox",
  "Inventory and orders that stay in sync",
  "AI agents that handle the routine work",
];

/** Two-column auth layout: form on the left, a restrained brand panel on the right (hidden below lg). */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-svh flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <main className="flex flex-col items-center justify-center gap-8 px-5 py-10 sm:px-8">
        <Brand className="lg:hidden" />
        <div className="w-full max-w-sm">{children}</div>
      </main>
      <aside
        aria-label="About SalesPilot AI"
        className="relative hidden flex-col justify-between overflow-hidden border-l bg-muted/40 p-12 lg:flex"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] bg-size-[48px_48px] opacity-60 mask-[radial-gradient(ellipse_at_center,black,transparent_75%)]"
        />
        <Brand className="relative" />
        <div className="relative max-w-md space-y-6">
          <p className="text-3xl font-semibold tracking-tight text-balance">
            Run sales, support and stock from one calm workspace.
          </p>
          <ul className="space-y-3 text-sm text-muted-foreground">
            {POINTS.map((point) => (
              <li key={point} className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="mt-2 size-1.5 shrink-0 rounded-full bg-foreground/40"
                />
                {point}
              </li>
            ))}
          </ul>
        </div>
        <span aria-hidden="true" />
      </aside>
    </div>
  );
}
