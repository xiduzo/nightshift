/** Glances outside the app: the home screen widget, and a followed run on the lock screen (a Live Activity on iOS, an ongoing notification on Android). */

export { FollowOnLockScreen } from "./follow-button";
export { LockScreenRuns } from "./lock-screen-runs";
export { updateGlance } from "./update-glance";
export { useHomeWidget } from "./use-home-widget";
export { canFollowOnLockScreen, useFollowAfterStart } from "./use-lock-screen";
