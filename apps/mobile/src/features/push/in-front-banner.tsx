import { type PushData, routeOf } from "@nightshift/client";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui-native/components/ui/alert";
import { usePathname } from "expo-router";
import {
	BellRing,
	CircleCheck,
	CircleX,
	Hand,
	type LucideIcon,
	MonitorSmartphone,
	Sunrise,
} from "lucide-react-native";
import { useEffect } from "react";
import { Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TONE_CLASS, type Tone } from "@/shared/tone";
import { hideBanner, setInFrontPlace, useBanner } from "./in-front";
import { openPhoneRoute } from "./open-route";
import { showInFront } from "./push-data";

/** How long the banner stays when the person does not tap it. */
const SHOWN_MS = 6000;

/** What the banner says a tap does, by where it goes. */
const TAP = {
	gate: { hint: "Opens the Gate", text: "Tap to answer it." },
	run: { hint: "Opens the run", text: "Tap to open the run." },
	inbox: { hint: "Opens Needs you", text: "Tap to see what needs you." },
} as const;

/** The icon and tone of each kind of message, as the app's rows show them. */
const LOOK: Record<PushData["kind"], { icon: LucideIcon; tone: Tone | null }> =
	{
		"gate-opened": { icon: Hand, tone: "waiting" },
		"gates-waiting": { icon: Hand, tone: "waiting" },
		"run-finished": { icon: CircleCheck, tone: "finished" },
		"run-failed": { icon: CircleX, tone: "failed" },
		"device-wait": { icon: MonitorSmartphone, tone: "waiting" },
		digest: { icon: Sunrise, tone: null },
	};

/**
 * A Gate that opened, or a step that waits for a device, while the app is
 * in front, as a banner at the top of the app: the live cache shows it
 * from the stream at once, and a push that comes in front shows it too.
 * The phone shows no banner of its own then. A tap opens the Gate or the
 * run. It also tells the push handling which screen is in front.
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
	const tap = TAP[route.to];
	const look = LOOK[banner.data.kind] ?? { icon: BellRing, tone: null };

	return (
		<Pressable
			accessibilityRole="button"
			accessibilityHint={tap.hint}
			onPress={() => {
				hideBanner(banner);
				openPhoneRoute(route);
			}}
			className="absolute right-4 left-4 rounded-lg shadow-black/10 shadow-lg active:opacity-80"
			style={{ top: insets.top + 8 }}
		>
			<Alert
				icon={look.icon}
				iconClassName={look.tone ? TONE_CLASS[look.tone].text : undefined}
			>
				<AlertTitle>{banner.title}</AlertTitle>
				<AlertDescription>{tap.text}</AlertDescription>
			</Alert>
		</Pressable>
	);
}
