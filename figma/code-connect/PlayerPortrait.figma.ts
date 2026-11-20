// url=https://www.figma.com/design/LiJeBBMcrA9KR75fgffW4L/Mnemba-Tips?node-id=19-666
// source=components/entity-portrait.tsx
// component=EntityPortrait
import figma from 'figma'
const instance = figma.selectedInstance

// Source (Image slot / Unavailable) is resolved at runtime; without a permitted photo the
// component renders a neutral silhouette with "Photo unavailable".
const compact = instance.getEnum('Size', {
  'S 48': true,
  'M 72': false,
  'L 120': false,
})

export default {
  example: figma.code`<EntityPortrait id={player.id} name={player.name}${compact ? ' compact' : ''} />`,
  imports: ['import EntityPortrait from "@/components/entity-portrait"'],
  id: 'player-portrait',
  metadata: { nestable: true },
}
