/** The Needs-you inbox: its rows (the Gates that wait and the ones that closed), the one queue order and its urgency words, which Gates you may answer, how long a Gate waited, and when its deadline falls. */

export { deadlineSoon, deadlineText, deadlineWhen } from "./deadline";
export { gateRun, waitedText, waitingForYou } from "./inbox";
export { gateOrder, mayAnswer, URGENCY_LABEL, urgencyOf } from "./queue";
export type { AnsweredGate, GateChoice, OpenGate } from "./types";
