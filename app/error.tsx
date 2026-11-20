'use client';
import BrandLogo from '@/components/brand-logo';

// Route-level error boundary. The error message is deliberately not rendered (it may contain internals);
// the digest lets the server log be matched without exposing details.
export default function RouteError({error, reset}: {error: Error & {digest?: string}; reset: () => void}) {
  return <main className="intel mt-status-page">
    <section className="mt-status-card" role="alert" aria-labelledby="mt-status-title">
      <a href="/football" aria-label="Mnemba Tips home" className="mt-status-logo"><BrandLogo sizes="240px" priority/></a>
      <h1 id="mt-status-title">This page could not load</h1>
      <p>Something went wrong while loading this page. Try again, or return to the home page.</p>
      {error.digest && <p className="mt-status-ref">Reference {error.digest}</p>}
      <div className="mt-status-actions"><button type="button" className="mt-status-primary" onClick={reset}>Try again</button><a href="/football">Go to Mnemba Tips</a></div>
    </section>
  </main>;
}
