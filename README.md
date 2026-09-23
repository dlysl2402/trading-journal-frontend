# trading-journal-frontend

The journal you look at. One page: the net return, the growth curve, a calendar
of days, what the broker's own fields say about how the trades were run, and every
closed trade in a table — and, behind any row you click, that trade opened up
in a tab of its own, with somewhere to write about it.

It is a static page. It signs in to Supabase, reads the record the import keeps
there, rebuilds the round trips in the browser, and works every figure out from
them. Nothing is stored here — no database, no cache, no server of its own — so
a number on the screen cannot drift from the record beneath it. The one thing
the browser keeps is which tabs you had open, in `sessionStorage`, so a reload
does not close them; that is where you were looking, not a figure.

The one exception is the margin: your notes, grades and tags. They are not a
function of the broker's rows, so they cannot be rebuilt from them — they are
written back to the record as you type, into the two tables this page is
allowed to write: `annotations`, one row per trade, and `tags`, the vocabulary
those tags are picked from. The clips you record of a trade are the margin's
too, and the one thing of yours not in a table: they sit in a private Storage
bucket, one folder per trade, and a trade's tab streams whatever its folder
holds and is where a new one goes in. The bucket is the list, so nothing has
to be kept in step with it.

The journal begins on a date: `JOURNAL_BEGINS` at the top of `src/main.ts`,
16 September 2026, the day the risk manager went live. Every trade since was
sized by it and carries its stop and target on the entry order, so what it
risked is a fact. The trades before it were sized by hand with no stop on
record at entry, so nothing about their risk can be said, and they stay on the
record and off the page. Their deals still count toward the balance every
later trade was opened on. Move the date and they come back.

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
| 4 | the margin | `src/margin.ts` — your notes, grades and tags; kept, because nothing derives them |
| 4 | the vocabulary | `src/tags.ts` — the four kinds of tag, what each is for, and the words in each |
| — | the drawing | `src/page.ts` — the page, from the `Journal` itself |
| — | the tabs | `src/tabs.ts` — the overview and one tab per opened trade, and the address in the URL |
| — | one trade | `src/trade.ts` — a trade drawn out in full, and where you write |
| — | the words | `src/settings.ts` — the dialog where tags are named, described, ordered and retired |

`src/store.ts` reads layer 1, writes layer 4, signs the clips and signs you in. `src/notes.ts`
is the formatting a note may use, read from text into blocks and written back
out again — blocks rather than HTML, which is why a note can hold an angle
bracket and still be words on the page. `src/prose.ts` is the other half of
that hinge, blocks to elements and back, and `src/editor.ts` the writing
surface on top of them. Those two files are the whole cost of keeping prose
rather than markup, and nothing else in the app knows a note has a format. `src/format.ts` is how every figure is written down and
`src/dom.ts` the two lines of DOM the drawing modules share. `src/main.ts` is
the boot.

## Writing in it

Click any row in the table. The trade opens in a tab of its own, beside the
overview: one line of what it was, the four prices — with the stop as it was
placed *and* as it ended, and how far a fill landed from the level that fired
it — and under them your read of it: a grade, your tags, and your note. A
trade closed in pieces lists each piece; nothing else is said twice. Open as many as you like; the strip under the header switches
between them, and the overview comes back scrolled to where you left it. A
trade already open goes to its tab rather than opening twice. The date in a
row is a link to the trade's address (`#trade/<position id>`), so a ⌘-click or
a middle click opens it in a browser tab instead, and the address can be
bookmarked.

**The grade** is A, B or C for the setup as it looked at entry, never for how
it ended; the result already has a column. Click a letter to set it and the
lit one again to clear it.

**Tags are picked, not typed.** They come in four kinds. On a trade each is
one row, its name and its words; hover the name for what the kind is for, and
**Tags** in the header writes it out in full, so the line between them is kept
on a page rather than in your head:

| | answers | |
|---|---|---|
| Context | why this trade at all? | already true while you were still deciding — the 1h stretched, a trend day |
| Trigger | why now, not five minutes ago? | the event on the entry bar that ended the deciding — a strong close below support |
| Play | what shape was the trade? | the template you ran — break and continue. One per trade; picking a second replaces the first |
| Mistake | what would you take back? | the process, never the result — chased, cut early |

Every tag is a word from one vocabulary, spelled once, so that "1h
overextended" on a Tuesday loser is the same tag as on a Friday winner and a
filter can find them all. A tag not yet in the vocabulary is added from the
`+` chip at the end of its row without leaving the trade. **Tags** in the header
opens the vocabulary itself: rename a tag and every trade follows, give it a
description so it keeps its meaning, move it up or down the list, or retire it
— it leaves the picker but stays on every trade that carries it. Nothing is
deleted. A trade carrying a tag the vocabulary no longer names shows it apart,
marked as such, with a click to take it off.

The vocabulary lives in the `tags` table the backend's `schema.sql` creates.
A project that predates it runs `supabase/2026-09-21-tags-and-grade.sql` there
first; until then the page has nothing to pick from and says so.

The note is an editor: bold looks bold rather than `**bold**`, and the toolbar
above it does bold, italic, code, headings, both kinds of list and quotes.
`⌘B` and `⌘I` work, and typing `- `, `1. `, `> ` or `## ` at the start of a
line turns into the thing it means. Tags sit above it as chips you click to
edit as a line.

Nothing has a save button. Leaving a field saves it, `Esc` puts the pen down
and `Esc` again closes the tab, and `←` `→` move the tab to the next trade —
which is what makes writing up a session's worth of trades one pass rather
than forty. A save the record refuses leaves your words on the screen and says
why, and holds the tab open rather than carrying them off it. A grade or a tag
is saved by the click that sets it.

**What is stored is still plain text.** The editor is a reading of it, not a
second copy: `annotations.note` holds Markdown you could open in any editor, so
a note stays legible in a SQL client and portable out of here. Formatting is
turned back into text on every save, and `notes.ts` writes one spelling of each
thing — `##` for headings, `-` for bullets, numbers counting from one — so
opening a note and closing it again is not an edit. What the editor cannot
describe, it does not keep: pasted markup arrives as plain text, and the
document stays inside four kinds of block and five kinds of run.

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
   That same schema creates the `annotations` and `tags` tables this page
   writes; if your project predates either, run that part of
   `supabase/schema.sql` (or the dated migration beside it) before the
   journal will load.
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

DigitalOcean App Platform, as a static site. `.do/app.yaml` sets the build
command, points the output at `dist/` and redeploys on every push to `main`;
there are no environment variables to set, because the only two values the page
needs are at the top of `src/store.ts`. `doctl apps create --spec .do/app.yaml`
makes the app, and `doctl apps update <app id> --spec .do/app.yaml` carries a
change to the spec over to it.

The deployed URL is public. What is behind it is not: without a sign-in the
page shows a form, and the record refuses to answer.

## A note on errors

The import writes deals, then orders, then the account row. A page that reads
in the middle of that can see more deals than the balance accounts for, and
`buildJournal` refuses to build on figures that do not add up. That is the
right answer — reloading a moment later settles it. An error that keeps coming
back means the record and the broker have genuinely diverged, and the backend's
log is where the reason will be.
