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
/** An Agent Profile: it names a harness. */
export type AgentProfileRow = Extract<ProfileRow, { harness: unknown }>;
/** A Model Profile, for Decisions and Values decided by a model: it names a decider. */
export type ModelProfileRow = Extract<ProfileRow, { decider: unknown }>;
export type ProfileInput = ApiInputs["profiles"]["save"];
export type AgentProfileInput = Extract<ProfileInput, { harness: unknown }>;

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

/** An agent CLI or a kit's tool found on this computer, not set up yet. */
export type FoundProgram = ApiOutputs["programs"]["found"][number];

/** One of the owner's other Devices: its profiles and secret names, read-only. */
export type OtherDevice = ApiOutputs["devices"]["others"][number];
/** What a merge of this computer's Personal into its home Host's does. */
export type MergePreview = ApiOutputs["devices"]["merge"]["preview"];
export type MergeResult = ApiOutputs["devices"]["merge"]["run"];

/** The settings of this computer, their fields and their defaults. */
export type SettingsView = ApiOutputs["settings"]["get"];

/** A project's knowledge on this computer, and the flows that fill it. */
export type Knowledge = ApiOutputs["knowledge"]["get"];
export type KnowledgeFile = Knowledge["files"][number];
