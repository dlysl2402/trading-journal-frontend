# trading-journal-frontend

The journal you look at. One page: net P&L, the equity curve, a calendar of
days, what the broker's own fields say about how the trades were run, and every
closed trade in a table.

It is a static page. It signs in to Supabase, reads the record the import keeps
there, rebuilds the round trips in the browser, and works every figure out from
them. Nothing is stored here — no database, no cache, no server of its own — so
a number on the screen cannot drift from the record beneath it.

## The other half

The record is written by **trading-journal** (`dlysl2402/trading-journal`): a
scheduled job that reads MetaApi every fifteen minutes and appends what is new
to Supabase. This repository never talks to MetaApi and never writes a broker
row. The two meet only at the Supabase tables, whose shapes are declared in
`src/rows.ts` here and in `supabase/schema.sql` there.

```
MetaApi ──▶ trading-journal ──▶ Supabase ──▶ trading-journal-frontend
            (fetch, append)     (the record) (read, rebuild, draw)
```

Adding a field to a row is safe from either side. Renaming or removing one is
the one change that needs both repositories in the same breath.

## The layers

| | | |
|---|---|---|
| 1 | the record | Supabase, written by the other repository |
| 2 | the trade | `src/journal.ts` — deals grouped into round trips |
| 3 | the figures | `src/view.ts` — net, costs, exit price, the curve; derived, never stored |
| — | the drawing | `src/page.ts` — the page, from the `Journal` itself |

`src/store.ts` reads layer 1 and signs you in. `src/main.ts` is the boot.

## Setting it up

1. **Publishable key.** Supabase → Project Settings → API keys → publishable
   (`sb_publishable_…`, or the legacy anon key). Put it at the top of
   `src/store.ts`.
   It is committed on purpose: it identifies the project, not a person, and
   row-level security decides what it can read. The project's *secret* key
   bypasses those policies and must never appear in this repository.

2. **A user to sign in as.** Supabase → Authentication → Users → Add user.
   The policies in the backend's schema grant `select` on the broker's tables
   to a signed-in user and to nobody else, so the page is blank without one.
   Turn off public sign-ups under Authentication → Providers unless you want
   anyone who finds the URL to be able to make themselves an account.

```sh
npm install
npm run preview      # build, then serve on http://localhost:8000
```

`npm test` runs the unit tests. One of them builds the journal from a real
fetch and skips unless `data/snapshot.json` is there; copy it from the backend
repository to run it. It is never committed — it carries the account holder's
name and account number.

`npm run typecheck` is the same compiler with `--noEmit`. `npm run build`
compiles `src/` into `dist/` and copies `index.html` in beside it. There is no
bundler and no dependency in the page — the two test files land in `dist/` too,
and are harmless there.

## Deploying

Vercel, as a static build. `vercel.json` sets the build command and points the
output at `dist/`; there is nothing to configure in the dashboard and no
environment variables to set, because the only two values the page needs are at
the top of `src/store.ts`.

The deployed URL is public. What is behind it is not: without a sign-in the
page shows a form, and the record refuses to answer.

## A note on errors

The import writes deals, then orders, then the account row. A page that reads
in the middle of that can see more deals than the balance accounts for, and
`buildJournal` refuses to build on figures that do not add up. That is the
right answer — reloading a moment later settles it. An error that keeps coming
back means the record and the broker have genuinely diverged, and the backend's
log is where the reason will be.
