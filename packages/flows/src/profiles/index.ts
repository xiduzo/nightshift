/** Profiles: an Agent Profile (a harness, a model and its tools) or a Model Profile (a decider and its model) under one name, on a computer or in a project. */

export {
	PROFILES_VERSION,
	type ProfileIssue,
	type ProfilesSource,
	type ProjectProfiles,
	parseProfilesSource,
} from "./file";
export {
	type AgentProfile,
	type AgentProfileSettings,
	agentProfileSchema,
	isAgentProfile,
	type ModelProfile,
	type ModelProfileSettings,
	modelProfileSchema,
	type Profile,
	type ProfileSettings,
	profileOf,
	profileSchema,
	profileSettingsSchema,
	type ResolvedAgentNode,
	resolvedAgent,
	resolveNodeProfile,
} from "./profiles";
