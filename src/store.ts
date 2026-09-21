/**
 * The smallest Supabase client that can read the record and sign a person in.
 *
 * Three REST calls: one to exchange a password for a session, one to refresh
 * that session, and one to walk a table. No SDK, for the same reason the
 * backend has none — the parts of it this page would use are a wrapper around
 * `fetch` and the rest is subscriptions it does not open.
 *
 * Reading is deliberately dumb: every deal and every order, every load, and
 * the trades built from scratch in the browser. A few thousand rows is a few
 * hundred kilobytes, and it is what lets the page hold no state of its own and
 * so never disagree with the record.
 */

import type { RawAccount, RawAnnotation, RawDeal, RawFeed, RawOrder } from './rows.ts'

const SUPABASE_URL = 'https://tmjpauncsmnepzwjucvk.supabase.co'

/**
 * Project Settings → API keys → publishable (`sb_publishable_…`, or the legacy
 * anon JWT). Committed on purpose: it identifies the project, not a person,
 * and the row-level security policies in the backend's `supabase/schema.sql`
 * decide what it can reach. The project's *secret* key bypasses those policies
 * and must never appear in this repository.
 */
const SUPABASE_PUBLISHABLE_KEY: string = 'sb_publishable_GDtBJp0-lv5dJkrE6An1oQ_Q-eTIbVJ'

/** PostgREST caps a response at 1000 rows by default, so reads are walked. */
const PAGE = 1000

/** Refresh this long before expiry, so a slow load cannot straddle it. */
const EARLY = 60_000

const STORAGE_KEY = 'journal.session'

export interface Session {
  email: string
  accessToken: string
  refreshToken: string
  /** Epoch milliseconds. */
  expiresAt: number
}

export class AuthError extends Error {}

interface TokenReply {
  access_token: string
  refresh_token: string
  expires_in: number
  user: { email?: string }
}

function configured(): void {
  if (SUPABASE_PUBLISHABLE_KEY === '') {
    throw new Error('set SUPABASE_PUBLISHABLE_KEY in src/store.ts — see the README')
  }
}

async function token(body: unknown, grant: 'password' | 'refresh_token'): Promise<Session> {
  configured()
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=${grant}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    // The body names the cause; 400 covers a wrong password and a stale
    // refresh token alike, and they want different words on the screen.
    const text = (await response.text()).slice(0, 300)
    throw new AuthError(
      response.status === 400 || response.status === 401
        ? 'That email and password were not accepted.'
        : `Supabase ${response.status} signing in: ${text}`)
  }
  const reply = await response.json() as TokenReply
  return {
    email: reply.user.email ?? '',
    accessToken: reply.access_token,
    refreshToken: reply.refresh_token,
    expiresAt: Date.now() + reply.expires_in * 1000,
  }
}

function remember(session: Session): Session {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  return session
}

export async function signIn(email: string, password: string): Promise<Session> {
  return remember(await token({ email, password }, 'password'))
}

export function signOut(): void {
  localStorage.removeItem(STORAGE_KEY)
}

/** The stored session, or null. Not checked for freshness — `authorise` does that. */
export function storedSession(): Session | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw === null) return null
  try {
    const session = JSON.parse(raw) as Session
    return typeof session?.accessToken === 'string' ? session : null
  } catch {
    return null
  }
}

/**
 * A session good for the next minute, refreshing the stored one if not. A
 * refresh that fails is a sign-in that has genuinely lapsed, so the stored
 * session is dropped rather than retried.
 */
async function authorise(session: Session): Promise<Session> {
  if (session.expiresAt - EARLY > Date.now()) return session
  try {
    return remember(await token({ refresh_token: session.refreshToken }, 'refresh_token'))
  } catch (error) {
    signOut()
    throw new AuthError(error instanceof AuthError ? 'Your sign-in has expired.' : String(error))
  }
}

/**
 * The stored session, good for the next minute.
 *
 * Read from storage at the moment it is needed rather than passed in, because
 * a refresh mints a new refresh token and retires the one it used. A page left
 * open all morning would otherwise hold the retired one and be signed out the
 * first time it saved a note.
 */
async function live(): Promise<Session> {
  const stored = storedSession()
  if (stored === null) throw new AuthError('Your sign-in has expired.')
  return authorise(stored)
}

