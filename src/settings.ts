/**
 * The vocabulary, opened up for editing.
 *
 * A trade can add a word in passing, but naming is only half of it: a tag
 * earns its keep by meaning one thing, and the place to say what that is,
 * to spell it better, to put it in a sensible order or to retire it, is here.
 *
 * Same rule as everywhere else on the page: leaving a field saves it, and a
 * click on an arrow or "Retire" is the save. Nothing is deleted. A retired tag
 * leaves the picker and stays on every trade that carries it, because the
 * trades that carry it still mean what they meant.
 */

import { h, must } from './dom.ts'
import type { Kind, Tag, Vocabulary } from './tags.ts'
import { KINDS } from './tags.ts'

interface Settings {
  open: () => void
}

/** @param changed called when the dialog closes after any edit, so the page can redraw labels. */
export function createSettings(vocabulary: Vocabulary, changed: () => void): Settings {
  const dialog = must<HTMLDialogElement>('tags-dialog')
  const body = must('tags-body')
  const status = must('tags-status')
  let touched = false

  async function attempt(work: () => Promise<unknown>): Promise<void> {
    status.className = 'saved working'
    status.textContent = 'Saving…'
    try {
      await work()
      touched = true
      status.className = 'saved'
      status.textContent = 'Saved'
    } catch (error) {
      status.className = 'saved failed'
      status.textContent = error instanceof Error ? error.message : String(error)
    }
  }

  /** The tag as the vocabulary holds it now, not as it was when its row was drawn. */
  const current = (tag: Tag): Tag => vocabulary.get(tag.slug) ?? tag

  /** A text field that writes the tag when you leave it, if you changed it. */
  function field(tag: Tag, key: 'label' | 'description', placeholder: string): HTMLInputElement {
    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'tag-field ' + (key === 'label' ? 'name' : 'meaning')
    input.placeholder = placeholder
    input.value = tag[key] ?? ''
    input.addEventListener('blur', () => {
      const value = input.value.trim()
      const now = current(tag)
      if (value === (now[key] ?? '')) return
      if (key === 'label' && value === '') { input.value = now.label; return }
      void attempt(() => vocabulary.save({ ...now, [key]: key === 'description' && value === '' ? null : value }))
    })
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); input.blur() }
    })
    return input
  }

  function row(tag: Tag, neighbours: Tag[]): HTMLElement {
    const line = h('div', 'tag-row' + (tag.archived ? ' retired' : ''))
    line.append(field(tag, 'label', 'Name'), field(tag, 'description', 'What it means, so it means the same thing next month'))

    // A rename in the field beside a button lands before the button is
    // pressed, so every write here starts from the tag as it stands, not from
    // the copy this row was drawn with.
    const index = neighbours.indexOf(tag)
    const move = (by: number): HTMLButtonElement => {
      const other = neighbours[index + by]
      const button = h('button', 'quiet arrow', by < 0 ? '↑' : '↓') as HTMLButtonElement
      button.type = 'button'
      button.disabled = other === undefined
      button.title = by < 0 ? 'Move up' : 'Move down'
      if (other !== undefined) {
        button.addEventListener('click', () => {
          // Swapping sort keys keeps the rest of the list where it was.
          void attempt(async () => {
            const [a, b] = [current(tag), current(other)]
            await vocabulary.save({ ...a, sort: b.sort })
            await vocabulary.save({ ...b, sort: a.sort })
          }).then(draw)
        })
      }
      return button
    }
    const retire = h('button', 'quiet', tag.archived ? 'Restore' : 'Retire') as HTMLButtonElement
    retire.type = 'button'
    retire.addEventListener('click', () => {
      const now = current(tag)
      void attempt(() => vocabulary.save({ ...now, archived: !now.archived })).then(draw)
    })
    line.append(move(-1), move(1), retire)
    return line
  }

  /** The line under a kind where a new tag is typed. */
  function newRow(kind: Kind): HTMLElement {
    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'tag-field new'
    input.placeholder = 'New ' + kind + ' tag…'
    const create = (): void => {
      const label = input.value.trim()
      if (label === '') return
      void attempt(() => vocabulary.add(kind, label)).then(draw)
    }
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); create() }
    })
    input.addEventListener('blur', create)
    return input
  }

  function draw(): void {
    body.replaceChildren()
    for (const guide of KINDS) {
      const section = h('section', 'tag-kind')
      const head = h('div', 'pick-head')
      head.append(h('h4', '', guide.title), h('span', 'pick-asks', guide.asks))
      section.append(head, h('p', 'pick-means', guide.means))

      const all = vocabulary.all().filter((tag) => tag.kind === guide.kind)
      const live = all.filter((tag) => !tag.archived)
      for (const tag of live) section.append(row(tag, live))
      section.append(newRow(guide.kind))
      const retired = all.filter((tag) => tag.archived)
      if (retired.length > 0) {
        section.append(h('p', 'pick-means retired-head', 'Retired'))
        for (const tag of retired) section.append(row(tag, []))
      }
      body.append(section)
    }
  }

  dialog.addEventListener('close', () => {
    if (touched) changed()
    touched = false
  })
  must('tags-close').addEventListener('click', () => dialog.close())

  return {
    open() {
      status.textContent = ''
      status.className = 'saved'
      draw()
      dialog.showModal()
    },
  }
}
