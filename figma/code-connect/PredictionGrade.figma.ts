// url=https://www.figma.com/design/LiJeBBMcrA9KR75fgffW4L/Mnemba-Tips?node-id=25-1615
// source=components/mt-ui.tsx
// component=GradeBadge
import figma from 'figma'
const instance = figma.selectedInstance

const kind = instance.getEnum('Status', {
  'Correct': 'correct',
  'Incorrect': 'incorrect',
  'Pending': 'pending',
  'Void': 'void',
  'Exploratory': 'exploratory',
})

export default {
  example: figma.code`<GradeBadge kind="${kind}" />`,
  imports: ['import { GradeBadge } from "@/components/mt-ui"'],
  id: 'grade-badge',
  metadata: { nestable: true },
}
