// url=https://www.figma.com/design/LiJeBBMcrA9KR75fgffW4L/Mnemba-Tips?node-id=18-406
// source=components/site-nav.tsx
// component=SiteNav
import figma from 'figma'

// One SiteNav renders the desktop rail (>=1280px), the tablet top bar and the mobile bottom navigation.
// The active item is derived from the URL unless `active` is passed.
export default {
  example: figma.code`<SiteNav />`,
  imports: ['import SiteNav from "@/components/site-nav"'],
  id: 'site-nav-desktop',
  metadata: { nestable: false },
}
