# trading-journal-frontend

The journal you look at. One page: the net return and the growth curve, a
queue of the trades still waiting to be written up, a calendar of days, what the
broker's own fields say about how the trades were run, what your grades and tags
say about which setups pay, and every closed trade in a list you can narrow —
and, behind any row you click, that trade opened up in a tab of its own, with
somewhere to write about it. Each setup you tag has a tab of its own too, with
the statistics of every trade that ran it.

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
| — | the drawing | `src/page.ts` — the page, from the `Journal` itself, and the wiring between its pieces |
| — | the pieces | `src/chart.ts`, `src/calendar.ts`, `src/table.ts`, `src/queue.ts`, `src/insights.ts` — the curve, the calendar, the list, the review queue and what's working |
| — | the sifting | `src/filter.ts` — which trades the list shows; `src/breakdown.ts` — the written-up trades grouped by grade or by tag; `src/edge.ts` — what one play's trades came to. All three pure, and tested |
| — | the tabs | `src/tabs.ts` — the overview and one tab per opened trade or play, and the address in the URL |
| — | one trade | `src/trade.ts` — a trade drawn out in full, and where you write |
| — | one play | `src/playbook.ts` — a setup's page: every trade that ran it, summed; `src/rcurve.ts` — its R added up trade by trade |
| — | the tape | `src/tape.ts` — a trade's recording, played at the top of its tab, with the moments your note points at marked on it |
| — | the words | `src/settings.ts` — the dialog where tags are named, described, ordered and retired |

`src/store.ts` reads layer 1, writes layer 4, signs the clips and signs you in. `src/notes.ts`
is the formatting a note may use, read from text into blocks and written back
out again — blocks rather than HTML, which is why a note can hold an angle
bracket and still be words on the page. `src/prose.ts` is the other half of
that hinge, blocks to elements and back, and `src/editor.ts` the writing
surface on top of them. Those two files are the whole cost of keeping prose
rather than markup, and nothing else in the app knows a note has a format. `src/format.ts` is how every figure is written down,
`src/dom.ts` the two lines of DOM the drawing modules share, `src/icons.ts` the
handful of line icons, and `src/tips.ts` the one tooltip every explanation on
the page shares. `src/main.ts` is the boot.

## Writing in it

The quickest way in is **Review next trade**, in the review queue beside the
curve. It opens the newest trade with nothing written against it, and **Next to
review** at the foot of that trade — or `N` — moves the tab on to the one after,
so a session's worth of trades is written up in one pass rather than forty trips
back to the list. Any row in the list opens its trade too, and so does a point
on the curve.

The trade opens in a tab of its own, beside the overview. On the left, first, is
its recording — the replay, or the highlight reel cut from it — large, because
every other thing on the tab is about it. It stays where it is on the page
rather than following you down it. A trade with no recording yet shows an empty screen there, and
a video dropped anywhere on the tab goes onto it. Under the tape is what the
trade was: the plan drawn as a line — stop to target, the entry between them and
a dot where the trade left — with the result in R, how far price went your way in
units of the stop it was opened with, when it was opened with one; then the four
prices, with the stop as it was placed *and* as it ended, and how far a fill
landed from the level that fired it. A trade closed in pieces lists each piece;
nothing else is said twice. On the right is your read of it: a grade, your tags,
and your notes. The week's biggest win and biggest loss say so under their
result: they are the ones worth taking apart moment by moment, where most trades
need a grade and a tag and no more. Open as many as you like; the strip under the header switches
between them, and the overview comes back scrolled to where you left it. A
trade already open goes to its tab rather than opening twice. The time in a
row is a link to the trade's address (`#trade/<position id>`), so a ⌘-click or
a middle click opens it in a browser tab instead, and the address can be
bookmarked.

