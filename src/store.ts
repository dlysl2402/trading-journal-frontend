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

import type { RawAccount, RawAnnotation, RawDeal, RawFeed, RawOrder, RawTag } from './rows.ts'

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

/** The bucket a trade's clips are kept in; `schema.sql` names it and its layout. */
const VIDEOS = 'videos'

/** How long a signed clip stays playable, in seconds: longer than any tab is left open. */
const A_DAY = 86_400

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
 * A reply the record refused. A 401 is a sign-in that has lapsed under the
 * page, whatever the call was. Anything else is described by the body, which
 * names the policy, the missing table or the missing bucket where the status
 * alone cannot tell them apart.
 */
async function refused(response: Response, doing: string): Promise<never> {
  if (response.status === 401) {
    signOut()
    throw new AuthError('Your sign-in has expired.')
  }
  throw new Error(`Supabase ${response.status} ${doing}: ${(await response.text()).slice(0, 300)}`)
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
    if (!response.ok) await refused(response, `reading ${table}`)
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

/** Every note, grade and tag written against one account's trades. */
export async function readAnnotations(accountId: string): Promise<RawAnnotation[]> {
  const session = await live()
  return selectAll<RawAnnotation>(session, 'annotations',
    `account_id=eq.${encodeURIComponent(accountId)}&select=position_id,note,tags,grade,updated_at`)
}

/** The whole vocabulary, retired tags included — the page decides what to show. */
export async function readTags(): Promise<RawTag[]> {
  const session = await live()
  return selectAll<RawTag>(session, 'tags', 'select=slug,kind,label,description,sort,archived')
}

/**
 * Insert a row, or replace the one already under its key.
 *
 * An upsert, so the first save inserts and every later one updates, with no
 * read to decide which. These are the only writes the page makes. Row-level
 * security lets a signed-in user touch these two tables and no other, and the
 * broker's tables refuse an update from anyone at all.
 */
async function upsert(table: string, key: string, row: unknown, doing: string): Promise<void> {
  const session = await live()
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${key}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${session.accessToken}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(row),
  })
  if (!response.ok) await refused(response, doing)
}

/**
 * Write one trade's margin, replacing whatever was there.
 *
 * `updated_at` is sent rather than left to the column's default, which only
 * fires on the insert and would leave every later save claiming the time the
 * note was first written.
 */
export async function saveAnnotation(
  accountId: string, positionId: string,
  margin: { note: string; tags: string[]; grade: RawAnnotation['grade'] },
): Promise<Date> {
  const updatedAt = new Date()
  await upsert('annotations', 'account_id,position_id', {
    account_id: accountId,
    position_id: positionId,
    // An empty note is stored as null: the column is nullable, and a row of
    // empty strings should read as nothing written rather than as a note you
    // left blank.
    note: margin.note.trim() === '' ? null : margin.note,
    tags: margin.tags,
    grade: margin.grade,
    updated_at: updatedAt.toISOString(),
  }, 'saving the note')
  return updatedAt
}

/** Add a word to the vocabulary, or change one. */
export async function saveTag(tag: RawTag): Promise<void> {
  await upsert('tags', 'slug', tag, 'saving the tag')
}

/** One clip, as a <video> can play it. */
export interface Clip {
  /** The file's name in the trade's folder: the only name a clip has. */
  name: string
  /** Signed, so it carries its own right to be fetched. Good for a day. */
  url: string
}

/** One entry of a folder listing. The name is relative to the folder. */
interface Listed {
  name: string
  /** Null for a folder rather than a file. */
  id: string | null
}

/** One path's answer from a signing request. */
interface Signed {
  path: string
  /** Relative to the Storage API's root, the file's name spelled as it is; null when the path was refused. */
  signedURL: string | null
  error: string | null
}

/**
 * A signed URL as a <video> can fetch it.
 *
 * The server writes the file's name into the path exactly as it is, spaces
 * and all, which is not a URL yet. Each segment is encoded here; the token
 * after the question mark is left alone, since it is the part that is checked.
 */
function playable(signedURL: string): string {
  const query = signedURL.lastIndexOf('?')
  const path = signedURL.slice(0, query).split('/').map(encodeURIComponent).join('/')
  return `${SUPABASE_URL}/storage/v1${path}${signedURL.slice(query)}`
}

/** One call to the Storage API, signed in as you. */
async function storage<T>(path: string, body: unknown, doing: string): Promise<T> {
  const session = await live()
  const response = await fetch(`${SUPABASE_URL}/storage/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${session.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) await refused(response, doing)
  return response.json() as Promise<T>
}

/**
 * The clips recorded against one trade, ready to play.
 *
 * The bucket is the whole record of which trades have a video: a trade has
 * clips if its folder has files, and there is no table that could say
 * otherwise. So the folder is listed, and then every file in it is signed in
 * one request. The bucket is private, and a <video> cannot carry your token
 * the way a fetch can, so each clip is given a URL that carries its own.
 */
export async function readClips(accountId: string, positionId: string): Promise<Clip[]> {
  const folder = `${accountId}/${positionId}`
  const listed = await storage<Listed[]>(`object/list/${VIDEOS}`, { prefix: folder }, 'listing the clips')
  // A folder made in the dashboard holds a hidden placeholder that is not a clip.
  const names = listed
    .filter((entry) => entry.id !== null && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
  if (names.length === 0) return []

  const signed = await storage<Signed[]>(`object/sign/${VIDEOS}`,
    { expiresIn: A_DAY, paths: names.map((name) => `${folder}/${name}`) }, 'signing the clips')
  return signed.map((entry, at) => {
    if (entry.signedURL === null) throw new Error(`Supabase would not sign ${names[at]}: ${entry.error}`)
    return { name: names[at]!, url: playable(entry.signedURL) }
  })
}

/**
 * Put one clip in a trade's folder, saying how much of it has gone.
 *
 * An XMLHttpRequest rather than a fetch, for one reason: fetch cannot report
 * how much of a body it has sent, and a two-gigabyte recording on a home
 * uplink is minutes of silence without that. One request carries the whole
 * file, up to the project's upload limit; a request that fails is started
 * over, not resumed. The file keeps its own name, so a second upload under
 * the same name is refused rather than quietly replacing the first.
 */
export async function uploadClip(
  accountId: string, positionId: string, file: File, progress: (fraction: number) => void,
): Promise<void> {
  const session = await live()
  const path = [VIDEOS, accountId, positionId, file.name].map(encodeURIComponent).join('/')
  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', `${SUPABASE_URL}/storage/v1/object/${path}`)
    request.setRequestHeader('apikey', SUPABASE_PUBLISHABLE_KEY)
    request.setRequestHeader('Authorization', `Bearer ${session.accessToken}`)
    request.setRequestHeader('Content-Type', file.type || 'video/mp4')
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) progress(event.loaded / event.total)
    })
    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) { resolve(); return }
      // The same rule as every other refused call, given the reply's shape.
      refused(new Response(request.responseText, { status: request.status }), 'uploading the clip').catch(reject)
    })
    request.addEventListener('error', () => reject(new Error('The upload failed before Supabase answered.')))
    request.send(file)
  })
}
