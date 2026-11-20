// url=https://www.figma.com/design/LiJeBBMcrA9KR75fgffW4L/Mnemba-Tips?node-id=18-838
// source=components/site-nav.tsx
// component=SiteNav
import figma from 'figma'
const instance = figma.selectedInstance

// "More" opens the menu sheet; it is not a route, so no `active` key is passed.
const active = instance.getEnum('Active', {
  'Home': 'home',
  'Fixtures': 'fixtures',
  'Search': 'search',
  'News': 'news',
  'More': '',
})

export default {
  example: figma.code`<SiteNav${active ? figma.code` active="${active}"` : ''} />`,
  imports: ['import SiteNav from "@/components/site-nav"'],
  id: 'site-nav-mobile',
  metadata: { nestable: false },
}
