---
version: 1
slug: "src-web-app-tsx"
primary_target: "src/web/App.tsx"
related_targets: ["src/tools/gif/ui.tsx"]
---

# Surface: the tools app (home sheet + Video to GIF waybill)

Scope: whole app shell, home page and the GIF converter. Visitor mode: Operate.

Audience and job: a developer mid-task who needs a file converted now. Task path: drop, adjust, convert, see the real result, save. Constraints: offline, Windows, one file at a time, fonts self-hosted.

## Direction contract

THESIS: Every conversion is a parcel. A tool is a shipping label that reads FROM a format TO a format; the converter is its waybill, and the result prints out as a finished label with real dimensions and weight. Refuses the online-converter arrangement of identical icon cards over a white page with one blue button.

OWN-WORLD: White label stock on a pale release-liner ground, thermal black ink, one safety orange used only for the primary action, handles and live state. 2px black rules divide every label into field boxes; small caps field legends sit top-left of each box; values are set large. Labels have 10px die-cut corners and sit in a sheet with even gutters. Solid black routing blocks carry white type. Archivo at condensed width and heavy weight for format codes and headings, Archivo normal width for UI, Azeret Mono for measured values.

STORY: The visitor sees which tool is live, opens it (or drops a file straight onto its label), declares trim, dimensions and optional max size, converts, checks the printed result, and saves it through the native dialog.

FIRST VIEWPORT: Home is a label sheet. The live Video to GIF label fills the left seven of twelve columns: a FROM box and a TO box across the top with MP4 and GIF at 6rem condensed black, the TO box inverted black, then name and tagline, then an ACCEPTS box beside a full-height orange Open block. Four planned tools fill the right five columns as smaller unprinted labels, each stamped Planned. A thin header label carries the wordmark and the local address.

FORM: Courier waybills and thermal shipping labels; position 3 of 7 on the grounded list; seed key 648e75b8. Raises: format codes at poster scale in one face at several sizes (from the bitmap specimen); layout snaps to whole label cells with the ruling visible (from the grid specimen); the trim bar draws the selected span to scale so length is duration (from the dance score). Signature interaction: on Convert, the result label prints: a black print line wipes across the blank label with progress, then the fields ink in. Motion grammar: 150 to 220ms ease-out state changes only; nothing animates on load.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Unresolved: none.
