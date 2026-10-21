import type { HomeWidgetProps } from "./glance-props";

/** No home screen widget here (the web build): iOS and Android have their own file. A `.tsx` file, so that Metro takes the `.ios.tsx` and `.android.tsx` files first. */
export function showOnHomeScreen(_props: HomeWidgetProps): void {}
