/**
 * How every figure is written down.
 *
 * These lived inside `drawPage` as closures over the account's currency, which
 * was right while one function drew everything. The drawer needs the same
 * money, the same clock and the same idea of a held duration, and two copies
 * of `duration` would drift the first time one of them was improved — so they
 * moved here, still made per account rather than kept as globals.
 */

export function formatters(currency: string) {
  const money = new Intl.NumberFormat('en-AU', { style: 'currency', currency })
  const whole = new Intl.NumberFormat('en-AU', { style: 'currency', currency, maximumFractionDigits: 0 })
  const price = new Intl.NumberFormat('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 5 })

  return {
    money,
    whole,
    price,

    /** A figure with its sign shown, because a result of zero reads differently from +0. */
    signed: (n: number, format: Intl.NumberFormat = money) => (n > 0 ? '+' : '') + format.format(n),

    /** The class that colours a figure: jade above zero, coral below. */
    tone: (n: number) => (n > 0 ? 'up' : n < 0 ? 'down' : 'flat'),

    /** Two decimals, or an em dash where there is no answer rather than a zero. */
    fixed: (n: number | null) => (n === null ? '—' : n.toFixed(2)),

    plural: (n: number, one: string, many = one + 's') => n + ' ' + (n === 1 ? one : many),

    /*
     * Every time on the page is the broker's clock, which is what the terminal
     * showed and what you remember. `journal.ts` already shifted it, so these
     * read it back as UTC to keep the browser's own timezone out of it.
     */
    day: (at: Date) => at.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
    when: (at: Date) => at.toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }),
    clock: (at: Date) => at.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC' }),
    dateOf: (at: Date) => at.toISOString().slice(0, 10),

    /** Minutes under an hour, then hours, then days — one figure is enough. */
    duration: (ms: number) => {
      const m = ms / 60000
      return m < 60 ? Math.round(m) + ' min' : m < 1440 ? (m / 60).toFixed(1) + ' h' : (m / 1440).toFixed(1) + ' d'
    },

    /*
     * When you wrote something, on your own clock.
     *
     * The only times on the page that are not the broker's. Everything above
     * came from the terminal and is read back in the terminal's time; a note
     * is something you did, wherever you were, and "saved 14:02" means nothing
     * if it was 14:02 somewhere else.
     */
    wrote: (at: Date) => at.toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
    justNow: (at: Date) => at.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }),

    /** How far ahead of UTC the broker's clock runs, as "UTC+3". */
    utc: (m: number | null) => m === null ? '' : 'UTC' + (m < 0 ? '−' : '+') + Math.floor(Math.abs(m) / 60) +
      (Math.abs(m) % 60 ? ':' + String(Math.abs(m) % 60).padStart(2, '0') : ''),
  }
}

export type Format = ReturnType<typeof formatters>
