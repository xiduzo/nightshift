/** Gates: the questions that wait for a person. The answer to one (with the lock-screen rule at every door), the open and the answered Gates of a Space, and the Needs-you inbox of a Person across their Spaces. `wireGates` binds the use cases to their ports. */

export type { InboxAnsweredGate } from "./application/list-answered-inbox";
export type { InboxGate } from "./application/list-inbox";
export { GateClosedError } from "./domain/answer";
export { INBOX_KEEP_MS } from "./domain/inbox-order";
export { NeedsApp } from "./domain/lock-screen";
export { type Gates, wireGates } from "./wire";
