---
layout: home

hero:
  name: point-bang
  text: Your phone is the lightgun.
  tagline: >
    WebXR aim tracking on your phone, absolute cursor input on your PC.
    No custom hardware, no markers, no sensor bars — just Time Crisis.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/ggcaponetto/point-bang

features:
  - icon: 🎯
    title: Absolute aim, top-class latency
    details: >
      ARCore's visual-inertial tracking gives drift-free 6DoF aim,
      intersected with a one-time-calibrated screen plane and delivered
      through a 2ms newest-wins cursor loop — with live p50/p95 jitter
      stats to prove it.
  - icon: 🔌
    title: Zero hardware
    details: >
      A Node server and your Android phone's Chrome. USB cable or the same
      WiFi network — both first-class, one command each.
  - icon: 🕹️
    title: 20 assignable buttons, edited live
    details: >
      A drag-and-drop editor maps buttons to any key combo or mouse button —
      applied to the PC and phone instantly, mid-session. Assign a screen
      edge (aim off-screen to reload, arcade-style) or a Bluetooth trigger
      to any of them.
  - icon: 🖥️
    title: Multi-monitor support
    details: >
      Aim at one display or span them all — each monitor is calibrated as
      its own plane, so bezels and angled panels stay pixel-accurate, with
      independent aim correction per screen.
  - icon: 🧪
    title: Tested to 90%+
    details: >
      TypeScript run natively by Node — no build step — with vitest enforcing
      90% coverage on every metric, prettier, knip and husky gates.
  - icon: 📐
    title: Calibrates on any screen
    details: >
      Aim at three corners, two taps each — the recommended two-ray method
      needs no trackable surface at all. Anchor-pinned hit-test mode, which
      keeps refining as ARCore learns the room, is one toggle away.
---
