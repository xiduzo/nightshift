import { type CopyState, copiesOf, type ProjectCopy } from "../domain/copies";

export type ListProjectCopiesPorts = { state: CopyState };

/** The copies to this computer that run or failed. It reads no store: it stays synchronous. */
export const listProjectCopies =
	(ports: ListProjectCopiesPorts) => (): ProjectCopy[] =>
		copiesOf(ports.state);
