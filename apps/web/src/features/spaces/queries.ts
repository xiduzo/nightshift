/**
 * The query and mutation options of Spaces, their Members and invitations
 * (`@nightshift/client`, on this app's client).
 */

import { createSpaceMutations, createSpaceQueries } from "@nightshift/client";

import { orpc } from "@/shared/api";

export const spaceQueries = createSpaceQueries(orpc);

export const spaceMutations = createSpaceMutations(orpc);
