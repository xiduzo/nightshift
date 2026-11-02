/** Why one log record was not stored. The event name is a token, never free text. */
export const INGEST_RULE = {
	unknownEvent: "unknown_event",
	unknownAttribute: "unknown_attribute",
	wrongType: "wrong_type",
} as const;

export type IngestRule = (typeof INGEST_RULE)[keyof typeof INGEST_RULE];

export type IngestRefusal = {
	eventName: string | null;
	rule: IngestRule;
};

export type IngestResult = {
	accepted: number;
	refused: number;
	refusals: IngestRefusal[];
};
