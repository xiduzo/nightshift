import { useEffect, useState } from "react";
import { AppState } from "react-native";

/**
 * Whether the app is in front. iOS ends the streams of an app in the
 * background, so the app stops them itself and follows on when it comes
 * back.
 */
export function useInFront(): boolean {
	const [inFront, setInFront] = useState(AppState.currentState === "active");
	useEffect(() => {
		const subscription = AppState.addEventListener("change", (state) =>
			setInFront(state === "active"),
		);
		return () => subscription.remove();
	}, []);
	return inFront;
}
