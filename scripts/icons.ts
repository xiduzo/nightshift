/**
 * Draws every Night Shift icon from one mark and puts each file where its
 * app reads it: the web app (favicons, Home Screen icons), the phone app
 * (app icon, Android layers, splash) and the desktop app (app icons, menu
 * bar icon).
 *
 *   bun run icons                                  # the moon 🌘 of OpenMoji
 *   bun run icons <mark.svg|png> [--light <mark>]  # a new mark
 *
 * The mark is a square SVG or PNG: the logo on a clear background, drawn
 * for a dark background and filling the square. `--light` is the same logo
 * for a light background (the light favicon and splash). It defaults to the
 * mark. A PNG should be at least 1024 pixels wide.
 *
 * The moon icons are OpenMoji (https://openmoji.org), CC BY-SA 4.0, from the
 * `openmoji` package. The static icons show the waning crescent 🌘. The web
 * and desktop apps also get one icon per phase: their logo follows the moon.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { parseArgs } from "node:util";

import { Resvg } from "@resvg/resvg-js";

const root = join(import.meta.dir, "..");
const DARK = "#0a0a0a";
const WAITING_LIGHT = "#975800";
const WAITING_DARK = "#f7bc50";

const { values, positionals } = parseArgs({
	args: Bun.argv.slice(2),
	options: { light: { type: "string" } },
	allowPositionals: true,
});

/** A mark as a data URL, to place in an SVG. */
function dataUrl(path: string): string {
	const type = { ".svg": "image/svg+xml", ".png": "image/png" }[
		extname(path).toLowerCase()
	];
	if (!type) throw new Error(`Give an SVG or PNG file, not ${path}.`);
	return `data:${type};base64,${readFileSync(path).toString("base64")}`;
}

/** An OpenMoji emoji by code point, cropped to its disc, as a data URL. */
function openmoji(code: string): string {
	// OpenMoji draws on a 72-unit grid with a margin. The moons fill 8 to 64.
	const source = readFileSync(
		Bun.resolveSync(`openmoji/color/svg/${code}.svg`, import.meta.dir),
		"utf8",
	).replace('viewBox="0 0 72 72"', 'viewBox="7 7 58 58"');
	return `data:image/svg+xml;base64,${Buffer.from(source).toString("base64")}`;
}

// The static mark: the waning crescent, 🌘.
const STATIC_MOON = "1F318";
const mark = positionals[0] ? dataUrl(positionals[0]) : openmoji(STATIC_MOON);
const markLight = values.light ? dataUrl(values.light) : mark;

/** The mark, centred in a 64-unit square at `size` units wide. */
function place(href: string, size: number, attributes = ""): string {
	const at = (64 - size) / 2;
	return `<image href="${href}" x="${at}" y="${at}" width="${size}" height="${size}" ${attributes}/>`;
}

/**
 * Paints the light parts of the mark one colour and drops the dark parts:
 * of the moon, only the lit side stays.
 */
function silhouette(colour: string): string {
	return `<filter id="s" color-interpolation-filters="sRGB"><feColorMatrix type="luminanceToAlpha" result="l"/><feComponentTransfer in="l" result="a"><feFuncA type="discrete" tableValues="0 1"/></feComponentTransfer><feFlood flood-color="${colour}"/><feComposite in2="a" operator="in"/></filter>`;
}

const svg = (body: string, title = "Night Shift") =>
	`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><title>${title}</title>${body}</svg>\n`;

// A full square tile, for the Home Screen, iOS and Windows.
const tile = svg(
	`<rect width="64" height="64" fill="${DARK}"/>${place(mark, 40)}`,
);
// The macOS grid: a rounded square of 824/1024, with a margin around it.
const macTile = svg(
	`<rect x="6.25" y="6.25" width="51.5" height="51.5" rx="11.6" fill="${DARK}"/>${place(mark, 36)}`,
);
// Android adaptive layers: the mark inside the safe zone, on its own.
const androidForeground = svg(place(mark, 27));
const androidBackground = svg(`<rect width="64" height="64" fill="${DARK}"/>`);
const androidMonochrome = svg(
	`${silhouette("#ffffff")}${place(mark, 27, 'filter="url(#s)"')}`,
);
// Splash: the mark alone, in the colours of each theme.
const splashLight = svg(place(markLight, 52));
const splashDark = svg(place(mark, 52));

