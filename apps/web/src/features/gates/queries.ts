/**
 * The query options of Gates, and how often the inbox polls
 * (`@nightshift/client`, on this app's client).
 */

import { createGateQueries } from "@nightshift/client";

import { orpc } from "@/shared/api";

export const gateQueries = createGateQueries(orpc);
