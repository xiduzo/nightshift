import type { ApiOutputs } from "../api";

/** A Gate that waits for a person: one row of the Needs-you inbox. */
export type OpenGate = ApiOutputs["gates"]["list"][number];
export type GateChoice = OpenGate["choices"][number];
