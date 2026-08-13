# Buttons

`public/buttons.json` defines **20 assignable buttons**. Each entry has:

| Field     | Meaning                                                             |
| --------- | ------------------------------------------------------------------- |
| `id`      | Stable identifier sent over the wire (`fire`, `b1`…`b20`)           |
| `label`   | Text shown on the phone                                             |
| `action`  | What the PC does — see below                                        |
| `visible` | Whether the phone shows the button                                  |
| `rect`    | _(optional)_ Where the phone places it — see **Placement**          |
| `vibrate` | _(optional)_ Haptic tick on press — see **Haptics**                 |
| `edge`    | _(optional)_ Screen edge that presses it — see **Off-screen edges** |
| `pad`     | _(optional)_ Physical gamepad button — see **Physical triggers**    |

The phone renders the visible buttons during play; the server maps the same
file's ids to actions. One file, both sides.

## The live editor

You rarely need to edit the JSON by hand: the server hosts a drag-and-drop
editor — the startup banner prints its URL
(`Edit: open http://localhost:8443/editor.html …`, open it **on the PC**).
Drag buttons around a phone-shaped canvas, resize them by their corners,
remap labels/actions/vibration/edges/gamepad buttons, and turn unused
(hidden) slots into new buttons with **＋ add button**. Problems are shown
live with the exact messages the server would log, and Save is disabled
until the config is clean.

**Save applies everywhere immediately**: the file is rewritten atomically,
the PC remaps actions without a restart, and a connected phone re-renders
its overlay mid-session — no recalibration, no page reload.

## Placement

A button with a `rect` is placed at that position, sized to match:

```json
{
  "id": "fire",
  "label": "LEFT",
  "action": "mouse:left",
  "visible": true,
  "rect": { "x": 2, "y": 30, "w": 44, "h": 30 }
}
```

`x,y,w,h` are **percent of the screen**, origin top-left (`x:2, w:44` spans
the left half, minus margins). Rects that hang off the edge are clamped back
on; a malformed rect is reported at server start and the button falls into
the strip instead.

The default layout is two big half-width buttons for **LEFT** and **RIGHT**
mouse click, with smaller **A** and **B** buttons above them (`key:a` /
`key:b`) — hide those by flipping `visible` to `false`. Buttons **without** a
`rect` line up in a scrollable strip near the bottom, so the pre-placement
config keeps working unchanged.

## Actions

```
"key:r"              press/release the R key
"key:ctrl+shift+f"   combos — modifiers first
"key:1" / "key:f4"   digits and f1–f24 work
"mouse:left"         also mouse:right, mouse:middle
""                   unassigned (button does nothing PC-side)
```

Every button sends **down and up as separate events**: touching presses,
letting go releases. Holds, rapid fire and duck-style mechanics all behave.
Combos release in reverse order (`ctrl+shift+f` releases `f`, `shift`,
`ctrl`).

## Haptics

Every button gives a very short vibration tick when touched — a trigger
click, deliberately nothing like a notification buzz. Control it per button
with `vibrate`:

```json
"vibrate": false    silence this button
"vibrate": 5        custom pulse length in ms (capped at 100)
"vibrate": true     the default 10ms tick (same as leaving it out)
```

The pulse fires on touch-down only, and a new press cancels the previous
pulse, so rapid fire stays crisp. Two things worth knowing: iOS Safari has no
vibration API, so it's a silent no-op there; and the vibration motor shakes
the same phone the AR tracking runs on — if your aim visibly wobbles when
firing, shorten the pulse or set `"vibrate": false` on the trigger.

## Off-screen edges

Assign a button to a screen edge and it presses when you **aim past that
edge** — the classic Time Crisis reload/duck, generalized to all four edges:

```json
{ "id": "b4", "label": "RELOAD", "action": "key:r", "visible": false, "edge": "bottom" }
```

Hold your aim past the edge for ~150ms and the button goes **down**; the
moment your aim comes back on screen (or is lost) it releases — so
duck-and-hold mechanics work naturally. The margin is generous enough that
ordinary shots near the screen border (and the bezels between monitors in
`--monitor all`) never false-trigger.

`"edge": "any"` fires the button on **every** edge — the classic "point
anywhere off screen to reload". Several buttons may share an edge (they
press and release together, exactly like two buttons on the same gamepad
index), and an `any` button fires alongside a specific-edge one. The button
does **not** need to be `visible` — an edge-only reload needs no spot on
the screen. In the editor it's the "off-screen edge" dropdown.

## Physical triggers (Bluetooth)

Pair a Bluetooth gamepad — or a one-button clicker — with the **phone**, and
map its buttons with `pad`:

```json
"pad": 0        this gamepad button index presses the button
"pad": "any"    EVERY physical button presses it (one-button clickers)
```

Devices expose different button layouts, so the phone HUD shows the index of
the last physical press (`pad 3`) — press your trigger once, read the
number, put it in the config. `"any"` skips even that: whatever the clicker
reports, it fires. Presses and releases pass through separately, so a held
physical trigger holds the action. This uses the browser Gamepad API; a
device that pairs as a _keyboard_ instead of a gamepad won't be seen.

## FIRE is a button too

The entry with id `"fire"` is the trigger: it keeps its red styling wherever
its `rect` puts it (by default it IS the big LEFT button), and without a
`rect` it renders into the big red slot at the bottom of the screen instead
of the strip — but it's config like everything else. Default action is
`mouse:left`; remap it, relabel it, or hide it entirely.

::: info Why buttons trigger on touch-down
A `click` event fires when your finger comes **up**, silently adding your
whole tap duration (~100ms) to every shot. All point-bang buttons send on
`pointerdown` instead — shots register the moment you touch.
:::

## Applying changes

The editor's **Save** applies everything live — server and phone, no
restarts. Editing `public/buttons.json` by hand still works: the phone picks
the file up on its next page load, and the PC's action map on the next server
start. Invalid actions are reported (`buttons: …`) and skipped — a broken
entry never takes the gun down, and the editor refuses to save one at all.

In the single-executable build the live config lives in a `buttons.json`
**next to the executable** (created by the first editor save); until it
exists, the copy baked into the binary serves. `--buttons <file>` points both
sides at any explicit file.
