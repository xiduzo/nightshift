/** Event types that open or close work. Startup recovery reads only these. */
export const LIFECYCLE_EVENT_TYPES = [
	"RunStarted",
	"RunResumed",
	"RunEnded",
	"StepStarted",
	"StepReopened",
	"StepEnded",
	"SessionStarted",
	"SessionEnded",
	"GateOpened",
	"WaitStarted",
	"WaitEnded",
] as const;
