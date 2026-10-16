import type { AppRouterClient } from "@nightshift/api/routers/index";
import type { InferClientInputs, InferClientOutputs } from "@orpc/client";

/** Contract types for the Connections page, derived from the API client. */

type Outputs = InferClientOutputs<AppRouterClient>;
type Inputs = InferClientInputs<AppRouterClient>;

export type ConnectionList = Outputs["connections"]["list"];
export type Connection = ConnectionList["connections"][number];
export type SecretView = ConnectionList["secrets"][number];
export type SecretSource = Connection["variables"][number]["source"];
export type McpServer = Connection["server"];
export type CliCheck = Outputs["connections"]["check"];
export type CliTool = Outputs["cliTools"]["list"][number];
export type CheckTarget = Inputs["connections"]["check"]["target"];
export type McpTestResult = Outputs["connections"]["test"];
export type SettingsView = Outputs["settings"]["get"];
export type SettingKey = keyof SettingsView["values"];
