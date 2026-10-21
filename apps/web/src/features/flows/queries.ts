/** The query and mutation options of flows (`@nightshift/client`, on this app's client). */

import { createFlowMutations, createFlowQueries } from "@nightshift/client";

import { orpc } from "@/shared/api";

export const flowQueries = createFlowQueries(orpc);

export const flowMutations = createFlowMutations(orpc);
