import type { ApiInputs, ApiOutputs } from "@nightshift/client";
import type { AgentNode, Outcome } from "@nightshift/flows";

/**
 * The API types only the web app needs: the flow editor, the Agents page
 * and the Settings page. The phone app does not edit them. The view types
 * both apps use come from `@nightshift/client` (see `index.ts`).
 */

export type PermissionMode = NonNullable<AgentNode["permissionMode"]>;
export type Effort = NonNullable<AgentNode["effort"]>;
export type { Outcome };

/** The Agents page: profiles and harnesses. */
export type ProfileRow = ApiOutputs["profiles"]["list"][number];
export type ProfileInput = ApiInputs["profiles"]["save"];
export type HarnessRow = ApiOutputs["harnesses"]["list"][number];
/** A harness by its name, as the Agents page lists it. */
export type HarnessRowName = HarnessRow["name"];

/** Connections, CLI tools and secrets: the Agents page and the flow editor. */
export type ConnectionList = ApiOutputs["connections"]["list"];
export type Connection = ConnectionList["connections"][number];
export type SecretView = ConnectionList["secrets"][number];
export type SecretSource = Connection["variables"][number]["source"];
export type McpServer = Connection["server"];
export type CliCheck = ApiOutputs["connections"]["check"];
export type CliTool = ApiOutputs["cliTools"]["list"][number];
export type CheckTarget = ApiInputs["connections"]["check"]["target"];
export type McpTestResult = ApiOutputs["connections"]["test"];

/** The settings of this computer, their fields and their defaults. */
export type SettingsView = ApiOutputs["settings"]["get"];
