import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui-native/components/ui/alert";
import { router, usePathname } from "expo-router";
import { BellRing } from "lucide-react-native";
import { useEffect } from "react";
import { Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { hideBanner, setInFrontPlace, useBanner } from "./in-front";
import { routeOf, showInFront } from "./push-data";

/** How long the banner stays when the person does not tap it. */
const SHOWN_MS = 6000;

/**
 * A push that came while the app is in front, as a banner at the top of
 * the app: the phone shows no banner of its own then. A tap opens the Gate.
 * It also tells the push handling which screen is in front.
 */
export function InFrontBanner() {
	const pathname = usePathname();
	const banner = useBanner();
	const insets = useSafeAreaInsets();

	useEffect(() => {
		setInFrontPlace({ pathname });
		// The person went to the inbox or to the Gate: the banner is done.
		if (banner && !showInFront(banner.data, { pathname })) hideBanner(banner);
	}, [pathname, banner]);

	useEffect(() => {
		if (!banner) return;
		const timer = setTimeout(() => hideBanner(banner), SHOWN_MS);
		return () => clearTimeout(timer);
	}, [banner]);

	if (!banner) return null;
	const route = routeOf(banner.data);
	const opensGate = route?.pathname === "/gates/[runId]/[stepId]";

	return (
		<Pressable
			accessibilityRole="button"
			accessibilityHint={opensGate ? "Opens the Gate" : "Opens the inbox"}
			onPress={() => {
				hideBanner(banner);
				if (route) router.push(route);
			}}
			className="absolute right-4 left-4 rounded-lg shadow-black/10 shadow-lg active:opacity-80"
			style={{ top: insets.top + 8 }}
		>
			<Alert icon={BellRing}>
				<AlertTitle>{banner.title}</AlertTitle>
				<AlertDescription>
					{opensGate ? "Tap to answer it." : "Tap to open your inbox."}
				</AlertDescription>
			</Alert>
		</Pressable>
	);
}
