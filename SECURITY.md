# Security Policy

point-bang injects mouse and keyboard input on the machine that runs it —
treat anything that can reach its socket as able to control that machine.
The threat model and mitigations (CORS allowlist on `/rtc/offer`, the
unauthenticated-tunnel warning, LAN-only signaling) are documented in the
[architecture reference](https://ggcaponetto.github.io/point-bang/reference/architecture).

## Supported versions

Only the latest release (and `main`) receive security fixes.

## Reporting a vulnerability

Please **do not open a public issue** for security-sensitive reports.
Instead, use
[GitHub's private vulnerability reporting](https://github.com/ggcaponetto/point-bang/security/advisories/new)
or email **ggcaponetto@gmail.com**. You'll get an acknowledgment within a
few days; please allow a reasonable window for a fix before public
disclosure.
