/** The query and mutation options of projects (`@nightshift/client`, on this app's client). */

import {
	createProjectMutations,
	createProjectQueries,
} from "@nightshift/client";

import { orpc } from "@/shared/api";

export const projectQueries = createProjectQueries(orpc);

export const projectMutations = createProjectMutations(orpc);
