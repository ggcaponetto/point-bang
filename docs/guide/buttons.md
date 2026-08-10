# Buttons

`public/buttons.json` defines **20 assignable buttons**. Each entry has:

| Field     | Meaning                                                   |
| --------- | --------------------------------------------------------- |
| `id`      | Stable identifier sent over the wire (`fire`, `b1`…`b20`) |
| `label`   | Text shown on the phone                                   |
| `action`  | What the PC does — see below                              |
| `visible` | Whether the phone shows the button                        |

The phone renders the visible buttons in a scrollable strip during play; the
server maps the same file's ids to actions. One file, both sides.

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

## FIRE is a button too

The entry with id `"fire"` renders into the big red slot at the bottom of
the screen instead of the strip — but it's config like everything else.
Default action is `mouse:left`; remap it, relabel it, or hide it entirely.

::: info Why buttons trigger on touch-down
A `click` event fires when your finger comes **up**, silently adding your
whole tap duration (~100ms) to every shot. All point-bang buttons send on
`pointerdown` instead — shots register the moment you touch.
:::

## Applying changes

Edit `public/buttons.json`, restart the server, reload the phone page.
Invalid actions are reported at server start (`buttons: …`) and skipped —
a broken entry never takes the gun down.
