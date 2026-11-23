/** This computer's Agent Profiles and Model Profiles, in its Device document. `wireProfiles` binds the use cases behind the store the readers use. */

export {
	type ProfileView,
	profileChoice,
	readProfiles,
} from "./domain/profile-entries";
export { type ProfileStore, wireProfiles } from "./wire";
