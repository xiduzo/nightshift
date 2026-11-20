/** A change of the usage policy of a Space a Host keeps: it changes there only. */
export const USAGE_ON_HOST =
	"Your Host keeps the settings of this Space. Change usage on your Host.";

/** Whether this computer may send anonymous usage: no Space it belongs to turned usage off. */
export function usageAllowed(usageOn: readonly boolean[]): boolean {
	return usageOn.every((on) => on);
}
