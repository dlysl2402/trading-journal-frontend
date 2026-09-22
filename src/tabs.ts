/**
 * Tabs: the overview, and one tab for every trade you have opened.
 *
 * A row in the table opens its trade as a tab beside the overview rather than
 * in a panel over it, so a trade takes the whole width of the page, several
 * can be open at once, and coming back to the overview finds it where you
 * left it — scrolled to the same row. Opening a trade that already has a tab
 * goes to that tab; a trade is never open twice.
 *
 * The tab that is showing is written into the URL as `#trade/<position id>`,
 * so a trade can be bookmarked or opened in a browser tab of its own, and the
 * set of open tabs is kept for this browser tab alone in `sessionStorage`,
 * so the reload that settles a mid-import read does not close them all. Both
 * are about where you were looking, never about the trades themselves, which
 * are rebuilt from the record every load like everything else.
 *
 * Nothing in the table is redrawn when a tab opens or closes; the overview is
 * simply hidden while a trade is showing.
 */

import { h, must } from './dom.ts'
import type { Format } from './format.ts'
import type { Trade } from './journal.ts'
import type { Margin } from './margin.ts'
import type { Vocabulary } from './tags.ts'
import type { Panel } from './trade.ts'
import { drawTrade } from './trade.ts'
import { closedAt, returnOf } from './view.ts'

const HASH = /^#trade\/(.+)$/
const STORED = 'journal:tabs'

export interface Tabs {
  /** Show a trade, by the position id the table keyed its row by. */
  open: (positionId: string) => void
  /** Redraw every open trade, after the vocabulary changed under them. */
  refresh: () => void
}

interface Tab {
  positionId: string
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
  const { day, signed, tone } = format

  const byId = new Map(trades.map((trade, index) => [trade.positionId, index]))
  const drawing = { format, margin, vocabulary, saved }

  const tabs: Tab[] = []
  /** The tab that is showing, or null for the overview. */
  let current: Tab | null = null
  let overviewScrollY = 0

  // ── the strip ────────────────────────────────────────────────────────────

  const home = h('button', 'tab on', 'Overview') as HTMLButtonElement
  home.type = 'button'
  home.setAttribute('role', 'tab')
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

  function label(trade: Trade): HTMLElement {
    const net = returnOf(trade)
    const text = h('span', 'tab-label')
    text.append(
      h('span', 'tab-name', trade.symbol),
      h('span', 'tab-when', trade.side + ' · ' + day(closedAt(trade))),
      h('span', 'tab-net ' + tone(net), signed(net)))
    return text
  }

  function pickFor(tab: Tab, trade: Trade): HTMLElement {
    const pick = h('div', 'tab')
    pick.setAttribute('role', 'tab')
    const choose = h('button', 'tab-pick') as HTMLButtonElement
    choose.type = 'button'
    choose.append(label(trade))
    choose.addEventListener('click', () => { show(tab) })
    const shut = h('button', 'tab-close', '×') as HTMLButtonElement
    shut.type = 'button'
    shut.title = 'Close'
    shut.setAttribute('aria-label', 'Close ' + trade.symbol)
    shut.addEventListener('click', (event) => {
      event.stopPropagation()
      void close(tab)
    })
    pick.append(choose, shut)
    // The middle button closes a tab, as it does in the browser above.
    pick.addEventListener('auxclick', (event) => {
      if (event.button === 1) { event.preventDefault(); void close(tab) }
    })
    return pick
  }

  // ── the panels ───────────────────────────────────────────────────────────

  function panelFor(tab: Tab, trade: Trade): Panel {
    const index = byId.get(trade.positionId) ?? -1
    return drawTrade(trade, {
      index,
      count: trades.length,
      step: (by) => { void step(tab, by) },
      close: () => { void close(tab) },
    }, drawing)
  }

  /** A tab for the trade, made if it has none. */
  function tabFor(positionId: string): Tab | null {
    const found = tabs.find((tab) => tab.positionId === positionId)
    if (found !== undefined) return found
    const index = byId.get(positionId)
    if (index === undefined) return null
    const trade = trades[index]!
    // The strip entry and the panel both need the tab to point back at, so
    // the tab exists a moment before either of them does.
    const tab = { positionId, scrollY: 0 } as Tab
    tab.pick = pickFor(tab, trade)
    tab.panel = panelFor(tab, trade)
    tab.panel.node.hidden = true
    tabs.push(tab)
    strip.append(tab.pick)
    panels.append(tab.panel.node)
    return tab
  }

  /** Put a tab on the page — or the overview, for null — and remember where the last one was. */
  function show(next: Tab | null, focus = true): void {
    if (next === current) { if (focus && next !== null) next.panel.node.focus({ preventScroll: true }); return }
    if (current === null) overviewScrollY = window.scrollY
    else current.scrollY = window.scrollY

    current = next
    overview.hidden = next !== null
    for (const tab of tabs) tab.panel.node.hidden = tab !== next
    reveal()
    window.scrollTo(0, next === null ? overviewScrollY : next.scrollY)
    if (focus && next !== null) next.panel.node.focus({ preventScroll: true })
    remember()
  }

  /**
   * Move a tab along the table's order. If the trade that way already has a
   * tab of its own, that tab is the one to show — a trade is never open twice.
   */
  async function step(tab: Tab, by: number): Promise<void> {
    const index = (byId.get(tab.positionId) ?? -1) + by
    const trade = trades[index]
    if (index < 0 || trade === undefined) return
    const already = tabs.find((other) => other.positionId === trade.positionId)
    if (already !== undefined) { show(already); return }
    if (!(await tab.panel.settled())) return

    const oldPick = tab.pick, oldPanel = tab.panel
    tab.positionId = trade.positionId
    tab.pick = pickFor(tab, trade)
    tab.panel = panelFor(tab, trade)
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
    const hash = current === null ? '' : '#trade/' + encodeURIComponent(current.positionId)
    if (location.hash !== hash) {
      history.replaceState(null, '', location.pathname + location.search + hash)
    }
    try {
      sessionStorage.setItem(STORED, JSON.stringify(tabs.map((tab) => tab.positionId)))
    } catch {
      // Private windows and blocked storage: the tabs simply do not survive a reload.
    }
  }

  function inHash(): string | null {
    const match = HASH.exec(location.hash)
    if (match === null) return null
    try { return decodeURIComponent(match[1]!) } catch { return null }
  }

  function restore(): void {
    let stored: unknown = []
    try { stored = JSON.parse(sessionStorage.getItem(STORED) ?? '[]') } catch { stored = [] }
    if (Array.isArray(stored)) {
      for (const id of stored) if (typeof id === 'string') tabFor(id)
    }
    const wanted = inHash()
    const tab = wanted === null ? null : tabFor(wanted)
    // A hash naming a trade the table does not have shows the overview, and
    // the hash is corrected rather than left pointing at nothing.
    reveal()
    if (tab !== null) show(tab, false)
    else remember()
  }

  window.addEventListener('hashchange', () => {
    const wanted = inHash()
    const tab = wanted === null ? null : tabFor(wanted)
    show(tab)
  })

  restore()

  return {
    open(positionId) {
      const tab = tabFor(positionId)
      if (tab !== null) show(tab)
    },
    refresh() {
      for (const tab of tabs) tab.panel.refresh()
    },
  }
}
