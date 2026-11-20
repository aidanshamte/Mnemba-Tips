// url=https://www.figma.com/design/LiJeBBMcrA9KR75fgffW4L/Mnemba-Tips?node-id=19-836
// source=components/mt-ui.tsx
// component=Uncertainty
import figma from 'figma'
const instance = figma.selectedInstance

const level = instance.getEnum('Level', {
  'Lower': 'lower',
  'Moderate': 'moderate',
  'Higher': 'higher',
  'Unknown': 'unknown',
})

export default {
  example: figma.code`<Uncertainty level="${level}" />`,
  imports: ['import { Uncertainty } from "@/components/mt-ui"'],
  id: 'uncertainty',
  metadata: { nestable: true },
}
