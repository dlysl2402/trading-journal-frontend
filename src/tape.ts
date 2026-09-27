/**
 * The tape: a trade's recording, played where you review it.
 *
 * The recording is the trade as it happened — the replay, or the highlight
 * reel cut from it — so it leads the tab, and everything written about the
 * trade can point back into it.
 * A moment in a note, `[0:26]`, is a place on this tape: it is drawn as a
 * mark on the scrubber, and clicking either one plays from there. M marks
 * one: the tape stops where it is and the time goes into the note with the
 * caret after it, ready for what you saw. That is film study — stop at the
 * entry and say what you saw, stop at the exit and say what you would do
 * again — made one key.
 *
 * The controls are the page's own rather than the browser's, for two things
 * the browser's cannot do: carry the marks, and answer keys pressed anywhere
 * on the tab. The keys are a video editor's: K or space to play, J and L five
 * seconds back and on, comma and full stop a frame at a time, < and > for
 * the speed, F for full screen, 0 to 9 for a tenth of the way through. The
 * speed is kept for this browser, because a session of reviews is watched at
 * one speed.
 *
 * The clips are asked for as the tab is drawn, not as the page loads: a trade
 * you never open never costs a request, and a signed URL outlives any tab.
 * The player fetches only what it plays, enough to learn the length and then
 * the stretches you watch or scrub to, so a long recording opens at once and
 * is never downloaded whole.
 *
 * Adding one is a single request carrying the whole file, with a bar that
 * fills as it goes, because a long recording on a home uplink takes minutes.
 * It is not waited for the way a save is: closing the tab or stepping to the
 * next trade stops showing it, not sending it, and the clip is there the next
 * time this trade is opened.
 */

import { h } from './dom.ts'
import type { IconName } from './icons.ts'
import { icon } from './icons.ts'
import { timecode } from './notes.ts'
import type { Clip } from './store.ts'

/** How far J and L move the tape, in seconds. */
const NUDGE = 5

/**
 * One frame, near enough, for comma and full stop. A recording does not say
 * its frame rate, and a thirtieth of a second is one frame at 30 and two at 60.
 */
const FRAME = 1 / 30

const SPEEDS = [0.5, 1, 1.5, 2, 3]

/** Where the speed is kept: this browser's, not the record's. */
const SPEED_KEY = 'journal:tape-speed'

/** The bucket takes MP4 and nothing else; saying so first saves a minute of uploading. */
const MP4 = 'video/mp4'

/** A moment is lit from a little before it, so a seek that lands on the second lights it. */
const EARLY = 0.25

/** A place on the tape that a note points at. */
export interface Moment {
  seconds: number
  /** The words beside it in the note. */
  label: string
}

/** What the tape needs from the tab it is drawn in. */
export interface TapeContext {
  clips: () => Promise<Clip[]>
  addClip: (file: File, progress: (fraction: number) => void) => Promise<void>
  /**
   * Put a moment into the note. Quietly — no caret — when the note is out of
   * sight behind a full-screen tape, so the marks gather to be written up after.
   */
  mark: (seconds: number, quiet: boolean) => void
  /** Where the tape is as it plays; null while there is nothing to play. */
  at: (seconds: number | null) => void
}

export interface Tape {
  node: HTMLElement
  /** A key pressed on the tab while nothing was being typed; true if the tape took it. */
  key: (event: KeyboardEvent) => boolean
  /** Where the tape is, or null with nothing loaded. */
  now: () => number | null
  /** Play from a moment. */
  seek: (seconds: number) => void
  /** The moments the note points at, to draw on the scrubber. */
  moments: (list: Moment[]) => void
  /** Stop, because the tab is going out of sight — unless the tape has been popped out of it. */
  pause: () => void
  /** Put a recording on the tape: one picked, or one dropped anywhere on the tab. */
  add: (file: File) => void
}

