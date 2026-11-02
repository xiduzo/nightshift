import type { ApiOutputs } from "../api";

/** A Gate that waits for a person: one row of the Needs-you inbox, with its Space's id and name and `canAnswer`. */
export type OpenGate = ApiOutputs["gates"]["list"][number];
export type GateChoice = OpenGate["choices"][number];

/** A Gate that closed: what it asked, the option it took, and who chose it. */
export type AnsweredGate = ApiOutputs["gates"]["answered"][number];
