import { Link } from 'react-router-dom'
import { NoteBox, Row, SectionHead, Stack, Txt } from '../components/souk'

// Multifactor is off, and it stays off until there is a sign-in service that can
// verify a code or a passkey. A switch that flips without an enrolment behind it
// would claim protection the account does not have.
export function SettingsSecurityPage() {
  return (
    <Stack gap={20} className="mx-auto max-w-[760px] pt-8">
      <Link
        to="/settings"
        className="text-[12px] font-semibold text-souk-muted transition-colors hover:text-souk-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data"
      >
        Back to settings
      </Link>
      <SectionHead title="Security" note="MULTIFACTOR" />

      <NoteBox
        title="Off, and not enforced yet"
        copy="Agent Souk signs with the wallet itself. A second factor needs a sign-in service to enrol and verify it, so these controls are shown off until that service is connected. Nothing here is pretending to protect the account."
      />

      <Stack surface radius={16} className="overflow-hidden">
        <FactorRow
          title="Authenticator app"
          copy="A six-digit code from an app such as 1Password or Authy."
        />
        <FactorRow
          title="Passkey"
          copy="Sign in with your device's biometrics."
          last
        />
      </Stack>
    </Stack>
  )
}

function FactorRow({
  title,
  copy,
  last,
}: {
  title: string
  copy: string
  last?: boolean
}) {
  return (
    <Row
      justify="between"
      align="center"
      gap={16}
      className={`min-h-[72px] px-5 py-3 ${last ? '' : 'border-b border-souk-hair'}`}
    >
      <Stack gap={2}>
        <Txt size={13} lead={20} weight="semibold" tone="ink">
          {title}
        </Txt>
        <Txt size={11} lead={16} tone="muted">
          {copy}
        </Txt>
      </Stack>
      <Row align="center" gap={8} className="shrink-0">
        <Txt size={10} lead={14} weight="bold" upper tone="muted">
          Off
        </Txt>
        <span
          role="switch"
          aria-checked="false"
          aria-disabled="true"
          aria-label={`${title}, off, not available yet`}
          title="Not available yet"
          className="relative inline-flex h-[24px] w-[42px] cursor-not-allowed items-center rounded-full border border-souk-hair bg-souk-surface2 px-[3px] opacity-60"
        >
          <span className="h-[16px] w-[16px] rounded-full bg-souk-muted" />
        </span>
      </Row>
    </Row>
  )
}