The list narrows as you ask it to: by words in the symbol, a tag or a note; to
winners or losers, longs or shorts; to the trades still waiting for a review, or
the ones done. Press a filter again to let it go. A day on the calendar narrows it to that day, and a row of
**What's working** — the written-up trades grouped by grade, play, context,
trigger or mistake, with what each group came to — to that group; a play's row
opens the play's own page instead (see *Reading a play*). The figures above the
list are always every trade; only the list narrows.

**The tape is written about, moment by moment.** Watch it and press `M` where
something happens — the setup forming, the entry, the first piece off — and the
tape stops there and the time goes into the note you were last in (the in-trade
one until you have been in another), as a line of its own in time order, with
the caret after it for what you saw. `Esc` puts the pen down and `K`
plays on. A time in a note is written `[0:26]`, so it reads as a time in the
stored text too; in the note it is a chip that plays the tape from there, and on
the scrubber it is a pin, lit as the tape passes it. `Shift M` marks without
stopping, and so does `M` full screen, for marking as you watch and writing up
after; the clock in each note's toolbar puts the tape's time where the caret is,
and typing `[0:31]` makes one too. The tape's keys work from anywhere on the tab:
`K` or space to play, `J` and `L` five seconds back and on, `,` and `.` a frame
at a time, `<` and `>` for the speed, which this browser keeps, `0` to `9` for a
tenth of the way through, and `F` for full screen. A tab that goes out of sight
stops its tape.

**The grade** is A, B or C for the setup as it looked at entry, never for how
it ended; the result already has a column. Click a letter, or press it, to set
it, and the lit one again to clear it.

**Tags are picked, not typed.** They come in four kinds. On a trade each is
one row, its name and its words; the ⓘ beside the name gives the question the
kind answers and what it is for, and **Tags** in the header keeps all four in
one place, so the line between them is kept on a page rather than in your head:

| | answers | |
|---|---|---|
| Context | why this trade at all? | already true while you were still deciding — the 1h stretched, a trend day |
| Trigger | why now, not five minutes ago? | the event on the entry bar that ended the deciding — a strong close below support |
| Play | what shape was the trade? | the template you ran — break and continue. One per trade; picking a second replaces the first |
| Mistake | what would you take back? | the process, never the result — chased, cut early |

Every tag is a word from one vocabulary, spelled once, so that "1h
overextended" on a Tuesday loser is the same tag as on a Friday winner and a
filter can find them all. A tag not yet in the vocabulary is added from the
**+ New** chip at the end of its row without leaving the trade. **Tags** in the header
opens the vocabulary itself: rename a tag and every trade follows, give it a
description so it keeps its meaning, move it up or down the list, or retire it
— it leaves the picker but stays on every trade that carries it. Nothing is
deleted. A trade carrying a tag the vocabulary no longer names shows it apart,
marked as such, with a click to take it off.

The vocabulary lives in the `tags` table the backend's `schema.sql` creates.
A project that predates it runs `supabase/2026-09-21-tags-and-grade.sql` there
first; until then the page has nothing to pick from and says so.

**A trade is written up in three notes**, in the order it happened, and all
three after the close. *Pre-trade* is what you saw and why you took it;
*in-trade*, what happened while it was open and what you did about it;
*post-trade*, what you would do again and what you would change. Any one of
them is enough to take a trade off the review queue.

Each note is an editor: bold looks bold rather than `**bold**`, and the toolbar
above it does bold, italic, code, headings, both kinds of list and quotes.
`⌘B` and `⌘I` work, and typing `- `, `1. `, `> ` or `## ` at the start of a
line turns into the thing it means. Tags sit above them as chips you click to
edit as a line.

Nothing needs a save button. A grade or a tag is saved by the click that sets
it, and a note by leaving it — or by `⌘↵`, or **Save notes** under them, for
saving without leaving. `Esc` puts the pen down and `Esc` again closes the tab;
`←` `→` move the tab to the newer or older trade, `N` to the next one
waiting for a review, and `P` to the page of the play it ran. None of those keys do anything while you are typing, so
the arrows still move the caret in a note. A save the record refuses leaves your
words on the screen and says why, and holds the tab open rather than carrying
them off it.

