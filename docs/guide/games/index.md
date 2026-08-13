# Game Guides

Step-by-step, screenshot-backed setups for specific games — everything you
need in one page per game: PC + phone setup, the phone button layout, the
emulator bindings, and the in-game calibration.

| Game                                       | Platform / Emulator       | Guide                       |
| ------------------------------------------ | ------------------------- | --------------------------- |
| **Time Crisis** — the genre's poster child | PlayStation → DuckStation | [Play it →](./time-crisis/) |

_More coming. Want one for your favorite? See below._

## MAME arcade lightgun games

For arcade classics (Point Blank, Area 51, Lethal Enforcers) no per-game
guide is needed — one command line does it:

```sh
mame <rom> -lightgun -lightgun_device mouse -offscreen_reload -lowlatency
```

- `-lightgun_device mouse` reads the absolute cursor point-bang drives.
- `-offscreen_reload` turns shots fired off-screen into the classic
  reload — combine it with aiming past the screen edge.
- In the MAME UI, map the trigger under **Input (this machine)** if the
  default mouse-button mapping doesn't take.

## Community guides, hacks and mods

Setups vary wildly — CRT filters, Sinden-style borders, gun-shell phone
grips, RetroArch cores, cabinet builds. **Community-driven guides, hacks
and mods are very welcome and will be linked right here in the docs.**
Write one, open a pull request (see
[Contributing](https://github.com/ggcaponetto/point-bang/blob/main/CONTRIBUTING.md)),
or open an issue with a link to your write-up.

| Guide                       | Author | Link           |
| --------------------------- | ------ | -------------- |
| _Your guide could be here!_ | —      | PRs welcome 🙂 |