function storedSpeed(): number {
  try {
    const stored = Number(localStorage.getItem(SPEED_KEY))
    return SPEEDS.includes(stored) ? stored : 1
  } catch {
    // Blocked storage: the speed starts at one every time.
    return 1
  }
}

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export function createTape(context: TapeContext): Tape {
  const root = h('section', 'card tape')
  root.setAttribute('aria-label', 'Recording')

  const control = (name: IconName, tip: string): HTMLButtonElement => {
    const button = h('button', 'tape-btn') as HTMLButtonElement
    button.type = 'button'
    label(button, name, tip)
    return button
  }
  function label(button: HTMLButtonElement, name: IconName, tip: string): void {
    button.replaceChildren(icon(name))
    button.dataset.tip = tip
    button.setAttribute('aria-label', tip)
  }

  // ── the screen ───────────────────────────────────────────────────────────

  const screen = h('div', 'screen')
  const video = document.createElement('video')
  video.preload = 'metadata'
  video.playsInline = true
  // Before the first play, one large button in the middle says what to do.
  const start = h('button', 'screen-play') as HTMLButtonElement
  start.type = 'button'
  start.setAttribute('aria-label', 'Play')
  start.append(icon('play'))
  // What the screen says when there is nothing to play: none yet, loading, or why not.
  const cover = h('div', 'screen-cover')
  const first = h('button', 'btn secondary small') as HTMLButtonElement
  first.type = 'button'
  first.append(icon('upload'), 'Add recording')
  screen.append(video, start, cover)

  // A trade with more than one recording picks between them here.
  const reels = h('div', 'reels')
  reels.setAttribute('role', 'group')
  reels.setAttribute('aria-label', 'Recordings')

  // ── the controls ─────────────────────────────────────────────────────────

  const bar = h('div', 'controls')
  const play = control('play', 'Play (K)')
  play.classList.add('solid')
  const time = h('span', 'tape-time')

  const scrub = h('div', 'scrub')
  scrub.tabIndex = 0
  scrub.setAttribute('role', 'slider')
  scrub.setAttribute('aria-label', 'Position')
  scrub.setAttribute('aria-valuemin', '0')
  const rail = h('div', 'scrub-rail')
  const loaded = h('i', 'scrub-loaded')
  const played = h('i', 'scrub-played')
  rail.append(loaded, played)
  const thumb = h('span', 'scrub-thumb')
  const ticks = h('div', 'scrub-ticks')
  const hover = h('span', 'scrub-hover')
  hover.hidden = true
  scrub.append(rail, ticks, thumb, hover)

  const speed = h('button', 'tape-btn tape-speed') as HTMLButtonElement
  speed.type = 'button'
  speed.dataset.tip = 'Speed (< >)'
  const mark = control('flag', 'Mark this moment (M)')
  const sound = control('volume', 'Mute')
  sound.classList.add('extra')
  const pop = control('pop-out', 'Pop out')
  pop.classList.add('extra')
  pop.hidden = !document.pictureInPictureEnabled
  const full = control('maximize', 'Full screen (F)')
  full.hidden = !document.fullscreenEnabled
  const add = control('upload', 'Add recording')
  bar.append(play, time, scrub, speed, mark, sound, pop, full, add)

  // An upload in progress, or how the last one went.
  const status = h('div', 'upload')
  status.hidden = true
  const progress = h('div', 'progress')
  const fillBar = h('i')
  progress.append(fillBar)
  const words = h('span', 'saved')
  status.append(progress, words)

  const input = document.createElement('input')
  input.type = 'file'
  input.accept = MP4
  input.hidden = true

  root.append(reels, screen, bar, status, input)

  // ── what is loaded ───────────────────────────────────────────────────────

  let clips: Clip[] = []
  /** The clip on the screen, by its place in `clips`; −1 for none. */
  let current = -1
  let marks: Moment[] = []
  /** A moment just marked, so its mark on the scrubber can arrive with a flash. */
  let fresh: number | null = null
  /** Whether this clip has been played at all, which is what the large button waits for. */
  let started = false
  let rate = storedSpeed()

  const ready = (): boolean => current >= 0
  /** The clip's length, or zero until the browser knows it. */
  const length = (): number => (Number.isFinite(video.duration) ? video.duration : 0)

  /** The screen and controls for one state of the tape. */
  function show(state: 'loading' | 'empty' | 'failed' | 'ready', message = ''): void {
    root.classList.toggle('bare', state !== 'ready')
    bar.hidden = video.hidden = state !== 'ready'
    cover.hidden = state === 'ready'
    cover.dataset.state = state
    cover.replaceChildren()
    if (state === 'loading') cover.append(h('div', 'spinner'))
    if (state === 'empty') cover.append(icon('video', 'icon cover-icon'), first)
    if (state === 'failed') cover.append(icon('alert', 'icon cover-icon'), h('p', '', message))
    drawPlay()
  }

  /** Where the tape is, drawn on the scrubber and the clock. */
  function draw(): void {
    const at = video.currentTime, total = length()
    const fraction = total > 0 ? Math.min(1, at / total) : 0
    played.style.width = thumb.style.left = fraction * 100 + '%'
    time.textContent = total > 0 ? timecode(at) + ' / ' + timecode(total) : timecode(at)
    scrub.setAttribute('aria-valuemax', String(Math.floor(total)))
    scrub.setAttribute('aria-valuenow', String(Math.floor(at)))
    scrub.setAttribute('aria-valuetext', timecode(at) + ' of ' + timecode(total))

    // How far the browser has fetched from where it is playing.
    let end = 0
    for (let i = 0; i < video.buffered.length; i++) {
      if (video.buffered.start(i) <= at + 0.5) end = Math.max(end, video.buffered.end(i))
    }
    loaded.style.width = (total > 0 ? Math.min(1, end / total) : 0) * 100 + '%'
    light()
  }

  /** The last mark the tape has reached is the one on screen. */
  function light(): void {
    const at = video.currentTime + EARLY
    let lit: HTMLElement | null = null
    for (const tick of ticks.children) {
      if (tick instanceof HTMLElement && Number(tick.dataset.seconds) <= at) lit = tick
    }
    for (const tick of ticks.children) tick.classList.toggle('now', tick === lit)
  }

  /** The note's moments as marks along the scrubber, each a way to play from there. */
  function drawTicks(): void {
    const total = length()
    ticks.replaceChildren()
    if (total > 0) {
      for (const moment of marks) {
        if (moment.seconds > total) continue
        const tick = h('button', 'scrub-pin') as HTMLButtonElement
        tick.type = 'button'
        tick.style.left = (moment.seconds / total) * 100 + '%'
        tick.dataset.seconds = String(moment.seconds)
        const said = moment.label === '' ? '' : ' · ' + (moment.label.length > 90 ? moment.label.slice(0, 89) + '…' : moment.label)
        tick.dataset.tip = timecode(moment.seconds) + said
        tick.setAttribute('aria-label', 'Play from ' + timecode(moment.seconds) + said)
        if (moment.seconds === fresh) tick.classList.add('fresh')
        // A mark is a button of its own, not a place to start dragging from.
        tick.addEventListener('pointerdown', (event) => { event.stopPropagation() })
        tick.addEventListener('click', () => { seek(moment.seconds) })
        ticks.append(tick)
      }
    }
    fresh = null
    light()
  }

  function drawPlay(): void {
    const paused = video.paused || video.ended
    label(play, paused ? 'play' : 'pause', paused ? 'Play (K)' : 'Pause (K)')
    root.classList.toggle('playing', !paused)
    start.hidden = !ready() || started || !paused
  }

  function drawReels(): void {
    reels.hidden = clips.length < 2
    reels.replaceChildren(...clips.map((clip, index) => {
      const pick = h('button', 'reel', clip.name) as HTMLButtonElement
      pick.type = 'button'
      pick.setAttribute('aria-pressed', String(index === current))
      pick.addEventListener('click', () => { if (index !== current) choose(index) })
      return pick
    }))
  }

  /** Put one clip on the screen. */
  function choose(index: number): void {
    const clip = clips[index]!
    const changed = current !== index || video.getAttribute('src') !== clip.url
    current = index
    drawReels()
    if (changed) {
      video.pause()
      video.src = clip.url
      started = false
    }
    // A new source starts at the default rate, so the kept speed is set as both.
    video.defaultPlaybackRate = video.playbackRate = rate
    show('ready')
    draw()
    drawTicks()
    context.at(video.currentTime)
  }

  /** Every clip the trade's folder holds now, showing `pick` if it names one. */
  async function fill(pick?: string): Promise<void> {
    clips = await context.clips()
    if (clips.length === 0) {
      current = -1
      drawReels()
      show('empty')
      context.at(null)
      return
    }
    const wanted = pick === undefined ? -1 : clips.findIndex((clip) => clip.name === pick)
    choose(wanted >= 0 ? wanted : Math.min(Math.max(current, 0), clips.length - 1))
  }

  // ── playing ──────────────────────────────────────────────────────────────

  function toggle(): void {
    if (!ready()) return
    // A play the browser refuses, or one a pause overtakes, is not worth a word.
    if (video.paused || video.ended) video.play().catch(() => {})
    else video.pause()
  }

  /** Move the tape by some seconds, playing or not as it was. */
  function move(by: number): void {
    if (!ready()) return
    to(video.currentTime + by)
  }

  function to(seconds: number): void {
    const total = length()
    video.currentTime = Math.max(0, total > 0 ? Math.min(seconds, total) : seconds)
    draw()
  }

  function seek(seconds: number): void {
    if (!ready()) return
    to(seconds)
    video.play().catch(() => {})
  }

  function frame(by: number): void {
    if (!ready()) return
    video.pause()
    move(by * FRAME)
  }

  function setSpeed(next: number): void {
    rate = next
    video.defaultPlaybackRate = video.playbackRate = next
    speed.textContent = next + '×'
    try {
      localStorage.setItem(SPEED_KEY, String(next))
    } catch {
      // Blocked storage: the speed lasts as long as the page.
    }
  }

  /** One step faster or slower, stopping at either end. */
  function faster(by: 1 | -1): void {
    const at = SPEEDS.indexOf(rate)
    setSpeed(SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (at < 0 ? 1 : at) + by))]!)
  }

  const onScreen = (): boolean => document.fullscreenElement === root

  function fullScreen(): void {
    if (onScreen()) void document.exitFullscreen()
    else if (document.fullscreenEnabled) root.requestFullscreen().catch(() => {})
  }

  /**
   * Mark where the tape is. It stops there so what you write is about what
   * is on the screen — except full screen, or with shift, where it plays on
   * and the marks wait in the note to be written up.
   */
  function markHere(quiet: boolean): void {
    if (!ready()) return
    const away = quiet || onScreen()
    if (!away) video.pause()
    fresh = Math.floor(video.currentTime)
    context.mark(fresh, away)
  }

  // ── wiring ───────────────────────────────────────────────────────────────

  /** While it plays, the scrubber is drawn every frame rather than four times a second. */
  let frameId = 0
  const follow = (): void => {
    draw()
    frameId = video.paused ? 0 : requestAnimationFrame(follow)
  }

  video.addEventListener('play', () => {
    started = true
    drawPlay()
    if (frameId === 0) frameId = requestAnimationFrame(follow)
  })
  video.addEventListener('pause', drawPlay)
  video.addEventListener('ended', drawPlay)
  video.addEventListener('timeupdate', () => { context.at(video.currentTime) })
  video.addEventListener('seeked', () => { draw(); context.at(video.currentTime) })
  video.addEventListener('loadedmetadata', () => { draw(); drawTicks() })
  video.addEventListener('durationchange', () => { draw(); drawTicks() })
  video.addEventListener('progress', draw)
  video.addEventListener('ratechange', () => { speed.textContent = video.playbackRate + '×' })
  video.addEventListener('volumechange', () => {
    label(sound, video.muted ? 'volume-off' : 'volume', video.muted ? 'Unmute' : 'Mute')
  })
  video.addEventListener('error', () => {
    if (!ready()) return
    show('failed', 'This recording would not play here.')
    context.at(null)
  })
  video.addEventListener('click', toggle)
  video.addEventListener('dblclick', fullScreen)
  start.addEventListener('click', toggle)

  play.addEventListener('click', toggle)
  mark.addEventListener('click', () => { markHere(false) })
  sound.addEventListener('click', () => { video.muted = !video.muted })
  full.addEventListener('click', fullScreen)
  pop.addEventListener('click', () => {
    if (document.pictureInPictureElement === video) void document.exitPictureInPicture()
    else video.requestPictureInPicture().catch(() => {})
  })
  speed.addEventListener('click', (event) => {
    // Round and round on a click; with shift, the other way.
    const at = Math.max(0, SPEEDS.indexOf(rate))
    setSpeed(SPEEDS[(at + (event.shiftKey ? -1 : 1) + SPEEDS.length) % SPEEDS.length]!)
  })
  root.addEventListener('fullscreenchange', () => {
    root.classList.toggle('full', onScreen())
    label(full, onScreen() ? 'minimize' : 'maximize', onScreen() ? 'Leave full screen (F)' : 'Full screen (F)')
  })

  // The scrubber: press anywhere to go there, drag to look for a moment.
  const fractionAt = (x: number): number => {
    const box = rail.getBoundingClientRect()
    return box.width > 0 ? Math.max(0, Math.min(1, (x - box.left) / box.width)) : 0
  }
  function hoverAt(x: number): void {
    if (length() <= 0) return
    const fraction = fractionAt(x)
    hover.hidden = false
    hover.textContent = timecode(fraction * length())
    hover.style.left = fraction * 100 + '%'
  }
  let dragging = false
  scrub.addEventListener('pointerdown', (event) => {
    if (!ready() || length() <= 0 || event.button !== 0) return
    event.preventDefault()
    scrub.focus({ preventScroll: true })
    scrub.setPointerCapture(event.pointerId)
    dragging = true
    const resume = !video.paused
    video.pause()
    to(fractionAt(event.clientX) * length())
    const moved = (next: PointerEvent): void => {
      to(fractionAt(next.clientX) * length())
      hoverAt(next.clientX)
    }
    const done = (): void => {
      dragging = false
      hover.hidden = true
      scrub.removeEventListener('pointermove', moved)
      scrub.removeEventListener('pointerup', done)
      scrub.removeEventListener('pointercancel', done)
      if (resume) video.play().catch(() => {})
    }
    scrub.addEventListener('pointermove', moved)
    scrub.addEventListener('pointerup', done)
    scrub.addEventListener('pointercancel', done)
  })
  scrub.addEventListener('pointermove', (event) => {
    if (dragging || event.pointerType !== 'mouse') return
    // Over a mark, its own tooltip says where it is.
    if (event.target instanceof Element && event.target.closest('.scrub-pin') !== null) hover.hidden = true
    else hoverAt(event.clientX)
  })
  scrub.addEventListener('pointerleave', () => { if (!dragging) hover.hidden = true })
  scrub.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    // The arrows move along the tape here, not to the next trade.
    event.preventDefault()
    event.stopPropagation()
    if (!ready()) return
    if (event.key === 'ArrowLeft') move(-NUDGE)
    else if (event.key === 'ArrowRight') move(NUDGE)
    else to(event.key === 'Home' ? 0 : length())
  })

  // ── adding a recording ───────────────────────────────────────────────────

  function say(state: 'working' | 'done' | 'failed', text: string): void {
    status.hidden = false
    words.className = 'saved ' + state
    words.replaceChildren()
    if (state === 'done') words.append(icon('check'))
    if (state === 'failed') words.append(icon('alert'))
    words.append(text)
  }

  function addFile(file: File): void {
    if (file.type !== MP4 && file.type !== '') {
      progress.hidden = true
      say('failed', file.name + ' is not an MP4.')
      return
    }
    add.disabled = first.disabled = true
    progress.hidden = false
    fillBar.style.width = '0%'
    say('working', 'Uploading ' + file.name + '…')
    context.addClip(file, (fraction) => {
      fillBar.style.width = Math.floor(fraction * 100) + '%'
      say('working', `Uploading ${file.name}… ${Math.floor(fraction * 100)}%`)
    })
      .then(() => fill(file.name))
      .then(() => {
        progress.hidden = true
        say('done', 'Added ' + file.name)
      })
      .catch((error: unknown) => {
        progress.hidden = true
        say('failed', reason(error))
      })
      .finally(() => { add.disabled = first.disabled = false })
  }

  add.addEventListener('click', () => input.click())
  first.addEventListener('click', () => input.click())
  input.addEventListener('change', () => {
    const file = input.files?.[0]
    // Cleared so the same file, picked again after a refusal, counts as a pick.
    input.value = ''
    if (file !== undefined) addFile(file)
  })

  speed.textContent = rate + '×'
  show('loading')
  fill().catch((error: unknown) => { show('failed', reason(error)) })

  return {
    node: root,

    key(event) {
      if (!ready()) return false
      switch (event.key) {
        case ' ': case 'k': case 'K': toggle(); return true
        case 'j': case 'J': move(-NUDGE); return true
        case 'l': case 'L': move(NUDGE); return true
        case ',': frame(-1); return true
        case '.': frame(1); return true
        case '<': faster(-1); return true
        case '>': faster(1); return true
        case 'f': case 'F': fullScreen(); return true
        case 'm': case 'M': markHere(event.shiftKey); return true
      }
      if (/^[0-9]$/.test(event.key) && length() > 0) {
        to(Number(event.key) / 10 * length())
        return true
      }
      return false
    },

    now: () => (ready() ? video.currentTime : null),
    seek,

    moments(list) {
      marks = [...list].sort((a, b) => a.seconds - b.seconds)
      drawTicks()
    },

    pause() {
      if (document.pictureInPictureElement !== video) video.pause()
    },

    add: addFile,
  }
}
