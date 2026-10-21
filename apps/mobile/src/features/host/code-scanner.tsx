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

import { hostAddressOf } from "@/shared/api";

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
	const [wrongCode, setWrongCode] = useState(false);
	/** The camera reports a code many times a second: take the first. */
	const done = useRef(false);

	function scanned({ data }: BarcodeScanningResult) {
		if (done.current) return;
		const address = hostAddressOf(data);
		if (!address) {
			setWrongCode(true);
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
					onPress={() =>
						refused ? Linking.openSettings() : requestPermission()
					}
				>
					<Text>{refused ? "Open Settings" : "Allow the camera"}</Text>
				</Button>
				<Button variant="outline" onPress={onCancel}>
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
			{wrongCode ? (
				<Alert icon={CircleAlert} variant="destructive">
					<AlertTitle>This code has no Host address</AlertTitle>
					<AlertDescription>
						Scan the code under Settings, "Use Night Shift on your phone".
					</AlertDescription>
				</Alert>
			) : (
				<Text variant="muted">
					Point the camera at the code under Settings, "Use Night Shift on your
					phone", in Night Shift on your computer.
				</Text>
			)}
			<Button variant="outline" onPress={onCancel}>
				<Text>Type the address</Text>
			</Button>
		</View>
	);
}
