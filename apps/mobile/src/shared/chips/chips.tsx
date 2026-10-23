import { Button } from "@nightshift/ui-native/components/ui/button";
import { Icon } from "@nightshift/ui-native/components/ui/icon";
import { Text } from "@nightshift/ui-native/components/ui/text";
import type { LucideIcon } from "lucide-react-native";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useRef,
} from "react";
import { ScrollView } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

/** The gutter at each end of the rail, in points. */
const GUTTER = 16;

/** Scrolls the rail so a chip, at `x` with `width` in the rail, is in view. */
const RevealContext = createContext<
	((x: number, width: number, animated: boolean) => void) | null
>(null);

/**
 * Filter chips in a row that scrolls sideways, edge to edge of the
 * screen. Put Chips in it.
 */
export function ChipRail({ children }: { children: ReactNode }) {
	const rail = useRef<ScrollView>(null);
	const offset = useRef(0);
	const width = useRef(0);
	/** A chip to reveal before the rail knew its own width. */
	const pending = useRef<{ x: number; width: number } | null>(null);
	const reduceMotion = useReducedMotion();
	// The chosen chip stays in view, also when a link chose one far right.
	const reveal = useCallback(
		(x: number, chipWidth: number, animated: boolean) => {
			const start = x - GUTTER;
			const end = x + chipWidth + GUTTER;
			const shown = offset.current + width.current;
			if (width.current === 0) {
				pending.current = { x, width: chipWidth };
				return;
			}
			if (start >= offset.current && end <= shown) return;
			rail.current?.scrollTo({
				x: Math.max(0, end > shown ? end - width.current : start),
				animated: animated && !reduceMotion,
			});
		},
		[reduceMotion],
	);
	return (
		<RevealContext.Provider value={reveal}>
			<ScrollView
				ref={rail}
				horizontal
				onLayout={(event) => {
					width.current = event.nativeEvent.layout.width;
					const chip = pending.current;
					pending.current = null;
					if (chip) reveal(chip.x, chip.width, false);
				}}
				onScroll={(event) => {
					offset.current = event.nativeEvent.contentOffset.x;
				}}
				scrollEventThrottle={64}
				showsHorizontalScrollIndicator={false}
				className="-mx-4 grow-0"
				contentContainerClassName="gap-2 px-4"
				accessibilityRole="tablist"
			>
				{children}
			</ScrollView>
		</RevealContext.Provider>
	);
}

/**
 * One filter of a ChipRail: a rounded Button, `default` when it is
 * chosen and `outline` when not, with an optional count. 44 pt high.
 */
export function Chip({
	label,
	count,
	selected = false,
	icon,
	onPress,
	accessibilityHint,
}: {
	label: string;
	/** How many items the filter shows. */
	count?: number;
	selected?: boolean;
	icon?: LucideIcon;
	onPress: () => void;
	/** What a tap does, when the label does not say it: "Shows the runs of every project". */
	accessibilityHint?: string;
}) {
	const reveal = useContext(RevealContext);
	const layout = useRef<{ x: number; width: number } | null>(null);
	useEffect(() => {
		if (selected && layout.current) {
			reveal?.(layout.current.x, layout.current.width, true);
		}
	}, [selected, reveal]);
	return (
		<Button
			onLayout={(event) => {
				const first = layout.current === null;
				const { x, width } = event.nativeEvent.layout;
				layout.current = { x, width };
				if (first && selected) reveal?.(x, width, false);
			}}
			variant={selected ? "default" : "outline"}
			// At least 44 pt, and taller with large text.
			className="h-auto min-h-11 rounded-full px-4 py-2"
			onPress={onPress}
			accessibilityRole="tab"
			accessibilityState={{ selected }}
			accessibilityLabel={count === undefined ? label : `${label}, ${count}`}
			accessibilityHint={accessibilityHint}
		>
			{icon ? <Icon as={icon} /> : null}
			<Text>{label}</Text>
			{count !== undefined ? (
				<Text className="tabular-nums opacity-70">{count}</Text>
			) : null}
		</Button>
	);
}
