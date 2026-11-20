// url=https://www.figma.com/design/LiJeBBMcrA9KR75fgffW4L/Mnemba-Tips?node-id=15-110
// source=app/mnemba.css (.mt-btn)
// component=mt-btn
import figma from 'figma'
const instance = figma.selectedInstance

// Buttons are styled <a>/<button> elements; there is no wrapper component.
const label = instance.getString('Label')
const className = instance.getEnum('Style', {
  'Primary': 'mt-btn mt-btn-primary',
  'Secondary': 'mt-btn',
  'Quiet': 'mt-btn mt-btn-quiet',
})
const state = instance.getEnum('State', {
  'Default': '',
  'Hover': '',
  'Focus': '',
  'Pressed': '',
  'Disabled': 'disabled',
  'Loading': 'loading',
})
const showIcon = instance.getBoolean('Show trailing icon')
const icon = showIcon ? instance.getInstanceSwap('Trailing icon') : null
let iconCode
if (icon && icon.type === 'INSTANCE') {
  iconCode = icon.executeTemplate().example
}

export default {
  example: figma.code`<button type="button" className="${className}"${state === 'disabled' ? ' disabled' : ''}${state === 'loading' ? ' aria-busy="true" disabled' : ''}>${label}${iconCode ? figma.code`${iconCode}` : ''}</button>`,
  id: 'mt-button',
  metadata: { nestable: true },
}
