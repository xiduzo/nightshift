# 20. One computer is one Device

Status: accepted, 2026-11-05. Extends [ADR 17](0017-a-run-takes-the-first-device-that-can.md),
decision 8.

## Context

A Device id is a random id in the database of each install. A new data directory
therefore counts as a new computer. One Mac showed as two Devices with one name:

- The desktop app had no profiles.
- A dev daemon had the profiles, and was offline.

A run started on "this computer" then said "LE2316 has no profile" and "LE2316 is
offline" in one warning. Both installs were paired with one Host, as one Person.

ADR 17 marks a dev daemon and keeps it out of defaults and fallbacks. It still
pairs with a Host of real work, and flows can still name it.

## Decision

1. **A computer has a fingerprint.** The fingerprint is a SHA-256 hash of the
   hardware id and the OS user. The hardware id stays on the computer. Two OS users
   of one computer are two Devices, because their files and keychains are separate.
2. **Some installs have no fingerprint.** A container has none, because it has no
   hardware of its own. A development install has none, because it is not the
   computer. A failed read gives none and never stops a start.
3. **Only a home Host gets the fingerprint.** A guest Host is another Person's, and
   it never hears of the computer. A Device says it at pairing, and each time its
   link comes online. So a Device that paired before this decision gets one too.
4. **The same computer gets its Device back.** A home Host joins a pairing under the
   Device of the same owner with the same fingerprint, and a removed Device counts.
   It never does this across owners. It never does this for a development install or
   for the Host's own Device.
5. **One Night Shift at a time per Device.** A Host refuses that pairing while the
   Device is online. Quit the other install, then pair again.
6. **The install becomes that Device at its next start.** The running daemon holds
   its id for its whole life. So the pairing saves the key and the link, updates the
   rows that name the old id, and asks the person to restart. The Device document
   syncs from the Host at the next start.
7. **Event counts go on.** An event's identity is its Walker and its count, and a
   Host drops an event whose identity it knows. The Host therefore says the last
   count it has of the Device, and the install counts on from there.
8. **Two Devices that share a fingerprint stay as they are.** Night Shift does not
   merge them. A person removes the one they do not use.
9. **A development install stays off other computers.** It pairs and connects only
   with a Host on this computer, unless NIGHTSHIFT_DEV_LINK_HOST=true is set. A link
   it saved earlier does not start, and it logs why.

## Consequences

- A reinstall or a new data directory no longer adds a Device. Its profiles, CLI
  tools and connections come back from the Host.
- Secrets saved on this computer do not come back. The keychain keeps some, but a
  data directory that is gone takes its sealing key with it.
- The Device document of the old id stays in its row and nothing reads it. A profile
  made in a new install before it pairs does not move to the adopted Device.
- A dev daemon that is paired with a Host on another computer stops connecting after
  this change. A flow that names it must name another profile.
- A Personal merge after the restart starts from the Devices page, not from the
  pairing.
- A Device of an older version says no fingerprint and joins as itself. An older
  Host gives no Device id, and the install stays as it is.