/**
 * Every row matching a PostgREST filter. The response says how many rows exist
 * in total, and that — not a short page — is the signal to stop, so a lowered
 * row cap cannot truncate a read.
 */
async function selectAll<T>(session: Session, table: string, filter: string): Promise<T[]> {
  const rows: T[] = []
  for (;;) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?${filter}&limit=${PAGE}&offset=${rows.length}`
    const response = await fetch(url, {
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${session.accessToken}`,
        Accept: 'application/json',
        Prefer: 'count=exact',
      },
    })
    if (response.status === 401) {
      signOut()
      throw new AuthError('Your sign-in has expired.')
    }
    if (!response.ok) {
      // The body names the policy or the missing table; the status alone
      // cannot tell one from the other.
      throw new Error(`Supabase ${response.status} reading ${table}: ${(await response.text()).slice(0, 300)}`)
    }
    const page = await response.json() as T[]
    rows.push(...page)

    // "0-999/1234", or "*/0" when there is nothing.
    const total = Number(response.headers.get('content-range')?.split('/')[1])
    if (Number.isNaN(total)) throw new Error(`Supabase: no row count reading ${table}`)
    if (rows.length >= total || page.length === 0) return rows
  }
}

interface AccountRow {
  account_id: string
  raw: RawAccount
  fetched_at: string
}

/**
 * The whole record for one account, in the shape one fetch of the feed had.
 *
 * The schema keys every row by account so a second account cannot collide with
 * the first. Nothing on this page chooses between them yet, so the account the
 * import touched most recently is the one shown.
 *
 * The account id comes back alongside the feed rather than inside it. It is
 * MetaApi's id for the account, which is what the margin is keyed by, and it
 * is not part of a fetch of the feed — putting it in `RawFeed` would make that
 * shape a lie about the snapshot the backend writes.
 */
export async function readRecord(stored: Session): Promise<{ accountId: string; feed: RawFeed }> {
  const session = await authorise(stored)

  const accounts = await selectAll<AccountRow>(session, 'accounts', 'select=account_id,raw,fetched_at')
  if (accounts.length === 0) {
    throw new Error('The record is empty — the import has not written an account yet.')
  }
  const account = accounts.reduce((latest, row) => row.fetched_at > latest.fetched_at ? row : latest)

  const filter = `account_id=eq.${encodeURIComponent(account.account_id)}&select=raw`
  const [deals, orders] = await Promise.all([
    selectAll<{ raw: RawDeal }>(session, 'deals', filter),
    selectAll<{ raw: RawOrder }>(session, 'orders', filter),
  ])

  return {
    accountId: account.account_id,
    feed: {
      account: account.raw,
      deals: deals.map((row) => row.raw),
      orders: orders.map((row) => row.raw),
      fetchedAt: new Date(account.fetched_at),
    },
  }
}

/** Every note and tag written against one account's trades. */
export async function readAnnotations(accountId: string): Promise<RawAnnotation[]> {
  const session = await live()
  return selectAll<RawAnnotation>(session, 'annotations',
    `account_id=eq.${encodeURIComponent(accountId)}&select=position_id,note,tags,updated_at`)
}

/**
 * Write one trade's margin, replacing whatever was there.
 *
 * An upsert on the primary key, so the first save on a trade inserts and every
 * later one updates, with no read to decide which. `updated_at` is sent rather
 * than left to the column's default, which only fires on the insert and would
 * leave every later save claiming the time the note was first written.
 *
 * This is the one write the page makes. Row-level security lets a signed-in
 * user touch this table and no other, and the broker's tables refuse an update
 * from anyone at all.
 */
export async function saveAnnotation(
  accountId: string, positionId: string, note: string, tags: string[],
): Promise<Date> {
  const session = await live()
  const updatedAt = new Date()
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/annotations?on_conflict=account_id,position_id`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        account_id: accountId,
        position_id: positionId,
        // An empty note is stored as null: the column is nullable, and a row
        // of empty strings should read as nothing written rather than as a
        // note you left blank.
        note: note.trim() === '' ? null : note,
        tags,
        updated_at: updatedAt.toISOString(),
      }),
    })
  if (response.status === 401) {
    signOut()
    throw new AuthError('Your sign-in has expired.')
  }
  if (!response.ok) {
    throw new Error(`Supabase ${response.status} saving the note: ${(await response.text()).slice(0, 300)}`)
  }
  return updatedAt
}
