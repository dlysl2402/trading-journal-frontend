/**
 * Boot: sign in if the session has lapsed, read the record, draw the page.
 *
 * The page holds three panels and shows exactly one — the sign-in form, a
 * message, or the journal — so there is never a half-drawn screen behind an
 * error. Every load rebuilds the trades from scratch; nothing is cached,
 * because a cache is the one place a figure could survive a correction to the
 * record beneath it.
 */

import { buildJournal } from './journal.ts'
import { drawPage, must } from './page.ts'
import { AuthError, readFeed, signIn, signOut, storedSession } from './store.ts'

const gate = must('gate')
const status = must('status')
const app = must('app')
const signout = must<HTMLButtonElement>('signout')
const freshness = must('freshness')

const form = must<HTMLFormElement>('signin')
const email = must<HTMLInputElement>('email')
const password = must<HTMLInputElement>('password')
const signinError = must('signin-error')
const signinButton = must<HTMLButtonElement>('signin-button')

/** Exactly one panel at a time. */
function only(panel: HTMLElement): void {
  for (const node of [gate, status, app]) node.hidden = node !== panel
}

function p(className: string, text: string): HTMLParagraphElement {
  const node = document.createElement('p')
  node.className = className
  node.textContent = text
  return node
}

/** How long ago the import last wrote the account row. */
function ago(at: Date): string {
  const minutes = Math.round((Date.now() - at.getTime()) / 60_000)
  if (minutes < 1) return 'record written just now'
  if (minutes < 60) return `record written ${minutes} min ago`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `record written ${hours} h ago` : `record written ${Math.round(hours / 24)} d ago`
}

function askToSignIn(reason?: string): void {
  signout.hidden = true
  freshness.textContent = ''
  signinError.textContent = reason ?? ''
  signinError.hidden = reason === undefined
  only(gate)
  email.focus()
}

/**
 * The import writes deals, then orders, then the account row, so a page that
 * reads in the middle of that can see more deals than the balance accounts
 * for. `buildJournal` refuses to build on figures that do not add up, which is
 * the right answer — a reload a moment later is the fix, and an error that
 * keeps coming back means the record and the broker have genuinely diverged.
 */
function failed(error: unknown): void {
  const reload = document.createElement('button')
  reload.textContent = 'Reload'
  reload.addEventListener('click', () => location.reload())

  status.replaceChildren(
    p('error', error instanceof Error ? error.message : String(error)),
    p('hint',
      'If the import was writing to the record as this page read it, the two ' +
      'disagree for a moment and reloading settles it. If it keeps happening, ' +
      'the backend\'s log is where the reason will be.'),
    reload)
  only(status)
}

async function load(): Promise<void> {
  const session = storedSession()
  if (session === null) { askToSignIn(); return }

  status.replaceChildren(p('', 'Reading the record…'))
  only(status)

  try {
    const feed = await readFeed(session)
    const journal = buildJournal(feed)

    only(app)
    signout.hidden = false
    freshness.textContent = ago(feed.fetchedAt)
    drawPage(journal)
  } catch (error) {
    if (error instanceof AuthError) askToSignIn(error.message)
    else failed(error)
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault()
  signinButton.disabled = true
  signinError.hidden = true
  void signIn(email.value, password.value)
    .then(() => {
      password.value = ''
      return load()
    })
    .catch((error: unknown) => {
      signinError.textContent = error instanceof Error ? error.message : String(error)
      signinError.hidden = false
      only(gate)
    })
    .finally(() => { signinButton.disabled = false })
})

signout.addEventListener('click', () => {
  signOut()
  location.reload()
})

void load()
