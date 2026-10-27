import type { ApiOutputs } from "../api";

export type FlowListItem = ApiOutputs["flows"]["list"][number];
/** One flow file: the flow and its issues. */
export type LoadedFlow = ApiOutputs["flows"]["get"];
/** One revision of a flow, as the list shows it. */
export type FlowRevisionItem = ApiOutputs["flows"]["revisions"][number];
/** One revision with its flow, and the diff to it. */
export type FlowRevisionView = ApiOutputs["flows"]["revision"];
