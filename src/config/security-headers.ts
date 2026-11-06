export type SecurityHeader = { key: string; value: string };

/**
 * Build the Content-Security-Policy value from a directive map.
 * A `true` value renders a valueless directive (e.g. upgrade-insecure-requests).
 */
function buildCsp(directives: Record<string, string[] | true>): string {
  return Object.entries(directives)
    .map(([name, values]) => (values === true ? name : `${name} ${values.join(" ")}`))
    .join("; ");
}

/**
 * Static HTTP security headers applied to every route via `headers()` in next.config.ts.
 *
 * Trade-off: `script-src` allows `'unsafe-inline'` in production because Next.js emits
 * inline bootstrap/hydration scripts. A nonce-based CSP (see the Next.js CSP guide) would
 * remove that, but nonces are generated per request, which forces every page into dynamic
 * rendering and defeats static/cached rendering. We accept the weaker script policy here and
 * compensate with strict `object-src`, `base-uri`, `form-action`, `frame-ancestors` and
 * host-allowlisted network/image sources. Revisit if a nonce/proxy approach becomes affordable.
 */
export function securityHeaders(isDev: boolean): SecurityHeader[] {
  const connectSrc = [
    "'self'",
    "https://identitytoolkit.googleapis.com",
    "https://securetoken.googleapis.com",
    "https://www.googleapis.com",
    "https://firestore.googleapis.com",
    "https://api.cloudinary.com",
    "https://res.cloudinary.com",
  ];
  if (isDev) {
    // Firebase emulators and Next.js HMR websocket.
    connectSrc.push(
      "http://127.0.0.1:*",
      "http://localhost:*",
      "ws://localhost:*",
      "ws://127.0.0.1:*",
    );
  }

  const csp = buildCsp({
    "default-src": ["'self'"],
    // React uses eval in dev for enhanced debugging; production needs no eval.
    // apis.google.com: @firebase/auth loads https://apis.google.com/js/api.js (gapi) for
    // signInWithPopup/signInWithRedirect.
    "script-src": [
      "'self'",
      "'unsafe-inline'",
      "https://apis.google.com",
      ...(isDev ? ["'unsafe-eval'"] : []),
    ],
    "style-src": ["'self'", "'unsafe-inline'"],
    // lh3.googleusercontent.com: Google account profile photos.
    "img-src": [
      "'self'",
      "data:",
      "blob:",
      "https://res.cloudinary.com",
      "https://lh3.googleusercontent.com",
    ],
    "font-src": ["'self'", "data:"],
    "connect-src": connectSrc,
    // Firebase Auth popup/iframe handlers.
    "frame-src": ["https://*.firebaseapp.com", "https://accounts.google.com"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    ...(isDev ? {} : { "upgrade-insecure-requests": true as const }),
  });

  const headers: SecurityHeader[] = [
    { key: "Content-Security-Policy", value: csp },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
    // Firebase Google sign-in uses a popup; same-origin would sever window.opener.
    { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
    { key: "X-DNS-Prefetch-Control", value: "off" },
  ];

  if (!isDev) {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload",
    });
  }

  return headers;
}
