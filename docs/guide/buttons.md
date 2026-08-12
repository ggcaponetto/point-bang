# Buttons

`public/buttons.json` defines **20 assignable buttons**. Each entry has:

| Field     | Meaning                                                    |
| --------- | ---------------------------------------------------------- |
| `id`      | Stable identifier sent over the wire (`fire`, `b1`…`b20`)  |
| `label`   | Text shown on the phone                                    |
| `action`  | What the PC does — see below                               |
| `visible` | Whether the phone shows the button                         |
| `rect`    | _(optional)_ Where the phone places it — see **Placement** |
| `vibrate` | _(optional)_ Haptic tick on press — see **Haptics**        |

The phone renders the visible buttons during play; the server maps the same
file's ids to actions. One file, both sides.

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

Edit `public/buttons.json`, restart the server, reload the phone page.
Invalid actions are reported at server start (`buttons: …`) and skipped —
a broken entry never takes the gun down.
