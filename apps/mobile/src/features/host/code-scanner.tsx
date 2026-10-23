import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui-native/components/ui/alert";
import { Button } from "@nightshift/ui-native/components/ui/button";
import { Text } from "@nightshift/ui-native/components/ui/text";
import {
	type BarcodeScanningResult,
	CameraView,
	useCameraPermissions,
} from "expo-camera";
import { CameraOff, CircleAlert } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Linking, View } from "react-native";

import { hostAddressOf, needsHttps } from "@/shared/api";

type CodeScannerProps = {
	/** The Host address in the code. */
	onScanned(address: string): void;
	onCancel(): void;
};

/**
 * Scans the code that Night Shift shows under Settings, "Use Night Shift
 * on your phone". The code holds the Host address only. The camera asks
 * for permission first; when the person refused it, they can allow it in
 * the phone's settings or type the address.
 */
export function CodeScanner({ onScanned, onCancel }: CodeScannerProps) {
	const [permission, requestPermission] = useCameraPermissions();
	/** What was wrong with the last code: none, no Host address, or `http://`. */
	const [wrongCode, setWrongCode] = useState<"none" | "no-address" | "http">(
		"none",
	);
	/** The camera reports a code many times a second: take the first. */
	const done = useRef(false);

	function scanned({ data }: BarcodeScanningResult) {
		if (done.current) return;
		const address = hostAddressOf(data);
		if (!address) {
			setWrongCode(needsHttps(data) ? "http" : "no-address");
			return;
		}
		done.current = true;
		onScanned(address);
	}

	// The first time, the phone asks for the camera at once.
	useEffect(() => {
		if (permission?.status === "undetermined" && permission.canAskAgain) {
			void requestPermission();
		}
	}, [permission, requestPermission]);

	if (!permission) return null;

	if (!permission.granted) {
		const refused = !permission.canAskAgain;
		return (
			<View className="gap-4">
				<Alert icon={CameraOff}>
					<AlertTitle>
						{refused
							? "Night Shift cannot use the camera"
							: "Allow the camera to scan the code"}
					</AlertTitle>
					<AlertDescription>
						{refused
							? "Allow the camera for Night Shift in the Settings app of your phone. Or type the Host address."
							: "Night Shift uses the camera only to read the code. It keeps no pictures."}
					</AlertDescription>
				</Alert>
				<Button
					size="lg"
					onPress={() =>
						refused ? Linking.openSettings() : requestPermission()
					}
					className="h-auto min-h-11 py-2"
				>
					<Text>{refused ? "Open Settings" : "Allow the camera"}</Text>
				</Button>
				<Button
					size="lg"
					variant="outline"
					onPress={onCancel}
					className="h-auto min-h-11 py-2"
				>
					<Text>Type the address</Text>
				</Button>
			</View>
		);
	}

	return (
		<View className="gap-4">
			<View className="aspect-square overflow-hidden rounded-lg bg-muted">
				<CameraView
					style={{ flex: 1 }}
					facing="back"
					barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
					onBarcodeScanned={scanned}
				/>
			</View>
			{wrongCode === "http" ? (
				<Alert icon={CircleAlert} variant="destructive">
					<AlertTitle>This code has no https:// address</AlertTitle>
					<AlertDescription>
						A Host needs an https:// address. Scan the code under Settings, "Use
						Night Shift on your phone".
					</AlertDescription>
				</Alert>
			) : wrongCode === "no-address" ? (
				<Alert icon={CircleAlert} variant="destructive">
					<AlertTitle>This code has no Host address</AlertTitle>
					<AlertDescription>
						Scan the code under Settings, "Use Night Shift on your phone".
					</AlertDescription>
				</Alert>
			) : (
				<Text variant="muted" className="text-muted-foreground">
					Point the camera at the code under Settings, "Use Night Shift on your
					phone", in Night Shift on your computer.
				</Text>
			)}
			<Button
				size="lg"
				variant="outline"
				onPress={onCancel}
				className="h-auto min-h-11 py-2"
			>
				<Text>Type the address</Text>
			</Button>
		</View>
	);
}
