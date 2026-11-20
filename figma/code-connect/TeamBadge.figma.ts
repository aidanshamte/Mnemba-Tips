// url=https://www.figma.com/design/LiJeBBMcrA9KR75fgffW4L/Mnemba-Tips?node-id=19-628
// source=components/football-identity.tsx
// component=IdentityBadge
import figma from 'figma'
const instance = figma.selectedInstance

// Source (Image slot / Unavailable) is resolved at runtime from permitted media;
// when no permitted badge exists the component renders a neutral shield outline.
const variant = instance.getEnum('Size', {
  'XS 24': 'tiny',
  'S 32': 'small',
  'M 48': 'medium',
  'L 72': 'large',
  'XL 112': 'hero',
})

export default {
  example: figma.code`<IdentityBadge id={team.id} name={team.name} variant="${variant}" />`,
  imports: ['import { IdentityBadge } from "@/components/football-identity"'],
  id: 'team-badge',
  metadata: { nestable: true },
}
