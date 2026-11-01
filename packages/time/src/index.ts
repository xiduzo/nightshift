/**
 * The clock. An instant is UTC milliseconds. Wall-clock math is date-fns
 * in an explicit IANA zone. Screens format with the viewer's zone and show
 * the UTC instant on hover (`hoverTime`). Cron times are
 * `@nightshift/time/cron`.
 */

export {
	asDate,
	atWall,
	DAY_MS,
	dayKey,
	dayStart,
	HOUR_MS,
	hourOf,
	type Instant,
	instant,
	instantOrNull,
	iso,
	isTimeZone,
	lastHours,
	lastNights,
	localZone,
	minuteOfDay,
	nextClockTime,
	nightOf,
	now,
	parseInstant,
	type Wall,
	type WallTime,
	wall,
} from "./clock";
export {
	formatClock,
	formatDateTime,
	formatDay,
	formatDayTime,
	formatLongDay,
	formatRelative,
	formatTime,
	formatWeekday,
	formatWeekdayDate,
	hoverTime,
} from "./format";
