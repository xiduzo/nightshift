import type { AppRouterClient } from "@nightshift/api/client";
import type { InferClientInputs, InferClientOutputs } from "@orpc/client";
import type { RouterUtils } from "@orpc/tanstack-query";

/** The typed oRPC client of a Night Shift: one function per procedure. */
export type ApiClient = AppRouterClient;

/** The TanStack Query helpers of the client: query keys, query and mutation options. */
export type ApiQueryUtils = RouterUtils<ApiClient>;

/** What each procedure answers. The view types of every vertical come from here. */
export type ApiOutputs = InferClientOutputs<ApiClient>;

/** What each procedure takes. */
export type ApiInputs = InferClientInputs<ApiClient>;
