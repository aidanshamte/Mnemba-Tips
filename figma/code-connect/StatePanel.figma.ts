// url=https://www.figma.com/design/LiJeBBMcrA9KR75fgffW4L/Mnemba-Tips?node-id=25-1481
// source=components/mt-ui.tsx
// component=StatePanel
import figma from 'figma'
const instance = figma.selectedInstance

const kind = instance.getEnum('Type', {
  'Empty': 'empty',
  'Missing data': 'missing',
  'Error': 'error',
  'Offline': 'offline',
  'Tracking starter': 'tracking',
})
const title = instance.findText('Title')
const body = instance.findText('Body')
const button = instance.findInstance('Button')
let actionCode
if (button && button.type === 'INSTANCE') {
  actionCode = button.executeTemplate().example
}

export default {
  example: figma.code`<StatePanel kind="${kind}" title="${title.type === 'TEXT' ? title.textContent : ''}"${actionCode ? figma.code` action={${actionCode}}` : ''}>${body.type === 'TEXT' ? body.textContent : ''}</StatePanel>`,
  imports: ['import { StatePanel } from "@/components/mt-ui"'],
  id: 'state-panel',
  metadata: { nestable: false },
}
