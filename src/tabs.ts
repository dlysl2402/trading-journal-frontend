/**
 * Tabs: the overview, and one tab for every trade or play you have opened.
 *
 * A row in the table opens its trade as a tab beside the overview rather than
 * in a panel over it, so a trade takes the whole width of the page, several
 * can be open at once, and coming back to the overview finds it where you
 * left it — scrolled to the same row. Opening a trade that already has a tab
 * goes to that tab; a trade is never open twice.
 *
 * A play opens the same way, from its row in What's working or from a trade
 * that ran it: a page of its own, from `playbook.ts`, with every trade that ran
 * it summed. A tab is an address — a trade by its position id, or a play by
 * its slug — and everything here treats the two alike except what is drawn in
 * them and what the arrows step through: the list's trades, or the plays in
 * What's working's order.
 *
 * The tab that is showing is written into the URL as `#trade/<position id>`
 * or `#play/<slug>`, so either can be bookmarked or opened in a browser tab of
 * its own, and the set of open tabs is kept for this browser tab alone in
 * `sessionStorage`, so the reload that settles a mid-import read does not
 * close them all. Both are about where you were looking, never about the
 * trades themselves, which are rebuilt from the record every load like
 * everything else.
 *
 * Nothing in the table is redrawn when a tab opens or closes; the overview is
 * simply hidden while a trade is showing.
 */

import { h, must } from './dom.ts'
import { edgeOf, playsOf, runs } from './edge.ts'
import type { Format } from './format.ts'
import { icon } from './icons.ts'
import type { Trade } from './journal.ts'
import type { Margin } from './margin.ts'
import { isBlank } from './margin.ts'
import { drawPlay } from './playbook.ts'
import type { Vocabulary } from './tags.ts'
import type { Panel } from './trade.ts'
import { drawTrade } from './trade.ts'
import { closedAt, returnOf, standouts } from './view.ts'

const HASH = /^#(trade|play)\/(.+)$/
const STORED = 'journal:tabs'

export interface Tabs {
  /** Show a trade, by the position id the table keyed its row by. */
  open: (positionId: string) => void
  /** Show a play's page, by its slug. */
  openPlay: (slug: string) => void
  /** Show the overview, leaving every tab open. */
  home: () => void
  /** Redraw every open tab, after the vocabulary changed under them. */
  refresh: () => void
}

/** What a tab shows: one trade, or one play. */
type Address = { kind: 'trade'; id: string } | { kind: 'play'; slug: string }

/** An address as the URL writes it, encoded, or as the stored list does, not. */
function pathOf(address: Address, encode: (part: string) => string = (part) => part): string {
  return address.kind === 'trade' ? 'trade/' + encode(address.id) : 'play/' + encode(address.slug)
}

/** A path read back. A bare id is a trade: it is how the list was stored before plays had tabs. */
function addressOf(path: string): Address {
  const match = /^(trade|play)\/(.+)$/.exec(path)
  if (match === null) return { kind: 'trade', id: path }
  return match[1] === 'trade' ? { kind: 'trade', id: match[2]! } : { kind: 'play', slug: match[2]! }
}

const same = (a: Address, b: Address): boolean => pathOf(a) === pathOf(b)

interface Tab {
  address: Address
  pick: HTMLElement
  panel: Panel
  /** How far down the page this tab was, so coming back to it finds the same place. */
  scrollY: number
}

/**
 * @param trades in the order the table shows them, so stepping forward in a
 *   tab goes the same way as reading down the page.
 * @param saved called after a write, so the table can mark the row.
 */
