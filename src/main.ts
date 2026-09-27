/**
 * Boot: sign in if the session has lapsed, read the record, draw the page.
 *
 * The page holds three panels and shows exactly one — the sign-in form, a
 * message, or the journal — so there is never a half-drawn screen behind an
 * error. Every load rebuilds the trades from scratch; nothing is cached,
 * because a cache is the one place a figure could survive a correction to the
 * record beneath it.
 *
 * The margin is the exception, and the only thing read here that is not
 * derived: your notes, grades and tags, and the vocabulary the tags come from,
 * are not a function of the broker's rows, so they are read from the record
 * as they were written.
 */

import { h, must } from './dom.ts'
import { icon } from './icons.ts'
import { buildJournal } from './journal.ts'
import { openMargin } from './margin.ts'
import { drawPage } from './page.ts'
import { AuthError, readAnnotations, readRecord, readTags, signIn, signOut, storedSession } from './store.ts'
import { openVocabulary } from './tags.ts'
import { enableTips } from './tips.ts'

/**
 * The day the journal begins, on the broker's clock. The risk manager went
 * live on 16 September 2026, and every trade since was sized by it and
 * carries its stop and target on the entry order, so what it risked is a
 * fact. The trades before it were sized by hand with no stop on record at
 * entry, so nothing about their risk can be said: they stay on the record and
 * off the page. Move this date and they come back.
 */
const JOURNAL_BEGINS = new Date('2026-09-16T00:00:00.000Z')

/** The import writes every fifteen minutes; a record much older than that means it has stopped. */
const STALE = 60 * 60_000

const gate = must('gate')
const status = must('status')
const app = must('app')
const signout = must<HTMLButtonElement>('signout')
const tagsButton = must<HTMLButtonElement>('tags-button')
const freshness = must('freshness')
const account = must('sub')

const form = must<HTMLFormElement>('signin')
const email = must<HTMLInputElement>('email')
const password = must<HTMLInputElement>('password')
const signinError = must('signin-error')
const signinButton = must<HTMLButtonElement>('signin-button')

/** Exactly one panel at a time. */
function only(panel: HTMLElement): void {
  for (const node of [gate, status, app]) node.hidden = node !== panel
}

/** How long ago the import last wrote the account row. */
function ago(at: Date): string {
  const minutes = Math.round((Date.now() - at.getTime()) / 60_000)
  if (minutes < 1) return 'Synced just now'
  if (minutes < 60) return `Synced ${minutes} min ago`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `Synced ${hours} h ago` : `Synced ${Math.round(hours / 24)} days ago`
}

function askToSignIn(reason?: string): void {
  signout.hidden = tagsButton.hidden = account.hidden = freshness.hidden = true
  signinError.replaceChildren()
  if (reason !== undefined) signinError.append(icon('alert'), h('span', '', reason))
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
  const reload = h('button', 'btn primary') as HTMLButtonElement
  reload.type = 'button'
  reload.append(icon('refresh'), 'Try again')
  reload.addEventListener('click', () => location.reload())

  const card = h('div', 'card status-card')
  const mark = h('div', 'status-icon')
  mark.append(icon('alert'))
  card.append(mark,
    h('h2', '', 'Your journal didn’t load'),
    h('p', 'status-hint', 'The import was probably mid-write. Try again in a moment; if it keeps happening, the backend’s log will say why.'),
    h('p', 'status-error', error instanceof Error ? error.message : String(error)),
    reload)
  status.replaceChildren(card)
  only(status)
}

async function load(): Promise<void> {
  const session = storedSession()
  if (session === null) { askToSignIn(); return }

  const waiting = h('div', 'loading')
  waiting.append(h('div', 'spinner'), h('p', '', 'Loading your trades…'))
  status.replaceChildren(waiting)
  only(status)

  try {
    const { accountId, feed } = await readRecord(session)
    const journal = buildJournal(feed, JOURNAL_BEGINS)
    // After the feed, because the account id that keys the margin comes from
    // it — and only the account the record was actually read for.
    const [annotations, tags] = await Promise.all([readAnnotations(accountId), readTags()])
    const margin = openMargin(accountId, annotations)

    only(app)
    signout.hidden = tagsButton.hidden = freshness.hidden = false
    signout.dataset.tip = session.email ? 'Signed in as ' + session.email : 'Sign out'
    freshness.textContent = ago(feed.fetchedAt)
    freshness.classList.toggle('stale', Date.now() - feed.fetchedAt.getTime() > STALE)
    freshness.dataset.tip = 'When the import last wrote to the record: ' +
      feed.fetchedAt.toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    drawPage(journal, margin, openVocabulary(tags))
  } catch (error) {
    if (error instanceof AuthError) askToSignIn(error.message)
    else failed(error)
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault()
  signinButton.disabled = true
  signinButton.textContent = 'Signing in…'
  signinError.hidden = true
  void signIn(email.value, password.value)
    .then(() => {
      password.value = ''
      return load()
    })
    .catch((error: unknown) => {
      signinError.replaceChildren(icon('alert'), h('span', '', error instanceof Error ? error.message : String(error)))
      signinError.hidden = false
      only(gate)
    })
    .finally(() => {
      signinButton.disabled = false
      signinButton.textContent = 'Sign in'
    })
})

signout.addEventListener('click', () => {
  signOut()
  location.reload()
})

// The buttons in the page's own markup take their icons here, so every icon
// is drawn from the one set in `icons.ts`.
tagsButton.prepend(icon('tag'))
signout.prepend(icon('log-out'))
must('tags-close').append(icon('x'))

enableTips()
void load()
