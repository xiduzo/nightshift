import type { ApiOutputs } from "../api";

/** The schedules of a project, with the next start and the last result of each. */
export type ScheduleList = ApiOutputs["schedules"]["list"];
export type ScheduleSummary = ScheduleList["schedules"][number];
export type ScheduleResult = NonNullable<ScheduleSummary["last"]>;
export type ScheduleIssue = ScheduleSummary["issues"][number];
