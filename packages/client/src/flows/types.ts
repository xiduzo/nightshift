import type { ApiOutputs } from "../api";

export type FlowListItem = ApiOutputs["flows"]["list"][number];
/** One flow file: the flow and its issues. */
export type LoadedFlow = ApiOutputs["flows"]["get"];
