import {
	Children,
	isValidElement,
	type ReactElement,
	type ReactNode,
} from "react";
import { View } from "react-native";

/**
 * Children two by two, each half as wide. A child with `wide` takes a row
 * of its own, for a long value such as a run id. Rows grow with their
 * text, so large Dynamic Type does not clip. An odd last tile keeps half
 * the width.
 */
export function TwoColumns({ children }: { children: ReactNode }) {
	const tiles = Children.toArray(children).filter(
		(child): child is ReactElement<{ wide?: boolean }> => isValidElement(child),
	);
	const rows: ReactElement[][] = [];
	let open: ReactElement[] | null = null;
	for (const tile of tiles) {
		if (tile.props.wide) {
			rows.push([tile]);
			open = null;
		} else if (open && open.length < 2) {
			open.push(tile);
		} else {
			open = [tile];
			rows.push(open);
		}
	}
	return (
		<View className="gap-3">
			{rows.map((row, index) => (
				<View key={index} className="flex-row gap-3">
					{row}
					{row.length === 1 &&
					!(row[0] as ReactElement<{ wide?: boolean }>).props.wide ? (
						<View className="flex-1" />
					) : null}
				</View>
			))}
		</View>
	);
}
