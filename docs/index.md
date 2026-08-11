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
    title: Absolute aim, gyro-class latency
    details: >
      ARCore's visual-inertial tracking fuses IMU at high rate and corrects with
      the camera — drift-free 6DoF aim at ~15–30ms phone-side, intersected with
      a one-time-calibrated screen plane.
  - icon: 🔌
    title: Zero hardware
    details: >
      A Node server and your Android phone's Chrome. USB cable for the lowest
      jitter, or the same WiFi network — both first-class, one command each.
  - icon: 🕹️
    title: 20 assignable buttons
    details: >
      A JSON file maps on-screen buttons to any key combo or mouse button,
      press-and-hold included. FIRE itself is just a button — remap it freely.
  - icon: ⚡
    title: Latency-obsessed
    details: >
      One Euro filtering phone-side, a 2ms newest-wins cursor loop, optional
      aim extrapolation, and p50/p95 jitter stats printed live. Every stage
      measured, every default justified.
  - icon: 🧪
    title: Tested to 90%+
    details: >
      TypeScript run natively by Node — no build step — with vitest enforcing
      90% coverage on every metric, prettier, knip and husky gates.
  - icon: 📐
    title: Self-correcting calibration
    details: >
      Three corner captures with WebXR anchors that keep refining as ARCore
      learns the room; two-ray fallback when the screen defeats hit-testing.
---
