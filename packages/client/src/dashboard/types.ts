import type { ApiInputs, ApiOutputs } from "../api";

/** The view types of the dashboard, derived from the API. */

export type DashboardSummary = ApiOutputs["dashboard"]["summary"];
/** A run in a dashboard list, with its flow or project. */
export type DashboardRun = DashboardSummary["open"]["rows"][number];
/** The details over the last 7, 30 or 90 days. The wire key is `nights`. */
export type NightsRange = DashboardSummary["nights"][number];
export type NightRange = NightsRange["nights"];
/** The newest report of one flow in a range, one row per flow. */
export type FlowReport = NonNullable<NightsRange["reports"]>["rows"][number];
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

/** What the runs of a Space cost, how steady that is, and where a change saves. */
export type SpaceSpend = ApiOutputs["dashboard"]["spend"];
/** The Spend page over the last 7, 30 or 90 days. */
export type SpendDays = SpaceSpend["ranges"][number];
/** One flow on the Spend page. */
export type SpendFlow = SpendDays["flows"][number];
/** One way to save on one flow. */
export type SpendSaving = SpendDays["savings"][number];

/** Before and after for one flow over some days, and the next changes to try. */
export type FlowChanges = ApiOutputs["dashboard"]["changes"];
/** One change of a flow: saves less than 30 minutes apart. */
export type FlowChange = FlowChanges["changes"][number];
/** Two sets of runs of a flow side by side. */
export type ChangeComparison = FlowChanges["days"];
/** One column of the before and after table. */
export type ChangeMeasure = ChangeComparison["before"];
export type ChangeVerdict = ChangeComparison["verdict"];
export type ChangeTrend = ChangeComparison["trends"]["finished"];
/** One next change to try on a flow. */
export type FlowMove = FlowChanges["moves"][number];
