# Brand design source

`typography-logo/` is the design source (a generated design-canvas document and its runtime) for the SalesPilot AI typography logo implemented in `src/components/shared/logo.tsx`. It is kept here for reference only and is intentionally not served: it lives outside `public/` because its generated runtime uses `new Function` and an any-origin `message` listener, which must never be deployed. The shipped logo is pure CSS and typography, so nothing in this folder is needed at runtime.
