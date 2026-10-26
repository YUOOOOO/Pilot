/**
 * The sign-in form in Settings → Account: a phone number or e-mail and a
 * password. Register creates the account; sign in is for one that already
 * exists. The host talks to the relay; this only holds the form. Verification
 * codes stay on the relay for later and are not offered here.
 */
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { createElement as h, useState, type FormEvent, type ReactNode } from 'react'
import { useCloudConfig } from './AccountPage.tsx'
import { call, column, errorStyle, muted, row, type CloudStatus, type Translate, failureText } from './api.ts'

export interface SignInProps {
  t: Translate
  onSignedIn(status: CloudStatus): void
  /** Rendered under the form (the relay line, a "later" button…). */
  footer?: ReactNode
  /** The primary button takes the whole row (the welcome dialog). */
  wide?: boolean
}

export function SignIn({ t, onSignedIn, footer, wide = false }: SignInProps): ReactNode {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [invite, setInvite] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)
  const config = useCloudConfig()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError(undefined)
    try {
      await work()
    } catch (err: unknown) {
      setError(failureText(t, err))
    } finally {
      setBusy(false)
    }
  }

  const login = (event: FormEvent) => {
    event.preventDefault()
    void run(async () => {
      const status = await call<CloudStatus>('login', { identifier: identifier.trim(), password })
      setPassword('')
      onSignedIn(status)
    })
  }

  const register = () => {
    void run(async () => {
      const status = await call<CloudStatus>('register', { identifier: identifier.trim(), password, invite: invite.trim().toUpperCase() })
      setPassword('')
      onSignedIn(status)
    })
  }

  const ready = identifier.trim().length >= 3 && password.length > 0
  const primary = { variant: 'primary' as const, size: 'md' as const, type: 'submit' as const, style: wide ? { width: '100%' } : undefined }

  return h('form', { style: column, onSubmit: login },
    h(Input, { value: identifier, onChange: (e: FormEvent<HTMLInputElement>) => setIdentifier(e.currentTarget.value), placeholder: t('identifier'), autoComplete: 'username', 'aria-label': t('identifier') }),
    h(Input, { value: password, type: 'password', onChange: (e: FormEvent<HTMLInputElement>) => setPassword(e.currentTarget.value), placeholder: t('obPassword'), autoComplete: 'current-password', 'aria-label': t('obPassword') }),
    h('div', { style: muted }, t('identifierHint')),
    inviteOpen
      ? h('div', { style: column },
          h(Input, { value: invite, onChange: (e: FormEvent<HTMLInputElement>) => setInvite(e.currentTarget.value.replace(/[^0-9a-zA-Z-]/g, '').slice(0, 16)), placeholder: t('obInviteCode'), autoComplete: 'off', autoCapitalize: 'characters', 'aria-label': t('obInviteCode') }),
          h('div', { style: muted }, t('obInviteHint', { bonus: config.invitee_bonus_cny ?? 5 })))
      : h('div', null, h('button', { type: 'button', className: 'nm-ob-link nm-inline', disabled: busy, onClick: () => setInviteOpen(true) }, t('obHaveInvite'))),
    error ? h('div', { style: errorStyle, role: 'alert' }, error) : null,
    h('div', { style: row },
      h(Button, { ...primary, disabled: busy || !ready }, busy ? t('signingIn') : t('signIn')),
      h(Button, { variant: 'ghost', size: 'md', type: 'button', disabled: busy || !ready, onClick: register }, busy ? t('obRegistering') : t('obRegister'))),
    footer)
}
