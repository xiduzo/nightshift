import type { EngineEventType, EnginePayloads } from "./events";

/**
 * The fields of each event's payload that name a Person (a Better Auth
 * user id), in one place. A Space that moves to another Replica can take
 * its Person under another id there (a Device's local owner, the same
 * Person on its Home Host): every one of these fields is rewritten then,
 * and no other field is.
 *
 * Every event type is listed, those without a Person too, so a new event
 * type does not compile until it says which of its fields name a Person.
 * A field that cannot hold a Person's id (a fixed set of words, a number)
 * does not compile here either.
 */

/** The fields of `T`'s payload that can hold a Person's id. */
type PersonField<T extends EngineEventType> = {
	[K in keyof EnginePayloads[T]]-?: string extends EnginePayloads[T][K]
		? K
		: never;
}[keyof EnginePayloads[T]] &
	string;

export const PERSON_FIELDS = {
	ProjectAdded: [],
	ProjectRemoved: [],
	ProjectRestored: [],
	CloneAdded: [],
	DeviceJoined: ["ownerId"],
	DeviceRevoked: [],
	DeviceOnline: [],
	DeviceOffline: [],
	MemberJoined: ["personId", "by", "invitedBy"],
	MemberRemoved: ["personId", "by"],
	MemberRoleChanged: ["personId", "by"],
	OfferMade: ["by"],
	OfferWithdrawn: ["by"],
	ProjectRenamed: [],
	ProjectMoved: [],
	RunStarted: ["startedBy"],
	WorktreeCreated: [],
	WorktreeRemoved: [],
	HandedOff: [],
	StepMoved: [],
	WalkerMoved: ["by"],
	WalkerArrived: [],
	RunResumed: [],
	StepStarted: [],
	StepReopened: [],
	StepEnded: [],
	VariablesSet: [],
	GateOpened: [],
	SessionStarted: [],
	HarnessSessionAssigned: [],
	SessionUsage: [],
	SessionEnded: [],
	EdgeTaken: [],
	FlowCalled: [],
	ItemsRead: [],
	ItemStarted: [],
	ItemBlocked: [],
	ItemEnded: [],
	WaitStarted: [],
	LeaseTaken: [],
	LeaseReleased: [],
	ServiceStarted: [],
	ServiceStopped: [],
	WaitEnded: [],
	StopRequested: [],
	StopAfterStepRequested: [],
	StopAfterStepCancelled: [],
	RunTakenOver: ["by"],
	RunEnded: [],
	RunWarned: [],
	PullRequestOpened: [],
	Scored: [],
	ScheduleFired: [],
	ScheduleSkipped: [],
	KnowledgeSearched: [],
	KnowledgeRead: [],
	WebhookReceived: [],
} as const satisfies {
	[T in EngineEventType]: readonly PersonField<T>[];
};

/** Each field that names a Person, with the event types whose payload has it. */
export function personFieldTypes(): ReadonlyMap<string, EngineEventType[]> {
	const found = new Map<string, EngineEventType[]>();
	for (const [type, fields] of Object.entries(PERSON_FIELDS)) {
		for (const field of fields) {
			found.set(field, [...(found.get(field) ?? []), type as EngineEventType]);
		}
	}
	return found;
}
