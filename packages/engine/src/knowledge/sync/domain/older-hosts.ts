import { OlderHostError } from "../../../contract";

/**
 * How long a Device works on its own copy after the Host of a Space said
 * it runs an older version: then it asks again. As the run exchange does.
 */
const OLDER_HOST_WAIT_MS = 60 * 60_000;

/**
 * The Spaces whose Host runs an older version of Night Shift, until when
 * this Device asks it again. Its first knowledge call tells: then no
 * reconcile waits for its documents or calls it until that time. The wire
 * makes one: the merge and the reader share it.
 */
export type OlderHosts = {
	/** Whether the Space's Host runs an older version, as far as this Device knows at `at`. */
	isOlder(spaceId: string, at: number): boolean;
	/** What a failed knowledge call to the Host at `at` says about it. */
	heard(spaceId: string, error: unknown, at: number): void;
	/** The Host took a knowledge call: it does not run an older version any more. */
	answered(spaceId: string): void;
};

export function createOlderHosts(): OlderHosts {
	const until = new Map<string, number>();
	return {
		isOlder: (spaceId, at) => (until.get(spaceId) ?? 0) > at,
		heard(spaceId, error, at) {
			if (error instanceof OlderHostError) {
				until.set(spaceId, at + OLDER_HOST_WAIT_MS);
			}
		},
		answered(spaceId) {
			until.delete(spaceId);
		},
	};
}
