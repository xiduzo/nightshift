import type { NativeIcon } from "@/shared/native-list";

/** One action in the run's native header, its ⋯ menu or its bottom toolbar. */
export type HeaderAction = {
	key: string;
	/** "Stop", "Retry", "Transcript". */
	label: string;
	icon: NativeIcon;
	/** A short line under a menu item: what it does. */
	subtitle?: string;
	destructive?: boolean;
	disabled?: boolean;
	onPress: () => void;
};

export type RunHeaderProps = {
	/** The run's one main action: Stop, Retry, Answer. In the header on the right. */
	primary: HeaderAction | null;
	/** The rarer actions: in the ⋯ menu. */
	menu: readonly HeaderAction[];
	/** The run's other views: Transcript, Changed files, Share. The bottom toolbar on iOS, the ⋯ menu on Android. */
	views: readonly HeaderAction[];
};
