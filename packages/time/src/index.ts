/**
 * The clock. An instant is UTC milliseconds. Wall-clock math is date-fns
 * in an explicit IANA zone. Screens format with the viewer's zone and show
 * the UTC instant on hover (`hoverTime`). Cron times are
 * `@nightshift/time/cron`.
 */

export {
	asDate,
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
	lastDays,
	lastHours,
	localZone,
	minuteOfDay,
	nextClockTime,
	now,
	parseInstant,
	type Wall,
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
	formatWeekdayDateYear,
	hoverTime,
} from "./format";
