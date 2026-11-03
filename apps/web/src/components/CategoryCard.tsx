import { Link } from 'react-router-dom'
import { Pill, Row, Stack, Txt } from './souk'
import { VaultArt } from './VaultArt'

// The one category card. The homepage files work by job and the vault files it
// by rail, so the destination and the note differ, but the shape is the same.

export function CategoryCard({
  category,
  title,
  note,
  measure,
  cta,
  to,
  size,
}: {
  category: string
  title: string
  note: string
  measure: string | null
  cta: string
  to: string
  size?: 'sm' | 'md'
}) {
  return (
    <Link to={to} className="block h-full">
      <Stack surface pad={[18, 20, 18, 20]} gap={9} className="h-full transition hover:border-souk-sky">
        <VaultArt category={category} size={size} />
        <Row justify="between" align="center" gap={8}>
          <Txt size={20} lead={26} weight="bold" tone="ink">
            {title}
          </Txt>
          <Pill variant={measure && measure !== 'none' ? 'keep' : 'off'}>{measure ?? 'reading'}</Pill>
        </Row>
        <Txt size={12} lead={18} tone="slate">
          {note}
        </Txt>
        <Txt size={10} lead={14} mono upper tone="data">
          {cta}
        </Txt>
      </Stack>
    </Link>
  )
}
