/** The edits of this computer's configuration that touch more than one part: profiles, connections, CLI tools and harnesses. */

export {
	agentProfileOn,
	customAgentOf,
	saveProfile,
} from "./domain/profile-edits";
export { type Edits, wireEdits } from "./wire";
