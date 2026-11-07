export function AuthCardHeader({ title, description }: { title: string; description: string }) {
  return (
    <header className="mb-6 space-y-1.5">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">{description}</p>
    </header>
  );
}

export function OrDivider() {
  return (
    <div
      className="my-5 flex items-center gap-3 text-xs text-muted-foreground"
      role="separator"
      aria-label="or"
    >
      <span className="h-px flex-1 bg-border" />
      or
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
