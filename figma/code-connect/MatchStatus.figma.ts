// url=https://www.figma.com/design/LiJeBBMcrA9KR75fgffW4L/Mnemba-Tips?node-id=19-763
// source=components/mt-ui.tsx
// component=StatusTag
import figma from 'figma'
const instance = figma.selectedInstance

const kind = instance.getEnum('Status', {
  'Scheduled': 'scheduled',
  'Time not confirmed': 'unconfirmed',
  'Live': 'live',
  'Half-time': 'halftime',
  'Finished': 'finished',
  'Postponed': 'postponed',
  'Abandoned': 'abandoned',
})

export default {
  example: figma.code`<StatusTag kind="${kind}" />`,
  imports: ['import { StatusTag } from "@/components/mt-ui"'],
  id: 'status-tag',
  metadata: { nestable: true },
}
