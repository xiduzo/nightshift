/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { outcomeColors } from "@nightshift/flows";

import { OUTCOME_HEX } from "./outcome-hex";

/**
 * Every flow color and run status color keeps 4.5:1 (WCAG AA for small
 * text) in both themes, on the phone and on the web: as text on the page
 * and on a card, as text on the soft fill of a chosen option, and under
 * the text of a filled button.
 */

const ROOT = join(import.meta.dir, "../../../../..");
const PHONE = readFileSync(
	join(ROOT, "packages/ui-native/src/styles/global.css"),
	"utf8",
);
const WEB = readFileSync(join(ROOT, "apps/web/src/index.css"), "utf8");
const TAILWIND = readFileSync(
	Bun.resolveSync("tailwindcss/theme.css", import.meta.dir),
	"utf8",
);

type Rgb = [number, number, number];

function num(part: string): number {
	if (part === "none") return 0;
	return part.endsWith("%") ? Number.parseFloat(part) / 100 : Number(part);
}

/** An oklch() color as linear sRGB, clipped to the screen's gamut. */
function oklch(text: string): Rgb {
	const [l = 0, c = 0, h = 0] = text.trim().split(/\s+/).slice(0, 3).map(num);
	const a = c * Math.cos((h * Math.PI) / 180);
	const b = c * Math.sin((h * Math.PI) / 180);
	const lms = [
		(l + 0.3963377774 * a + 0.2158037573 * b) ** 3,
		(l - 0.1055613458 * a - 0.0638541728 * b) ** 3,
		(l - 0.0894841775 * a - 1.291485548 * b) ** 3,
	] as const;
	const clip = (x: number) => Math.min(1, Math.max(0, x));
	return [
		clip(4.0767416621 * lms[0] - 3.3077115913 * lms[1] + 0.2309699292 * lms[2]),
		clip(
			-1.2684380046 * lms[0] + 2.6097574011 * lms[1] - 0.3413193965 * lms[2],
		),
		clip(-0.0041960863 * lms[0] - 0.7034186147 * lms[1] + 1.707614701 * lms[2]),
	];
}

const PALETTE = new Map(
	[...TAILWIND.matchAll(/--color-([a-z]+-\d+):\s*oklch\(([^)]+)\)/g)].map(
		(match) => [match[1] as string, oklch(match[2] as string)],
	),
);

/** A value: `oklch(...)` or `var(--color-red-700)`. */
function color(value: string): Rgb {
	const own = /oklch\(([^)]+)\)/.exec(value);
	if (own) return oklch(own[1] as string);
	const name = /var\(--color-([a-z]+-\d+)\)/.exec(value)?.[1];
	const found = name ? PALETTE.get(name) : undefined;
	if (!found) throw new Error(`Unknown color: ${value}`);
	return found;
}

/** The light and the dark value of a token, in the order the file sets them. */
function themes(css: string, token: string): { light: Rgb; dark: Rgb } {
	const values = [
		...css.matchAll(new RegExp(`${token}:\\s*([^;]+);`, "g")),
	].map((match) => match[1] as string);
	if (values.length < 2)
		throw new Error(`${token} needs a light and a dark value`);
	return {
		light: color(values[0] as string),
		dark: color(values[1] as string),
	};
}

function luminance([r, g, b]: Rgb): number {
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Rgb, b: Rgb): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
		number,
		number,
	];
	return (hi + 0.05) / (lo + 0.05);
}

/** `color/10` over a surface. */
function soft(over: Rgb, under: Rgb): Rgb {
	return over.map(
		(value, at) => 0.1 * value + 0.9 * (under[at] as number),
	) as Rgb;
}

const AA = 4.5;

const surfaces = {
	light: {
		background: themes(PHONE, "--color-background").light,
		card: themes(PHONE, "--color-card").light,
		onButton: themes(PHONE, "--color-primary-foreground").light,
	},
	dark: {
		background: themes(PHONE, "--color-background").dark,
		card: themes(PHONE, "--color-card").dark,
		onButton: themes(PHONE, "--color-primary-foreground").dark,
	},
};

describe("flow colors keep 4.5:1 in both themes", () => {
	for (const name of outcomeColors) {
		for (const [file, css, token] of [
			["phone", PHONE, `--color-outcome-${name}`],
			["web", WEB, `--outcome-${name}`],
		] as const) {
			test(`${name} on the ${file}`, () => {
				const value = themes(css, token);
				for (const theme of ["light", "dark"] as const) {
					const ink = value[theme];
					const { background, card, onButton } = surfaces[theme];
					expect(contrast(ink, background)).toBeGreaterThanOrEqual(AA);
					expect(contrast(ink, card)).toBeGreaterThanOrEqual(AA);
					expect(contrast(ink, soft(ink, card))).toBeGreaterThanOrEqual(AA);
					expect(contrast(onButton, ink)).toBeGreaterThanOrEqual(AA);
				}
			});
		}
	}
});

/** A `#rrggbb` value as linear sRGB. */
function hex(value: string): Rgb {
	const channel = (at: number) => {
		const x = Number.parseInt(value.slice(at, at + 2), 16) / 255;
		return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
	};
	return [channel(1), channel(3), channel(5)];
}

describe("the flow colors as values match the phone's tokens", () => {
	for (const name of outcomeColors) {
		test(name, () => {
			const value = themes(PHONE, `--color-outcome-${name}`);
			for (const theme of ["light", "dark"] as const) {
				const ours = hex(OUTCOME_HEX[theme][name]);
				ours.forEach((channel, at) => {
					expect(Math.abs(channel - (value[theme][at] as number))).toBeLessThan(
						0.01,
					);
				});
			}
		});
	}
});

describe("run status colors keep 4.5:1 as text on the phone", () => {
	for (const status of [
		"running",
		"finished",
		"stopped",
		"failed",
		"interrupted",
		"waiting",
		"sleeping",
	]) {
		test(status, () => {
			const value = themes(PHONE, `--color-status-${status}`);
			for (const theme of ["light", "dark"] as const) {
				const { background, card } = surfaces[theme];
				expect(contrast(value[theme], background)).toBeGreaterThanOrEqual(AA);
				expect(contrast(value[theme], card)).toBeGreaterThanOrEqual(AA);
			}
		});
	}
});
