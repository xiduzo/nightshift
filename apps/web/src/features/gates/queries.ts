/** The query options of Gates (`@nightshift/client`, on this app's client). */

import { createGateQueries } from "@nightshift/client";

import { orpc } from "@/shared/api";

export const gateQueries = createGateQueries(orpc);
