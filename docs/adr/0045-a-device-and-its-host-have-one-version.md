# 45. A Device and its Host have one version

Status: accepted, 2026-11-24. Where an earlier ADR says what an older Host or Device does,
this one holds: there is one check, when computers connect. Those ADRs stay as written.

## Context

Each side of the peer protocol reads the current shape only. A peer of another version failed
at the first field it did not know: an input that the Host refused, a stream that started
again without end, a message that named the wrong side. No place said "update".

A check can do harm. A Device that reads UNAUTHORIZED or FORBIDDEN from its Host deletes its
key, pauses schedules and splits its Personal. A run that asks for a lease and reads any
refusal but HOST_UNREACHABLE stops. Builds from before this check read it too.

## Decision

1. **One number.** `PROTOCOL_VERSION` (`packages/refusal/src/version.ts`) is the version of
   what two Night Shifts say to each other. Both sides must have the same one. No range.
2. **A Device says it with every call**, in the header `x-nightshift-version`, and in the
   token of the document channel (`<key>@<number>`). A Host says it in `link.hello` and
   `link.heartbeat`. A side that says none is older.
3. **The Host checks it once, after the key.** `admitKeyedCall` first checks the key, its
   permission, "Be a Host" and the pairing. A caller without access gets the same answers as
   before, and nothing about the version. The check comes before the input is read.
4. **The refusal is HOST_UNREACHABLE (503)**, with `{ device: "older" | "newer", hostId }` beside it.
   Every build reads that code as a Host that it cannot reach now. It is never CONFLICT: a
   lease call that reads CONFLICT fails the step.
5. **The Device waits.** Its link is `outdated`: no stream, no document and no call goes over
   it. The key, the rows and the Clones stay. It asks again every minute, and at once when a
   call or a document is refused. It is not a leave, and nothing is paused. A Host from before
   the number answers the hello without one: the Device uses nothing of that answer.
   Only an answer that names the link's own Host counts. Any other answer (a sign-in page of a
   network, another Host at that address) is as no answer.
6. **The words live once**, beside the number. The Device's pages say which side to update. The
   Host's Devices page says it too, because an older Device shows only "Offline".
7. **Pairing has no check.** It has no key. A Device that pairs with a Host of another version
   gets its key, and its link then says what to update.
8. **The apps compare the same number.** `account.status` answers it to a Person who may use
   this Night Shift. A page says to reload, a phone to update.

## The number cannot be forgotten

`contract/version/version.test.ts` in `packages/devices` describes every procedure of the
contract as data (path, key, refusals, input, output) and compares its hash with the line of
the number. A changed shape fails until the number goes up and has a new line. The lines count
up, and no two have one shape.

The hash does not see a rule inside a schema (`refine`), a meaning that changes under one
shape, or the synced documents. Those have their own format. The API of the apps is not in the
hash: raise the number by hand when an older app can no longer read an answer.

## Consequences

- A change of the protocol goes to every install. The Host first, then each computer, then the
  phone. Between them, a computer of the old version is offline, with a reason.
- A run on an outdated Device goes on there, as it does offline. A step placed on it waits, as
  it does for an offline Device.
- Two builds with one number may differ in everything else.
