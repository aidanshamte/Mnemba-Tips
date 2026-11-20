// url=https://www.figma.com/design/LiJeBBMcrA9KR75fgffW4L/Mnemba-Tips?node-id=25-1515
// source=components/mt-ui.tsx
// component=Notice
import figma from 'figma'
const instance = figma.selectedInstance

const kind = instance.getEnum('Type', {
  'Stale data': 'stale',
  'Missing data': 'missing',
  'Offline': 'offline',
  'Error': 'error',
})
const message = instance.findText('Message')

export default {
  example: figma.code`<Notice kind="${kind}">${message.type === 'TEXT' ? message.textContent : ''}</Notice>`,
  imports: ['import { Notice } from "@/components/mt-ui"'],
  id: 'notice',
  metadata: { nestable: false },
}
