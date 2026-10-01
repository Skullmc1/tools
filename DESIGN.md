# Design

The look of `tools` is a shipping label. Every tool converts FROM one format TO another, so every tool is a label, and the converter is its waybill. New tools must use this system as it is; do not introduce a second look.

## Palette

Defined in `src/web/styles.css` under `@theme`.

| Token | Value | Use |
|---|---|---|
| `liner` | `#e3e3db` | Page ground: the backing sheet that shows between labels |
| `stock` | `#fbfbf7` | Label surface |
| `ink` | `#0d0d0d` | Text, 2px rules, inverted blocks |
| `ink-soft` | `#55554f` | Secondary text |
| `blank` | `#b4b4ab` | Rules of unprinted (planned or disabled) labels |
| `signal` | `#ff4f00` | Fill only: primary action, slider handles, playhead, focus ring |
| `signal-ink` | `#b83800` | Orange as text or icon on stock (the fill colour fails contrast as text) |

Orange is never decoration. One orange block per label at most.

## Type

Self-hosted, declared by hand in `styles.css` (see the comment there).

- **Archivo Variable**, condensed (`font-stretch: 62%`, weight 900, uppercase): format codes, headings, the big action block. Class `.code`.
- **Archivo Variable**, normal width: all interface text and buttons.
- **Azeret Mono Variable**: measured values only (sizes, dimensions, times, paths, the local address). Class `.value`.
- Field captions: 12px, bold, uppercase, tracked. Class `.legend`. They caption a value in a box; they are never placed above a heading.

## Components

- **`.label`**: a grid on an ink ground with 2px gaps, 2px ink border, 10px corners. Children are `.box` (stock) or `.box-inverse` (ink). The gaps are the printed rules; do not add borders inside a label.
- **Planned label**: same structure with `border-blank bg-blank`, grey codes, and a `.stamp`.
- **`.btn`** / **`.btn-primary`**: 2px ink border, 4px corners; hover inverts to ink. Primary is orange.
- **Action block**: a label cell filled orange with `.code` text (Open, Convert). Hover inverts to ink.
- **`.segmented`**: one-of-many choice as a row of cells; selected cell is ink.
- **`.input`**, **`.range`**: mono numerals, ink border; the range thumb is an orange grip.
- **TrimBar**: timeline drawn to scale. Selected span is solid ink, ends are orange grips, playhead is an orange line.
- **PrintProgress** (`components/PrintProgress.tsx`): the progress label for any job. A black print line wipes across for measurable progress; for a stage with no honest percentage (`indeterminate`), a black bar sweeps back and forth and no number is shown.
- **SaveBox** and `useSaveFlow` (`components/SaveBox.tsx`): the Save as… button with where the file went and Show in folder. Every tool that produces a file uses it.
- **`.checker`**: the transparency checkerboard, in label tones. Used behind cut-out images; the backdrop can be switched to white, black or orange to judge edges.
- **DropZone** takes an optional `note` box above Accepts for anything worth knowing before dropping a file (for example a one-time model download).
- Icons: `src/web/components/icons.tsx`, 2.5px square-cap strokes on a 24 grid. Add new ones there in the same style.

## Layout

- Page max width 88rem; labels sit in a 12-column grid with 12px gutters (the die-cut sheet).
- Tool pages: source on the left (7 columns), settings on the right (5), result label full width below. One column under `lg`.
- Home: the live tool's label takes 7 columns with codes at poster scale; planned tools fill the other 5.

## States and motion

- Drag-over inverts the target to ink. Disabled controls drop to `blank` rules and `ink-soft` text.
- Errors: an alert icon in `signal-ink` beside plain text that names the problem and what to do.
- Progress: a black print line wipes across the blank result label (`.print-fill`), then the result inks in (`.ink-in`).
- Transitions are 150 to 220ms ease-out and only mark state changes. Nothing animates on load. `prefers-reduced-motion` turns them off.
- Focus ring: 3px orange, 2px offset (ink on orange surfaces).
