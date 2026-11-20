import type {Metadata} from 'next';
import BrandLogo from '@/components/brand-logo';

export const metadata: Metadata = {title: 'Page not found | Mnemba Tips', robots: {index: false}};

export default function NotFound() {
  return <main className="intel mt-status-page">
    <section className="mt-status-card" aria-labelledby="mt-status-title">
      <a href="/football" aria-label="Mnemba Tips home" className="mt-status-logo"><BrandLogo sizes="240px" priority/></a>
      <h1 id="mt-status-title">Page not found</h1>
      <p>This page does not exist or is no longer available. Fixtures, teams and stories are still a click away.</p>
      <div className="mt-status-actions"><a className="mt-status-primary" href="/football">Go to Mnemba Tips</a><a href="/football/search">Search teams and players</a></div>
    </section>
  </main>;
}
