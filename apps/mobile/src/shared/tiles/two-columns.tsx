import {
	Children,
	isValidElement,
	type ReactElement,
	type ReactNode,
} from "react";
import { View } from "react-native";

/**
 * Children two by two, each half as wide. Rows grow with their text, so
 * large Dynamic Type does not clip. An odd last tile keeps half the width.
 */
export function TwoColumns({ children }: { children: ReactNode }) {
	const tiles = Children.toArray(children).filter(
		(child): child is ReactElement => isValidElement(child),
	);
	const rows: ReactElement[][] = [];
	for (let index = 0; index < tiles.length; index += 2) {
		rows.push(tiles.slice(index, index + 2));
	}
	return (
		<View className="gap-3">
			{rows.map((row, index) => (
				<View key={index} className="flex-row gap-3">
					{row}
					{row.length === 1 ? <View className="flex-1" /> : null}
				</View>
			))}
		</View>
	);
}
