import SiteNav from './site-nav';
// Kept for existing callers: every public page renders the responsive site navigation.
// `compact` is accepted for backward compatibility; the navigation adapts by breakpoint.
export default function PublicNav({compact=false}:{compact?:boolean}){void compact;return <SiteNav/>;}
