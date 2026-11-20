// url=https://www.figma.com/design/LiJeBBMcrA9KR75fgffW4L/Mnemba-Tips?node-id=19-725
// source=components/mt-ui.tsx
// component=SourceTag
import figma from 'figma'
const instance = figma.selectedInstance

const kind = instance.getEnum('Type', {
  'Confirmed fact': 'confirmed',
  'Model estimate': 'estimate',
  'Exploratory': 'exploratory',
  'Unavailable': 'unavailable',
})

export default {
  example: figma.code`<SourceTag kind="${kind}" />`,
  imports: ['import { SourceTag } from "@/components/mt-ui"'],
  id: 'source-tag',
  metadata: { nestable: true },
}
