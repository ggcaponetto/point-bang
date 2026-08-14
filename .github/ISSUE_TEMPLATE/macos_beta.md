---
name: macOS beta report
about: Verify point-bang on your Mac — this checklist is how macOS support gets confirmed
title: "macOS beta: "
labels: macos-beta
---

macOS support is community-verified: every release is built and smoke-tested
on real macOS CI (Apple Silicon and Intel), but end-to-end aim needs real
hands and a real Mac. Work through the steps and paste what you see —
partial reports are welcome.

**Mac model + macOS version:**

**1. Download & unquarantine** — from
[Releases](https://github.com/ggcaponetto/point-bang/releases), then:

```sh
xattr -d com.apple.quarantine ./point-bang-*-macos-*
chmod +x ./point-bang-*-macos-*
```

Did the binary start? (If "zsh: killed" or a Gatekeeper dialog, say so.)

**2. `./point-bang check`** — paste the full output:

**3. `./point-bang monitors`** — paste the output (points, not pixels, is
expected on Retina):

**4. `./point-bang wifi`** — paste the output:

**5. Serve + calibrate** — run `./point-bang`, scan the QR with an ARCore
Android phone, calibrate the three corners. Did calibration complete?

**6. Aim** — grant **Accessibility** when macOS asks (System Settings →
Privacy & Security). Does the PC cursor follow your aim? Do taps click?

**7. Pause hotkey** — press `shift+s` on the Mac keyboard mid-session.
Does the terminal print the pause/resume line? If not, does granting
**Input Monitoring** to your terminal fix it? (Both answers are valuable.)

**8. Jitter** — paste a few of the `jitter p50/p95` lines the server prints
while you aim:

**Anything else** — permission prompts you didn't expect, feel of the aim,
things the docs got wrong:
