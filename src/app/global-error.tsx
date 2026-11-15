"use client"; // Error boundaries must be Client Components

import { errorDigest } from "@/components/shared/route-error";

/**
 * Last-resort boundary that replaces the root layout, so it brings its own <html>/<body>, uses no
 * providers, fonts or Tailwind (global styles are not applied here) and follows the OS colour scheme.
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = errorDigest(error);
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
          fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          colorScheme: "light dark",
        }}
      >
        <main role="alert" style={{ maxWidth: 420, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 8px" }}>
            Something went wrong loading this page
          </h1>
          <p style={{ margin: "0 0 8px", opacity: 0.7, fontSize: 14 }}>
            This is usually temporary. Try again, or head back to your dashboard.
          </p>
          {digest ? (
            <p style={{ margin: "0 0 8px", opacity: 0.7, fontSize: 12 }}>Reference: {digest}</p>
          ) : null}
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 16 }}>
            <button
              type="button"
              onClick={() => retry()}
              style={{ padding: "8px 14px", fontSize: 14, cursor: "pointer" }}
            >
              Retry
            </button>
            {/* A plain anchor: the router (and its providers) may be what failed. */}
            <a href="/dashboard" style={{ padding: "8px 14px", fontSize: 14 }}>
              Go to dashboard
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
