import type { AppRouterClient } from "@nightshift/api/routers/index";
import type { InferClientInputs, InferClientOutputs } from "@orpc/client";

/** Contract types for the Agents page, derived from the API client. */

type Outputs = InferClientOutputs<AppRouterClient>;
type Inputs = InferClientInputs<AppRouterClient>;

export type ProfileRow = Outputs["profiles"]["list"][number];
export type ProfileUse = ProfileRow["usedBy"][number];
export type ProfileInput = Inputs["profiles"]["save"];
export type HarnessRow = Outputs["harnesses"]["list"][number];
export type HarnessName = HarnessRow["name"];
export type HarnessModels = Outputs["harnesses"]["models"];
