import type { ApiInputs, ApiOutputs } from "../api";

/** The view types of the dashboard, derived from the API. */

export type DashboardSummary = ApiOutputs["dashboard"]["summary"];
/** A run in a dashboard list, with its flow or project. */
export type DashboardRun = DashboardSummary["open"]["rows"][number];
/** The details over the last 7, 30 or 90 nights. */
export type NightsRange = DashboardSummary["nights"][number];
export type NightRange = NightsRange["nights"];
export type FlowHealthRow = NonNullable<
	DashboardSummary["flowHealth"]
>["rows"][number];
/** The five-number summary of a set of values, such as what runs cost. */
export type Spread = NonNullable<FlowHealthRow["cost"]>;
/** One flow of a project in detail, behind its Flow health row. */
export type FlowHealthDetail = ApiOutputs["dashboard"]["flow"];
export type FlowRange = FlowHealthDetail["ranges"][number];
/** One run of a flow: a run of its own, or a Subflow run inside another run. */
export type FlowRun = FlowRange["latest"][number];
/** How an asked Gate stands. */
export type GateState = NightsRange["gates"]["states"][number];

/** What the dashboard covers. The reader's time zone comes with the query. */
export type DashboardInput = Omit<
	NonNullable<ApiInputs["dashboard"]["summary"]>,
	"timeZone"
>;
