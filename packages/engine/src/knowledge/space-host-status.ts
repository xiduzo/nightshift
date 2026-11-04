import type { Database } from "@nightshift/db";
import { organization, project } from "@nightshift/db/schema";
import { now } from "@nightshift/time";
import { eq } from "drizzle-orm";
import { OlderHostError } from "../contract";

/**
 * What the knowledge knows about a Project's Space and its Host. The merge
 * and the reader ask the same questions: which Space, and whether its Host
 * can take this knowledge now.
 */
export type SpaceHostStatus = {
	/** The Space of a Project. Null for a Project this Replica does not have. */
	spaceOf(projectId: string): Promise<string | null>;
	/** Whether a Space has Members besides one Person: it is not a personal Space. */
	isShared(spaceId: string): Promise<boolean>;
	/** Whether the Space's Host runs an older version of Night Shift, as far as this Device knows now. */
	isOlder(spaceId: string): boolean;
	/** What a failed knowledge call to the Host says about it. */
	heard(spaceId: string, error: unknown): void;
	/** The Host took a knowledge call: it does not run an older version any more. */
	answered(spaceId: string): void;
};

/**
 * How long a Device works on its own copy after the Host of a Space said
 * it runs an older version: then it asks again. As the run exchange does.
 */
const OLDER_HOST_WAIT_MS = 60 * 60_000;

export function createSpaceHostStatus(db: Database): SpaceHostStatus {
	/**
	 * The Spaces whose Host runs an older version of Night Shift, until
	 * when this Device asks it again. Its first knowledge call tells: then
	 * no reconcile waits for its documents or calls it until that time.
	 */
	const olderHosts = new Map<string, number>();
	return {
		async spaceOf(projectId) {
			const [row] = await db
				.select({ spaceId: project.spaceId })
				.from(project)
				.where(eq(project.id, projectId));
			return row?.spaceId ?? null;
		},
		async isShared(spaceId) {
			const [row] = await db
				.select({ personal: organization.personal })
				.from(organization)
				.where(eq(organization.id, spaceId));
			return row ? !row.personal : false;
		},
		isOlder: (spaceId) => (olderHosts.get(spaceId) ?? 0) > now(),
		heard(spaceId, error) {
			if (error instanceof OlderHostError) {
				olderHosts.set(spaceId, now() + OLDER_HOST_WAIT_MS);
			}
		},
		answered(spaceId) {
			olderHosts.delete(spaceId);
		},
	};
}