// The browser tab: the mark in the colours of the browser theme.
const themed =
	"<style>.dark{display:none}@media (prefers-color-scheme: dark){.light{display:none}.dark{display:inline}}</style>";
const favicon = svg(
	`${themed}${place(markLight, 60, 'class="light"')}${place(mark, 60, 'class="dark"')}`,
);

function write(path: string, data: string | Buffer) {
	const out = join(root, path);
	mkdirSync(dirname(out), { recursive: true });
	writeFileSync(out, data);
	console.log(path);
}

function png(source: string, size: number, path: string) {
	const image = new Resvg(source, {
		fitTo: { mode: "width", value: size },
		font: { loadSystemFonts: false },
	});
	write(path, image.render().asPng());
}

const web = "apps/web/public";
write(`${web}/favicon.svg`, favicon);
write(`${web}/app-icon.svg`, tile);
png(tile, 180, `${web}/apple-touch-icon.png`);
png(tile, 192, `${web}/icon-192.png`);
png(tile, 512, `${web}/icon-512.png`);

const mobile = "apps/mobile/assets/images";
png(tile, 1024, `${mobile}/icon.png`);
png(tile, 48, `${mobile}/favicon.png`);
png(androidForeground, 512, `${mobile}/android-icon-foreground.png`);
png(androidBackground, 512, `${mobile}/android-icon-background.png`);
png(androidMonochrome, 432, `${mobile}/android-icon-monochrome.png`);
png(splashLight, 1024, `${mobile}/splash-icon.png`);
png(splashDark, 1024, `${mobile}/splash-icon-dark.png`);

const desktop = "apps/desktop/assets";
for (const size of [16, 32, 128, 256, 512]) {
	png(macTile, size, `${desktop}/icon.iconset/icon_${size}x${size}.png`);
	png(macTile, size * 2, `${desktop}/icon.iconset/icon_${size}x${size}@2x.png`);
}
png(tile, 512, `${desktop}/icon.png`);

/*
 * The moon: the logo follows the phase of the moon, one icon per phase.
 * The phases are OpenMoji (https://openmoji.org), CC BY-SA 4.0, from
 * the `openmoji` package by code point. The web app shows them in the sidebar
 * and the browser tab, the desktop app in the Dock and the menu bar.
 */
const MOON = [
	"1F311",
	"1F312",
	"1F313",
	"1F314",
	"1F315",
	"1F316",
	"1F317",
	"1F318",
];
MOON.forEach((code, phase) => {
	const moon = openmoji(code);
	write(`${web}/moon/${phase}.svg`, svg(place(moon, 60)));
	write(
		`${web}/moon/${phase}-waiting.svg`,
		svg(
			`<style>.dot{fill:${WAITING_LIGHT}}@media (prefers-color-scheme: dark){.dot{fill:${WAITING_DARK}}}</style>
	<mask id="cut"><rect width="64" height="64" fill="#fff"/><circle cx="50" cy="14" r="17" fill="#000"/></mask>
	<g mask="url(#cut)">${place(moon, 60)}</g>
	<circle class="dot" cx="50" cy="14" r="13"/>`,
			"Night Shift: a Gate waits for you",
		),
	);
	png(svg(place(moon, 64)), 36, `${desktop}/moon/tray-${phase}.png`);
	png(
		svg(
			`<rect x="6.25" y="6.25" width="51.5" height="51.5" rx="11.6" fill="${DARK}"/>${place(moon, 36)}`,
		),
		1024,
		`${desktop}/moon/dock-${phase}.png`,
	);
});
