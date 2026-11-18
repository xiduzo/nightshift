/** What a Gate shows and takes: its brief (ADR 21) and the files of an answer. */

export {
	type AnswerFile,
	answerFilesProblem,
	answerFilesSchema,
	MAX_ANSWER_FILES,
	MAX_ANSWER_FILES_BYTES,
} from "./answer-files";
export {
	checkGateBrief,
	DEFAULT_GATE_URGENCY,
	GATE_URGENCIES,
	type GateBriefFields,
	type GateRecommend,
	type GateUrgency,
	gateBriefFields,
	gateBriefTexts,
	gateRecommendField,
	gateRecommendTexts,
	gateUrgencySchema,
	isGateUrgency,
} from "./gate-brief";
