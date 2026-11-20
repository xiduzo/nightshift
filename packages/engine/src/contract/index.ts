/**
 * What the engine shares with its callers and the Devices, in words every
 * vertical may name: who acts (`Actor`), a change of Members
 * (`MemberChange`), a run start and its schema (`StartRunInput`,
 * `startRunInputSchema`), the Command (`command.ts`: what a person asks of
 * a run, the kinds that travel to its Walker, the permission each needs
 * and its wire schema), where a run can be placed (`Placement`,
 * `OwnDevice`, `NodeToPlace`), and the ports a vertical asks of the
 * devices: the Device rows (`DeviceDirectory`), the Hosts (`Relay`, and
 * `HostUnreachableError` when one cannot be reached), the leases a Host
 * keeps (`LeaseHost`, ADR 7), the Offer rule of a schedule (`OffersPort`) and the name of the branch of one item of a Call (`itemBranchName`, in `branches/`).
 * The words of the ports of more than one vertical are in sub-verticals:
 * what the walk reads (`walk/`: the run's plan, `WalkSettings`), one use of
 * a secret (`secrets/`), what a step gets of the knowledge
 * (`step-knowledge/`) and the statements of one database batch that
 * slices hand on (`rows/`: `RowBatch`). It imports no other vertical.
 */

export {
	type Actor,
	type MemberChange,
	NIGHT_SHIFT,
	type PersonActor,
	personOf,
} from "./actor";
export { itemBranchName } from "./branches";
export {
	COMMAND_KINDS,
	commandOf,
	permissionOf,
	type RunActionRequest,
	type RunCommandInput,
	type RunCommandKind,
	requestOf,
	runCommandSchema,
} from "./command";
export type { DeviceDirectory } from "./directory";
export type {
	LeaseAnswer,
	LeaseHolder,
	LeaseHost,
	LeaseTake,
	SpaceLease,
} from "./leases";
export type { OffersPort } from "./offers";
export type {
	DeviceProfile,
	NodeToPlace,
	OwnDevice,
	Placement,
} from "./placement";
export {
	HOST_UNREACHABLE,
	HostUnreachableError,
	OLDER_HOST,
	OlderHostError,
	type Relay,
} from "./relay";
export type { RowBatch } from "./rows";
export type {
	NotRead,
	ProjectRef,
	SecretEnv,
	SecretUse,
	StepRun,
} from "./secrets";
export {
	type StartRunInput,
	startRunInputSchema,
	startRunRequestSchema,
	startTestInputSchema,
	type TestRunRequest,
} from "./start-run";
export type {
	CommandKnowledge,
	KnowledgeRequest,
	KnowledgeUseEvent,
	SessionKnowledge,
	SessionStep,
} from "./step-knowledge";
export {
	type FallbackDevice,
	fallbackKey,
	type NodeFields,
	type PlannedDevice,
	type RunFallbacks,
	type RunPlan,
	type WalkSettings,
} from "./walk";
