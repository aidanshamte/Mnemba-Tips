// url=https://www.figma.com/design/LiJeBBMcrA9KR75fgffW4L/Mnemba-Tips?node-id=15-205
// source=components/intelligence-workspace.tsx (.mt-search-entry)
// component=mt-search-entry
import figma from 'figma'
const instance = figma.selectedInstance

// The search entry links to /football/search; the full search input lives in components/global-search.tsx.
const value = instance.getString('Value')
const disabled = instance.getEnum('State', {
  'Default': false,
  'Hover': false,
  'Focus': false,
  'Filled': false,
  'Disabled': true,
})

export default {
  example: figma.code`<a className="mt-search-entry" href="/football/search"${disabled ? ' aria-disabled="true"' : ''}><Search aria-hidden="true" size={20} /><span>${value}</span></a>`,
  imports: ['import { Search } from "lucide-react"'],
  id: 'mt-search-entry',
  metadata: { nestable: true },
}
