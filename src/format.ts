/**
 * How every figure is written down.
 *
 * These lived inside `drawPage` as closures, which was right while one
 * function drew everything. A trade tab needs the same percentage, the same
 * clock and the same idea of a held duration, and two copies of `duration`
 * would drift the first time one of them was improved — so they moved here.
 */

import type { ExitReason, Side } from './journal.ts'

/** Who closed a trade: you, or one of the two levels you left with the broker. */
export const CLOSED_BY: Record<ExitReason['kind'], string> = { manual: 'You', stop: 'Stop', target: 'Target' }

/** The same, said as what happened. */
export const CLOSED_HOW: Record<ExitReason['kind'], string> = { manual: 'Closed by you', stop: 'Hit the stop', target: 'Hit the target' }

/** A real minus sign, the width of the plus it stands opposite. */
const MINUS = '−'

/** "+", "−" or nothing, for a figure that reads differently above and below zero. */
const sign = (n: number): string => (n > 0 ? '+' : n < 0 ? MINUS : '')

/*
 * The broker's clock, the one the terminal showed: twenty-four hours, read back
 * as UTC because `journal.ts` has already shifted it.
 */
const BROKER = { timeZone: 'UTC', hourCycle: 'h23' } as const

export function formatters() {
  const price = new Intl.NumberFormat('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 5 })

  return {
    price,

    /**
     * A fraction of the account as a percentage — 0.0123 is "1.23%". No
     * currency anywhere on the page: a result is what it did to the account,
     * never a sum of money to feel something about.
     */
    pct: (r: number) => (100 * r).toFixed(2) + '%',

    /** A return with its sign shown, because a result of zero reads differently from +0. */
    signed: (r: number) => sign(r) + Math.abs(100 * r).toFixed(2) + '%',

    /** A result in units of the risk taken: "+1.24R". */
    multiple: (n: number) => sign(n) + Math.abs(n).toFixed(2) + 'R',

    /** The class that colours a figure: green above zero, red below. */
    tone: (n: number) => (n > 0 ? 'up' : n < 0 ? 'down' : 'flat'),

    /** Two decimals, or an em dash where there is no answer rather than a zero. */
    fixed: (n: number | null) => (n === null ? '—' : n.toFixed(2)),

    plural: (n: number, one: string, many = one + 's') => n + ' ' + (n === 1 ? one : many),

    /** The broker's words for a side are buy and sell; a trader's are these. */
    side: (side: Side) => (side === 'buy' ? 'Long' : 'Short'),

    /*
     * Every time on the page is the broker's clock, which is what the terminal
     * showed and what you remember. `journal.ts` already shifted it, so these
     * read it back as UTC to keep the browser's own timezone out of it.
     */
    day: (at: Date) => at.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
    weekday: (at: Date) => at.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }),
    when: (at: Date) => at.toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', ...BROKER }),
    clock: (at: Date) => at.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', second: '2-digit', ...BROKER }),
    time: (at: Date) => at.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', ...BROKER }),
    dateOf: (at: Date) => at.toISOString().slice(0, 10),

    /** "45s", "12m", "1h 12m", "2d 4h": the two largest units, which is all a hold needs. */
    duration: (ms: number) => {
      const s = Math.round(ms / 1000)
      if (s < 60) return s + 's'
      const m = Math.round(s / 60)
      if (m < 60) return m + 'm'
      const hours = Math.floor(m / 60), minutes = m % 60
      if (hours < 24) return hours + 'h' + (minutes ? ' ' + minutes + 'm' : '')
      const days = Math.floor(hours / 24), left = hours % 24
      return days + 'd' + (left ? ' ' + left + 'h' : '')
    },

    /*
     * When you wrote something, on your own clock.
     *
     * The only times on the page that are not the broker's. Everything above
     * came from the terminal and is read back in the terminal's time; a note
     * is something you did, wherever you were, and "saved 14:02" means nothing
     * if it was 14:02 somewhere else.
     */
    wrote: (at: Date) => at.toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
    justNow: (at: Date) => at.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),

    /** How far ahead of UTC the broker's clock runs, as "UTC+3". */
    utc: (m: number | null) => m === null ? '' : 'UTC' + (m < 0 ? MINUS : '+') + Math.floor(Math.abs(m) / 60) +
      (Math.abs(m) % 60 ? ':' + String(Math.abs(m) % 60).padStart(2, '0') : ''),
  }
}

export type Format = ReturnType<typeof formatters>
