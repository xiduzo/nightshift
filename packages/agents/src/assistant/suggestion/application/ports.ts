import type { ProjectFacts } from "../domain/project-facts";

/** Reads the facts of the project in `folder`. Never throws: what it cannot read stays empty. */
export type ProjectFactsReader = (folder: string) => Promise<ProjectFacts>;