**What is stored is still plain text.** The editor is a reading of it, not a
second copy: `annotations.pre_trade`, `in_trade` and `note` — the post-trade
one, named before there were three — hold Markdown you could open in any
editor, so a note stays legible in a SQL client and portable out of here. A
project set up before 2026-09-27 adds the first two with the backend's
`supabase/2026-09-27-trade-notes.sql`, and has to run it before this page is
deployed: the page asks for both columns by name. Formatting is
turned back into text on every save, and `notes.ts` writes one spelling of each
thing — `##` for headings, `-` for bullets, numbers counting from one, `[0:26]`
for a moment — so opening a note and closing it again is not an edit. What the
editor cannot describe, it does not keep: pasted markup arrives as plain text,
and the document stays inside four kinds of block and six kinds of run. A
moment is a time on whichever recording is on screen; a trade with more than
one picks between them above the tape.

## Reading a play

A play is the shape of trade you ran, and so the unit a playbook is kept in:
each one has a page of its own, with every trade that carries it summed. A
play's row in **What's working** opens it, and so does the book beside the play
on a trade that ran it, or `P` there. It opens in a tab as a trade does, at
`#play/<slug>`, and `←` `→` step through the plays in What's working's order,
best first, so the whole playbook reads in one pass.

It is read in R: what each trade made in units of the stop it was opened with,
before costs. R is the same on a small position and a big one, so it measures
the setup apart from how hard you pressed it. How hard you pressed it is
measured on its own, as the share of the account each trade stood to lose, and
what the two came to together is the return, net of costs, as everywhere else.

- **Expectancy** heads it: the average R, what one more trade of the kind is
  worth. Under it is the range the true average most likely sits in, 95 times
  in 100. It is wide on a few trades and narrows as they add up, and while it
  spans zero it is tinted, since the edge could still be luck.
- **Six figures** follow: how often it won; the average winner over the average
  loser, in R; what it did to the account; the risk a trade carried, on average
  and grade by grade, which says whether the A's were pressed harder than the
  C's; the share of the play's total its best tenth of trades made; and the
  losses that went more than a tenth of an R past their stop.
- **When it works** splits the trades one way at a time: by grade, context,
  trigger, mistake, the hour they were opened, the side or the market, each
  group with its win rate, average R, risk and total R. Grade comes first
  because the rest depends on it. An A that does not beat a B means the grading
  is wrong, and one that does is the version to size up.
- **Cumulative R** adds the play's R up trade by trade, with each trade's own R
  as a bar under the line, drawn against the trades rather than the calendar.
  Beside it are the last ten trades' win rate and average R, where a setup that
  has stopped working shows first, and the deepest the play has fallen from its
  best.
- **Outcomes** is every trade by its R, in bars half an R wide while they fit.
  A full stop is the −1R bar, a scratch the 0R bar, and a long right tail is
  where the play's money is.
- **How you run it** sets the play run clean against the play run with a
  mistake, then how the trades closed and what each way made, what the winners
  took of the reward their targets planned, how long winners and losers were
  held, and what costs took.
- **Trades** lists every one that ran it, newest first. By grade, the A's come
  first, the play from its best version down; by best or worst R, the ones to
  watch again. Any row opens its trade, recording and all.

A scratch, a trade that closed where it opened and lost only its costs, is no
win, and it is kept out of the losers' average too, where it would pass for a
loser cut short and make every loss look smaller than the stop. Every group on
the page narrows the play's list to its trades: a bar of the outcomes, a row
of the table, a way the trades closed, clean or not. Press it again to let go.
The page is drawn again whenever its tab comes back, since a trade written up
in the meantime may have joined it, and nothing on it is stored: `src/edge.ts`
works it out from the trades and what you wrote against them.

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
