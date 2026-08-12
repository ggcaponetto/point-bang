**What does this change?**

**Checklist**

- [ ] `npm run validate` passes locally (prettier, typecheck, knip, tests ≥90% coverage)
- [ ] New logic has tests; platform-specific code is behind injectables (works on Windows **and** Linux)
- [ ] Protocol changes are additive-only; the phone page stays buildless
- [ ] The POC flow still works: `npm start` + adb tunnel + 3-corner calibration
- [ ] Docs updated where behavior changed
