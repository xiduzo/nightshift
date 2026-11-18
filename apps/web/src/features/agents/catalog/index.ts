/** What an agent can be: the harnesses with their words, the permission modes and the efforts. */

export { EFFORTS, PERMISSION_MODES, permissionLabel } from "./agent-options";
export {
	type BuiltInHarnessName,
	HARNESSES,
	type HarnessInfo,
	type HarnessName,
	harnessInfo,
	isHarnessName,
	switchHarness,
	useCustomAgents,
} from "./harnesses";
