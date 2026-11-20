// url=https://www.figma.com/design/LiJeBBMcrA9KR75fgffW4L/Mnemba-Tips?node-id=23-1180
// source=components/fixture-row.tsx
// component=FixtureRow
import figma from 'figma'

// The State variant (Upcoming / Time not confirmed / Live / Finished) is derived at runtime
// from fixture.status and kickoffPrecision via matchStatusKind(). Team names, badges and scores
// always come from the fixture record, never from the design.
export default {
  example: figma.code`<FixtureRow f={fixture} />`,
  imports: ['import { FixtureRow } from "@/components/fixture-row"'],
  id: 'fixture-row',
  metadata: { nestable: true },
}
