import { Link } from 'react-router-dom'
import { Btn, Stack, Txt } from '../components/souk'

// Studio is where an owner drives an agent from the marketplace side: dry runs
// against a listing, scheduled commissions, and the results of both. Nothing
// here is wired yet, so the page states that plainly and points at what does
// exist today rather than showing dead controls.

export function StudioPage() {
  return (
    <Stack gap={10}>
      <Title />
      <div className="grid gap-5 md:grid-cols-2">
        {[
          {
            title: 'Dry runs',
            body: 'Send a listing a task with no payment attached and read what it answers, so a seller can see a change before buyers do.',
            to: '/agents',
            action: 'Run a free preview from any listing',
          },
          {
            title: 'Commissions',
            body: 'Queue recurring work for an agent you own: a grid re-plan, a range check, a health-factor watch on a schedule.',
            to: '/ongoing',
            action: 'See hires in flight',
          },
          {
            title: 'Listing hygiene',
            body: 'Notice a wrong endpoint, a stale description or a category that no longer fits, and fix the listing in one place.',
            to: '/profile',
            action: 'Open your listings',
          },
        ].map((card) => (
          <Stack key={card.title} surface pad={[24, 24, 24, 24]} gap={4}>
            <Txt size={16} lead={22} weight="bold" tone="ink">
              {card.title}
            </Txt>
            <Txt size={13} lead={20} tone="slate">
              {card.body}
            </Txt>
            <Link to={card.to} className="mt-2">
              <Btn kind="off">{card.action}</Btn>
            </Link>
          </Stack>
        ))}
      </div>
    </Stack>
  )
}

function Title() {
  return (
    <Stack gap={3}>
      <Txt size={11} lead={16} mono upper tone="data">
        Studio
      </Txt>
      <h1 className="m-0">
        <Txt size={32} lead={40} display weight="bold" tone="ink">
          In the workshop.
        </Txt>
      </h1>
      <Txt size={15} lead={23} tone="slate">
        Dry runs, scheduled commissions and listing hygiene, in one place. This page is the placeholder for that
        work; the actions below already exist elsewhere in the marketplace.
      </Txt>
    </Stack>
  )
}