export function createTabs(
  trades: Trade[], format: Format, margin: Margin, vocabulary: Vocabulary,
  saved: (positionId: string) => void,
): Tabs {
  const strip = must('tabs')
  const overview = must('overview')
  const panels = must('panels')
  const { day, multiple, plural, side, signed, tone } = format

  const byId = new Map(trades.map((trade, index) => [trade.positionId, index]))
  const standing = standouts(trades)
  const drawing = {
    format, margin, vocabulary,
    // A save can change what a play came to, and a play's tab says so in the strip.
    saved: (positionId: string) => { saved(positionId); relabelPlays() },
  }

  const tabs: Tab[] = []
  /** The tab that is showing, or null for the overview. */
  let current: Tab | null = null
  let overviewScrollY = 0

  /** Every trade with what you wrote against it, as it stands now. */
  const samples = () => trades.map((trade) => ({ trade, note: margin.get(trade.positionId) }))
  /** The plays with trades behind them, in What's working's order, which is the order a play's tab steps in. */
  const plays = (): string[] => playsOf(samples(), vocabulary.kindOf)

  // ── the strip ────────────────────────────────────────────────────────────

  const home = h('button', 'tab home on') as HTMLButtonElement
  home.type = 'button'
  home.setAttribute('role', 'tab')
  home.append(icon('home'), 'Overview')
  home.addEventListener('click', () => { show(null) })
  strip.append(home)
  strip.hidden = true

  /** The strip is only on the page when there is something to switch between. */
  function reveal(): void {
    strip.hidden = tabs.length === 0
    home.classList.toggle('on', current === null)
    home.setAttribute('aria-selected', String(current === null))
    for (const tab of tabs) {
      tab.pick.classList.toggle('on', tab === current)
      tab.pick.setAttribute('aria-selected', String(tab === current))
    }
  }

  /** What the strip says about a tab, and what it tells a screen reader. */
  function label(address: Address): { text: HTMLElement; spoken: string; name: string } {
    const text = h('span', 'tab-label')
    if (address.kind === 'trade') {
      const trade = trades[byId.get(address.id)!]!
      const net = returnOf(trade)
      const name = h('span', 'tab-name', trade.symbol)
      name.append(icon(trade.side === 'buy' ? 'long' : 'short', 'icon side-icon'))
      text.append(
        name,
        h('span', 'tab-when', day(closedAt(trade))),
        h('span', 'tab-net ' + tone(net), signed(net)))
      return { text, name: trade.symbol, spoken: `${trade.symbol} ${side(trade.side).toLowerCase()}, ${day(closedAt(trade))}, ${signed(net)}` }
    }
    const title = vocabulary.label(address.slug)
    const edge = edgeOf(samples().filter((sample) => runs(sample.note, address.slug, vocabulary.kindOf)))
    const name = h('span', 'tab-name')
    name.append(icon('book', 'icon side-icon'), title)
    text.append(name, h('span', 'tab-when', plural(edge.count, 'trade')))
    const r = edge.expectancy
    if (r !== null) text.append(h('span', 'tab-net ' + tone(r), multiple(r)))
    return { text, name: title, spoken: `${title}, ${plural(edge.count, 'trade')}${r === null ? '' : ', ' + multiple(r) + ' a trade'}` }
  }

  function pickFor(tab: Tab): HTMLElement {
    const pick = h('div', 'tab')
    pick.setAttribute('role', 'tab')
    const choose = h('button', 'tab-pick') as HTMLButtonElement
    choose.type = 'button'
    choose.addEventListener('click', () => { show(tab) })
    const shut = h('button', 'tab-close') as HTMLButtonElement
    shut.type = 'button'
    shut.dataset.tip = 'Close tab (Esc)'
    shut.append(icon('x'))
    shut.addEventListener('click', (event) => {
      event.stopPropagation()
      void close(tab)
    })
    pick.append(choose, shut)
    // The middle button closes a tab, as it does in the browser above.
    pick.addEventListener('auxclick', (event) => {
      if (event.button === 1) { event.preventDefault(); void close(tab) }
    })
    relabel(pick, tab.address)
    return pick
  }

  function relabel(pick: HTMLElement, address: Address): void {
    const { text, spoken, name } = label(address)
    const [choose, shut] = pick.children
    choose!.replaceChildren(text)
    choose!.setAttribute('aria-label', spoken)
    shut!.setAttribute('aria-label', 'Close ' + name)
  }

  function relabelPlays(): void {
    for (const tab of tabs) if (tab.address.kind === 'play') relabel(tab.pick, tab.address)
  }

  // ── the panels ───────────────────────────────────────────────────────────

  function panelFor(tab: Tab): Panel {
    const address = tab.address
    if (address.kind === 'play') {
      return drawPlay(address.slug, trades, {
        plays,
        step: (by) => { void step(tab, by) },
        open: (positionId) => { go({ kind: 'trade', id: positionId }) },
        home: () => { show(null) },
        close: () => { void close(tab) },
      }, drawing)
    }
    const index = byId.get(address.id)!
    return drawTrade(trades[index]!, {
      index,
      count: trades.length,
      standing: standing.get(address.id) ?? null,
      step: (by) => { void step(tab, by) },
      next: () => {
        const next = unwrittenAfter(address.id)
        if (next !== undefined) void moveTo(tab, { kind: 'trade', id: next.positionId })
      },
      unwritten: () => trades.filter((other) => other.positionId !== address.id && isBlank(margin.get(other.positionId))).length,
      play: (slug) => { go({ kind: 'play', slug }) },
      home: () => { show(null) },
      close: () => { void close(tab) },
    }, drawing)
  }

  /**
   * The next trade down the list with nothing written against it, coming back
   * round to the top: after the last trade of a pass the ones skipped at the
   * start are still waiting.
   */
  function unwrittenAfter(positionId: string): Trade | undefined {
    const at = byId.get(positionId) ?? -1
    for (let i = 1; i < trades.length; i++) {
      const trade = trades[(at + i + trades.length) % trades.length]!
      if (trade.positionId !== positionId && isBlank(margin.get(trade.positionId))) return trade
    }
    return undefined
  }

  /** Whether there is anything at an address: a trade on the list, or a word in the vocabulary that is a play. */
  const exists = (address: Address): boolean =>
    address.kind === 'trade' ? byId.has(address.id) : vocabulary.kindOf(address.slug) === 'play'

  /** A tab for the address, made if it has none. */
  function tabFor(address: Address): Tab | null {
    const found = tabs.find((tab) => same(tab.address, address))
    if (found !== undefined) return found
    if (!exists(address)) return null
    // The strip entry and the panel both need the tab to point back at, so
    // the tab exists a moment before either of them does.
    const tab = { address, scrollY: 0 } as Tab
    tab.pick = pickFor(tab)
    tab.panel = panelFor(tab)
    tab.panel.node.hidden = true
    tabs.push(tab)
    strip.append(tab.pick)
    panels.append(tab.panel.node)
    return tab
  }

  /** Show whatever is at an address, in the tab it has or a new one. */
  function go(address: Address): void {
    const tab = tabFor(address)
    if (tab !== null) show(tab)
  }

  /** Put a tab on the page — or the overview, for null — and remember where the last one was. */
  function show(next: Tab | null, focus = true): void {
    if (next === current) { if (focus && next !== null) next.panel.node.focus({ preventScroll: true }); return }
    if (current === null) overviewScrollY = window.scrollY
    else {
      current.scrollY = window.scrollY
      // A hidden tab would go on playing its tape, sound and all, out of sight.
      current.panel.pause()
    }

    // A play's page is a sum over trades that may have been written up since
    // it was drawn, so it is drawn again each time it comes back.
    if (next !== null && next.address.kind === 'play') {
      next.panel.refresh()
      relabel(next.pick, next.address)
    }

    current = next
    overview.hidden = next !== null
    for (const tab of tabs) tab.panel.node.hidden = tab !== next
    reveal()
    window.scrollTo(0, next === null ? overviewScrollY : next.scrollY)
    if (focus && next !== null) next.panel.node.focus({ preventScroll: true })
    remember()
  }

  /** Move a tab along its own order: the list's, for a trade, or What's working's, for a play. */
  async function step(tab: Tab, by: number): Promise<void> {
    const address = tab.address
    if (address.kind === 'trade') {
      const trade = trades[(byId.get(address.id) ?? -1) + by]
      if (trade !== undefined) await moveTo(tab, { kind: 'trade', id: trade.positionId })
      return
    }
    const order = plays()
    const at = order.indexOf(address.slug)
    const slug = at < 0 ? undefined : order[at + by]
    if (slug !== undefined) await moveTo(tab, { kind: 'play', slug })
  }

  /**
   * Put something else in a tab. If it already has a tab of its own, that tab
   * is the one to show — nothing is ever open twice.
   */
  async function moveTo(tab: Tab, address: Address): Promise<void> {
    if (!exists(address)) return
    const already = tabs.find((other) => same(other.address, address))
    if (already !== undefined) { show(already); return }
    if (!(await tab.panel.settled())) return

    const oldPick = tab.pick, oldPanel = tab.panel
    tab.address = address
    tab.pick = pickFor(tab)
    tab.panel = panelFor(tab)
    oldPick.replaceWith(tab.pick)
    oldPanel.node.replaceWith(tab.panel.node)
    tab.panel.node.hidden = current !== tab
    tab.scrollY = 0
    if (current === tab) {
      window.scrollTo(0, 0)
      tab.panel.node.focus({ preventScroll: true })
      reveal()
      remember()
    }
  }

  async function close(tab: Tab): Promise<void> {
    if (!(await tab.panel.settled())) { show(tab); return }
    const at = tabs.indexOf(tab)
    if (at < 0) return
    tabs.splice(at, 1)
    tab.pick.remove()
    tab.panel.node.remove()
    if (current === tab) {
      // The neighbour on the right, then the left, then the overview — the
      // same rule the browser's own tabs follow.
      show(tabs[at] ?? tabs[at - 1] ?? null)
    } else {
      reveal()
      remember()
    }
  }

  // ── where you were ───────────────────────────────────────────────────────

  function remember(): void {
    const hash = current === null ? '' : '#' + pathOf(current.address, encodeURIComponent)
    if (location.hash !== hash) {
      history.replaceState(null, '', location.pathname + location.search + hash)
    }
    try {
      sessionStorage.setItem(STORED, JSON.stringify(tabs.map((tab) => pathOf(tab.address))))
    } catch {
      // Private windows and blocked storage: the tabs simply do not survive a reload.
    }
  }

  function inHash(): Address | null {
    const match = HASH.exec(location.hash)
    if (match === null) return null
    try {
      const part = decodeURIComponent(match[2]!)
      return match[1] === 'trade' ? { kind: 'trade', id: part } : { kind: 'play', slug: part }
    } catch {
      return null
    }
  }

  function restore(): void {
    let stored: unknown = []
    try { stored = JSON.parse(sessionStorage.getItem(STORED) ?? '[]') } catch { stored = [] }
    if (Array.isArray(stored)) {
      for (const path of stored) if (typeof path === 'string' && path !== '') tabFor(addressOf(path))
    }
    const wanted = inHash()
    const tab = wanted === null ? null : tabFor(wanted)
    // A hash naming something the page does not have shows the overview, and
    // the hash is corrected rather than left pointing at nothing.
    reveal()
    if (tab !== null) show(tab, false)
    else remember()
  }

  /*
   * A key pressed with nothing focused — after a reload, which puts a tab
   * back without taking the focus, or a click on the page around it — is
   * meant for the tab on show, so its tape and its keys answer.
   */
  document.addEventListener('keydown', (event) => {
    if (current === null || event.defaultPrevented) return
    if (event.target !== document.body && event.target !== document.documentElement) return
    current.panel.key(event)
  })

  window.addEventListener('hashchange', () => {
    const wanted = inHash()
    const tab = wanted === null ? null : tabFor(wanted)
    show(tab)
  })

  restore()

  return {
    open(positionId) { go({ kind: 'trade', id: positionId }) },
    openPlay(slug) { go({ kind: 'play', slug }) },
    home() { show(null) },
    refresh() {
      for (const tab of tabs) tab.panel.refresh()
      relabelPlays()
    },
  }
}
