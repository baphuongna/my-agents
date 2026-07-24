/**
 * Tests for terminal-image capability detection and cell-dimension helpers.
 *
 * These are pure / process.env-driven functions with module-level caches,
 * so we carefully save & restore the relevant environment variables and the
 * cached capabilities between tests.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
	getCellDimensions,
	setCellDimensions,
	detectCapabilities,
	getCapabilities,
	resetCapabilitiesCache,
	setCapabilities,
	allocateImageId,
	encodeKitty,
	encodeITerm2,
	deleteKittyImage,
	deleteAllKittyImages,
	calculateImageCellSize,
	calculateImageRows,
	getPngDimensions,
	getJpegDimensions,
	getGifDimensions,
	getWebpDimensions,
	getImageDimensions,
	renderImage,
	hyperlink,
	imageFallback,
	isImageLine,
	type CellDimensions,
	type TerminalCapabilities,
} from "./terminal-image.ts";

// Every env var read by detectCapabilities(). Snapshot/restore between tests.
const ENV_KEYS = [
	"TERM_PROGRAM",
	"TERMINAL_EMULATOR",
	"TERM",
	"COLORTERM",
	"TMUX",
	"KITTY_WINDOW_ID",
	"GHOSTTY_RESOURCES_DIR",
	"WEZTERM_PANE",
	"WARP_SESSION_ID",
	"WARP_TERMINAL_SESSION_UUID",
	"ITERM_SESSION_ID",
	"WT_SESSION",
] as const;

let savedEnv: Record<string, string | undefined> = {};
const NO_TMUX = (): boolean => false;

function setEnv(vars: Partial<Record<(typeof ENV_KEYS)[number], string>>): void {
	for (const key of ENV_KEYS) delete process.env[key];
	for (const [key, value] of Object.entries(vars)) {
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
}

describe("cell dimensions get/set", () => {
	const original = { ...getCellDimensions() };

	afterEach(() => {
		setCellDimensions(original);
	});

	it("returns the default dimensions", () => {
		const dims = getCellDimensions();
		expect(dims.widthPx).toBeGreaterThan(0);
		expect(dims.heightPx).toBeGreaterThan(0);
	});

	it("round-trips a custom value through set/get", () => {
		const custom: CellDimensions = { widthPx: 10, heightPx: 21 };
		setCellDimensions(custom);
		expect(getCellDimensions()).toEqual(custom);
	});

	it("reflects the most recently set value", () => {
		setCellDimensions({ widthPx: 7, heightPx: 14 });
		expect(getCellDimensions()).toEqual({ widthPx: 7, heightPx: 14 });
		setCellDimensions({ widthPx: 12, heightPx: 24 });
		expect(getCellDimensions().widthPx).toBe(12);
		expect(getCellDimensions().heightPx).toBe(24);
	});
});

describe("detectCapabilities — protocol detection", () => {
	beforeEach(() => {
		savedEnv = {};
		for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
		setEnv({});
		resetCapabilitiesCache();
	});

	afterEach(() => {
		for (const [key, value] of Object.entries(savedEnv)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		resetCapabilitiesCache();
	});

	it("detects Kitty via TERM_PROGRAM", () => {
		setEnv({ TERM_PROGRAM: "kitty" });
		const caps = detectCapabilities(NO_TMUX);
		expect(caps.images).toBe("kitty");
		expect(caps.trueColor).toBe(true);
		expect(caps.hyperlinks).toBe(true);
	});

	it("detects Kitty via KITTY_WINDOW_ID", () => {
		setEnv({ KITTY_WINDOW_ID: "1" });
		const caps = detectCapabilities(NO_TMUX);
		expect(caps.images).toBe("kitty");
	});

	it("detects iTerm2 via TERM_PROGRAM (case-insensitive)", () => {
		setEnv({ TERM_PROGRAM: "iTerm.app" });
		const caps = detectCapabilities(NO_TMUX);
		expect(caps.images).toBe("iterm2");
		expect(caps.trueColor).toBe(true);
		expect(caps.hyperlinks).toBe(true);
	});

	it("detects iTerm2 via ITERM_SESSION_ID", () => {
		setEnv({ ITERM_SESSION_ID: "p:abc" });
		expect(detectCapabilities(NO_TMUX).images).toBe("iterm2");
	});

	it("returns no protocol for a basic/unknown terminal", () => {
		setEnv({ TERM: "xterm-256color" });
		const caps = detectCapabilities(NO_TMUX);
		expect(caps.images).toBeNull();
		expect(caps.hyperlinks).toBe(false);
	});
});

describe("detectCapabilities — terminal multiplexers", () => {
	beforeEach(() => {
		savedEnv = {};
		for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
		setEnv({});
		resetCapabilitiesCache();
	});

	afterEach(() => {
		for (const [key, value] of Object.entries(savedEnv)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		resetCapabilitiesCache();
	});

	it("under tmux disables images and defers hyperlinks to the probe", () => {
		setEnv({ TMUX: "/tmp/tmux-1000/default,1234,0" });
		expect(detectCapabilities(() => true).hyperlinks).toBe(true);
		expect(detectCapabilities(() => false).hyperlinks).toBe(false);
		expect(detectCapabilities(() => true).images).toBeNull();
	});

	it("under tmux (via TERM) also disables images", () => {
		setEnv({ TERM: "tmux-256color" });
		const caps = detectCapabilities(() => false);
		expect(caps.images).toBeNull();
		expect(caps.hyperlinks).toBe(false);
	});

	it("under screen disables images and hyperlinks", () => {
		setEnv({ TERM: "screen-256color" });
		const caps = detectCapabilities(NO_TMUX);
		expect(caps.images).toBeNull();
		expect(caps.hyperlinks).toBe(false);
	});
});

describe("detectCapabilities — other known terminals", () => {
	beforeEach(() => {
		savedEnv = {};
		for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
		setEnv({});
		resetCapabilitiesCache();
	});

	afterEach(() => {
		for (const [key, value] of Object.entries(savedEnv)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		resetCapabilitiesCache();
	});

	it("detects Ghostty (TERM_PROGRAM) as Kitty-capable", () => {
		setEnv({ TERM_PROGRAM: "ghostty" });
		expect(detectCapabilities(NO_TMUX).images).toBe("kitty");
	});

	it("detects Ghostty via GHOSTTY_RESOURCES_DIR", () => {
		setEnv({ GHOSTTY_RESOURCES_DIR: "/opt/ghostty" });
		expect(detectCapabilities(NO_TMUX).images).toBe("kitty");
	});

	it("detects WezTerm via WEZTERM_PANE", () => {
		setEnv({ WEZTERM_PANE: "0" });
		expect(detectCapabilities(NO_TMUX).images).toBe("kitty");
	});

	it("detects Warp via WARP_SESSION_ID", () => {
		setEnv({ WARP_SESSION_ID: "abc" });
		expect(detectCapabilities(NO_TMUX).images).toBe("kitty");
	});

	it("Windows Terminal (WT_SESSION) has trueColor + hyperlinks but no images", () => {
		setEnv({ WT_SESSION: "abc" });
		const caps = detectCapabilities(NO_TMUX);
		expect(caps.images).toBeNull();
		expect(caps.trueColor).toBe(true);
		expect(caps.hyperlinks).toBe(true);
	});

	it("VSCode terminal has hyperlinks but no image protocol", () => {
		setEnv({ TERM_PROGRAM: "vscode" });
		const caps = detectCapabilities(NO_TMUX);
		expect(caps.images).toBeNull();
		expect(caps.hyperlinks).toBe(true);
		expect(caps.trueColor).toBe(true);
	});

	it("JetBrains (jediterm) disables hyperlinks", () => {
		setEnv({ TERMINAL_EMULATOR: "JetBrains-JediTerm" });
		const caps = detectCapabilities(NO_TMUX);
		expect(caps.images).toBeNull();
		expect(caps.hyperlinks).toBe(false);
	});
});

describe("detectCapabilities — COLORTERM trueColor hint", () => {
	beforeEach(() => {
		savedEnv = {};
		for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
		setEnv({});
		resetCapabilitiesCache();
	});

	afterEach(() => {
		for (const [key, value] of Object.entries(savedEnv)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		resetCapabilitiesCache();
	});

	it("reports trueColor when COLORTERM=truecolor on an unknown terminal", () => {
		setEnv({ TERM: "xterm", COLORTERM: "truecolor" });
		expect(detectCapabilities(NO_TMUX).trueColor).toBe(true);
	});

	it("reports trueColor when COLORTERM=24bit", () => {
		setEnv({ COLORTERM: "24bit" });
		expect(detectCapabilities(NO_TMUX).trueColor).toBe(true);
	});

	it("reports false for trueColor when no hint on an unknown terminal", () => {
		setEnv({ TERM: "xterm" });
		expect(detectCapabilities(NO_TMUX).trueColor).toBe(false);
	});
});

describe("capabilities caching", () => {
	beforeEach(() => {
		savedEnv = {};
		for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
		setEnv({});
		resetCapabilitiesCache();
	});

	afterEach(() => {
		for (const [key, value] of Object.entries(savedEnv)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		resetCapabilitiesCache();
	});

	it("getCapabilities caches the detected result (same reference)", () => {
		setEnv({ TERM_PROGRAM: "kitty" });
		const first = getCapabilities();
		const second = getCapabilities();
		expect(second).toBe(first);
	});

	it("resetCapabilitiesCache forces a re-detection", () => {
		setEnv({ TERM_PROGRAM: "kitty" });
		const first = getCapabilities();
		resetCapabilitiesCache();
		// Same env → re-detects to an equal (but distinct) object.
		const second = getCapabilities();
		expect(second).toEqual(first);
		expect(second).not.toBe(first);
	});

	it("re-detection after reset reflects a changed environment", () => {
		setEnv({ TERM_PROGRAM: "kitty" });
		expect(getCapabilities().images).toBe("kitty");

		resetCapabilitiesCache();
		setEnv({ TERM_PROGRAM: "iTerm.app" });
		expect(getCapabilities().images).toBe("iterm2");
	});

	it("setCapabilities overrides the cache directly", () => {
		const override: TerminalCapabilities = {
			images: "iterm2",
			trueColor: false,
			hyperlinks: false,
		};
		setCapabilities(override);
		expect(getCapabilities()).toBe(override);
		resetCapabilitiesCache();
	});
});

describe("ImageProtocol type values", () => {
	it("accepts the three allowed protocol values", () => {
		const protocols: ("kitty" | "iterm2" | null)[] = ["kitty", "iterm2", null];
		expect(protocols).toContain("kitty");
		expect(protocols).toContain("iterm2");
		expect(protocols).toContain(null);
	});
});

// --- Minimal valid image-buffer builders (base64-encoded) ---
// PNG: 8-byte signature + IHDR chunk; width@16, height@20 (big endian)
function makePng(width: number, height: number): string {
	const buf = Buffer.alloc(24);
	buf[0] = 0x89;
	buf[1] = 0x50;
	buf[2] = 0x4e;
	buf[3] = 0x47;
	buf[4] = 0x0d;
	buf[5] = 0x0a;
	buf[6] = 0x1a;
	buf[7] = 0x0a;
	buf.writeUInt32BE(13, 8); // IHDR length
	buf.write("IHDR", 12, "ascii");
	buf.writeUInt32BE(width, 16);
	buf.writeUInt32BE(height, 20);
	return buf.toString("base64");
}

// GIF: "GIF89a" + logical screen descriptor; width@6, height@8 (little endian)
function makeGif(width: number, height: number): string {
	const buf = Buffer.alloc(13);
	buf.write("GIF89a", 0, "ascii");
	buf.writeUInt16LE(width, 6);
	buf.writeUInt16LE(height, 8);
	return buf.toString("base64");
}

// JPEG: SOI + SOF0 marker; height@(offset+5), width@(offset+7) (big endian)
function makeJpeg(width: number, height: number): string {
	const buf = Buffer.alloc(13);
	buf[0] = 0xff;
	buf[1] = 0xd8; // SOI
	buf[2] = 0xff;
	buf[3] = 0xc0; // SOF0 marker
	buf.writeUInt16BE(0x0008, 4); // segment length
	buf[6] = 8; // precision
	buf.writeUInt16BE(height, 7); // height (offset 2 + 5)
	buf.writeUInt16BE(width, 9); // width (offset 2 + 7)
	return buf.toString("base64");
}

// WebP VP8X: RIFF/WEBP + VP8X chunk; width@24 height@27 (3-byte LE, +1)
function makeWebpVp8x(width: number, height: number): string {
	const buf = Buffer.alloc(30);
	buf.write("RIFF", 0, "ascii");
	buf.write("WEBP", 8, "ascii");
	buf.write("VP8X", 12, "ascii");
	const w = width - 1;
	buf[24] = w & 0xff;
	buf[25] = (w >> 8) & 0xff;
	buf[26] = (w >> 16) & 0xff;
	const h = height - 1;
	buf[27] = h & 0xff;
	buf[28] = (h >> 8) & 0xff;
	buf[29] = (h >> 16) & 0xff;
	return buf.toString("base64");
}

// WebP VP8L: width/height packed into a 32-bit LE word at offset 21
function makeWebpVp8l(width: number, height: number): string {
	const buf = Buffer.alloc(30);
	buf.write("RIFF", 0, "ascii");
	buf.write("WEBP", 8, "ascii");
	buf.write("VP8L", 12, "ascii");
	const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
	buf.writeUInt32LE(bits, 21);
	return buf.toString("base64");
}

// WebP VP8 (lossy): width@26 height@28 (16-bit LE & 0x3fff)
function makeWebpVp8(width: number, height: number): string {
	const buf = Buffer.alloc(30);
	buf.write("RIFF", 0, "ascii");
	buf.write("WEBP", 8, "ascii");
	buf.write("VP8 ", 12, "ascii");
	buf.writeUInt16LE(width & 0x3fff, 26);
	buf.writeUInt16LE(height & 0x3fff, 28);
	return buf.toString("base64");
}

describe("isImageLine", () => {
	it("detects a Kitty image line at the start", () => {
		expect(isImageLine("\x1b_Ga=T,f=100,q=2;data\x1b\\")).toBe(true);
	});

	it("detects an iTerm2 image line at the start", () => {
		expect(isImageLine("\x1b]1337;File=inline=1:data\x07")).toBe(true);
	});

	it("detects image data embedded behind a cursor-up prefix", () => {
		expect(isImageLine("\x1b[1A\x1b_Ga=T,q=2;data\x1b\\")).toBe(true);
	});

	it("returns false for plain text", () => {
		expect(isImageLine("hello world")).toBe(false);
	});

	it("returns false for an empty string", () => {
		expect(isImageLine("")).toBe(false);
	});
});

describe("allocateImageId", () => {
	it("returns a positive integer within the Kitty ID range", () => {
		const id = allocateImageId();
		expect(Number.isInteger(id)).toBe(true);
		expect(id).toBeGreaterThanOrEqual(1);
		expect(id).toBeLessThanOrEqual(0xffffffff);
	});

	it("produces a wide spread of distinct ids across calls", () => {
		const ids = new Set<number>();
		for (let i = 0; i < 1000; i++) ids.add(allocateImageId());
		expect(ids.size).toBeGreaterThan(1);
	});
});

describe("encodeKitty", () => {
	it("encodes short data in a single chunk", () => {
		expect(encodeKitty("aGVsbG8=")).toBe("\x1b_Ga=T,f=100,q=2;aGVsbG8=\x1b\\");
	});

	it("includes columns, rows and imageId when provided", () => {
		const result = encodeKitty("ZGF0YQ==", { columns: 20, rows: 10, imageId: 5 });
		expect(result).toContain("c=20");
		expect(result).toContain("r=10");
		expect(result).toContain("i=5");
	});

	it("adds C=1 when moveCursor is false", () => {
		expect(encodeKitty("ZGF0YQ==", { moveCursor: false })).toContain("C=1");
	});

	it("omits C=1 when moveCursor is true (default)", () => {
		expect(encodeKitty("ZGF0YQ==")).not.toContain("C=1");
	});

	it("chunks data longer than 4096 bytes using m=1 / m=0", () => {
		const longData = "A".repeat(10000);
		const result = encodeKitty(longData);
		const kittyChunks = result.split("\x1b_G").length - 1;
		expect(kittyChunks).toBeGreaterThan(1);
		expect(result).toContain("m=1");
		expect(result).toContain("m=0");
	});
});

describe("encodeITerm2", () => {
	it("encodes with default inline=1", () => {
		expect(encodeITerm2("aGVsbG8=")).toBe("\x1b]1337;File=inline=1:aGVsbG8=\x07");
	});

	it("sets inline=0 when explicitly disabled", () => {
		expect(encodeITerm2("ZGF0YQ==", { inline: false })).toContain("inline=0");
	});

	it("includes width and height when provided", () => {
		const result = encodeITerm2("ZGF0YQ==", { width: 20, height: 10 });
		expect(result).toContain("width=20");
		expect(result).toContain("height=10");
	});

	it("base64-encodes the name parameter", () => {
		const nameB64 = Buffer.from("cat.png").toString("base64");
		expect(encodeITerm2("ZGF0YQ==", { name: "cat.png" })).toContain(`name=${nameB64}`);
	});

	it("adds preserveAspectRatio=0 when false", () => {
		expect(encodeITerm2("ZGF0YQ==", { preserveAspectRatio: false })).toContain("preserveAspectRatio=0");
	});
});

describe("deleteKittyImage", () => {
	it("produces the delete-by-id escape sequence", () => {
		expect(deleteKittyImage(7)).toBe("\x1b_Ga=d,d=I,i=7,q=2\x1b\\");
	});
});

describe("deleteAllKittyImages", () => {
	it("produces the delete-all escape sequence", () => {
		expect(deleteAllKittyImages()).toBe("\x1b_Ga=d,d=A,q=2\x1b\\");
	});
});

describe("calculateImageCellSize", () => {
	it("fits an image to max width with default cell dimensions", () => {
		const size = calculateImageCellSize({ widthPx: 180, heightPx: 360 }, 20);
		expect(size.columns).toBe(20);
		expect(size.rows).toBe(20);
	});

	it("clamps to maxHeightCells when height is the limiting axis", () => {
		const size = calculateImageCellSize({ widthPx: 180, heightPx: 360 }, 20, 10);
		expect(size.columns).toBe(10);
		expect(size.rows).toBe(10);
	});

	it("honours custom cell dimensions", () => {
		const size = calculateImageCellSize({ widthPx: 90, heightPx: 180 }, 10, undefined, {
			widthPx: 9,
			heightPx: 18,
		});
		expect(size.columns).toBe(10);
		expect(size.rows).toBe(10);
	});

	it("returns at least 1 column and 1 row for tiny images", () => {
		const size = calculateImageCellSize({ widthPx: 1, heightPx: 1 }, 1);
		expect(size.columns).toBeGreaterThanOrEqual(1);
		expect(size.rows).toBeGreaterThanOrEqual(1);
	});
});

describe("calculateImageRows", () => {
	it("returns 20 for a 180x360 image at 20 columns", () => {
		expect(calculateImageRows({ widthPx: 180, heightPx: 360 }, 20)).toBe(20);
	});

	it("matches the rows reported by calculateImageCellSize", () => {
		const dims = { widthPx: 180, heightPx: 360 };
		expect(calculateImageRows(dims, 20)).toBe(calculateImageCellSize(dims, 20).rows);
	});
});

describe("getPngDimensions", () => {
	it("parses width and height from a minimal PNG", () => {
		expect(getPngDimensions(makePng(10, 20))).toEqual({ widthPx: 10, heightPx: 20 });
	});

	it("returns null for an invalid PNG signature", () => {
		const buf = Buffer.alloc(24, 0);
		expect(getPngDimensions(buf.toString("base64"))).toBeNull();
	});

	it("returns null for buffers shorter than 24 bytes", () => {
		const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		expect(getPngDimensions(buf.toString("base64"))).toBeNull();
	});
});

describe("getJpegDimensions", () => {
	it("parses width and height from a minimal JPEG SOF0", () => {
		expect(getJpegDimensions(makeJpeg(100, 200))).toEqual({ widthPx: 100, heightPx: 200 });
	});

	it("returns null for an invalid JPEG signature", () => {
		const buf = Buffer.alloc(10, 0);
		expect(getJpegDimensions(buf.toString("base64"))).toBeNull();
	});
});

describe("getGifDimensions", () => {
	it("parses width and height from a minimal GIF89a", () => {
		expect(getGifDimensions(makeGif(320, 240))).toEqual({ widthPx: 320, heightPx: 240 });
	});

	it("parses a GIF87a signature", () => {
		const buf = Buffer.alloc(10);
		buf.write("GIF87a", 0, "ascii");
		buf.writeUInt16LE(16, 6);
		buf.writeUInt16LE(16, 8);
		expect(getGifDimensions(buf.toString("base64"))).toEqual({ widthPx: 16, heightPx: 16 });
	});

	it("returns null for an invalid signature", () => {
		const buf = Buffer.alloc(10, 0);
		expect(getGifDimensions(buf.toString("base64"))).toBeNull();
	});
});

describe("getWebpDimensions", () => {
	it("parses a VP8X chunk", () => {
		expect(getWebpDimensions(makeWebpVp8x(640, 480))).toEqual({ widthPx: 640, heightPx: 480 });
	});

	it("parses a VP8L chunk", () => {
		expect(getWebpDimensions(makeWebpVp8l(256, 128))).toEqual({ widthPx: 256, heightPx: 128 });
	});

	it("parses a VP8 (lossy) chunk", () => {
		expect(getWebpDimensions(makeWebpVp8(200, 100))).toEqual({ widthPx: 200, heightPx: 100 });
	});

	it("returns null for a non-WebP RIFF file", () => {
		const buf = Buffer.alloc(30);
		buf.write("RIFF", 0, "ascii");
		buf.write("WAVE", 8, "ascii");
		expect(getWebpDimensions(buf.toString("base64"))).toBeNull();
	});
});

describe("getImageDimensions", () => {
	it("dispatches to the PNG parser", () => {
		expect(getImageDimensions(makePng(10, 20), "image/png")).toEqual({ widthPx: 10, heightPx: 20 });
	});

	it("dispatches to the JPEG parser", () => {
		expect(getImageDimensions(makeJpeg(10, 20), "image/jpeg")).toEqual({ widthPx: 10, heightPx: 20 });
	});

	it("dispatches to the GIF parser", () => {
		expect(getImageDimensions(makeGif(10, 20), "image/gif")).toEqual({ widthPx: 10, heightPx: 20 });
	});

	it("dispatches to the WebP parser", () => {
		expect(getImageDimensions(makeWebpVp8x(10, 20), "image/webp")).toEqual({ widthPx: 10, heightPx: 20 });
	});

	it("returns null for an unsupported mime type", () => {
		expect(getImageDimensions(makePng(10, 20), "image/bmp")).toBeNull();
	});
});

describe("renderImage", () => {
	afterEach(() => resetCapabilitiesCache());

	it("returns null when no image protocol is available", () => {
		setCapabilities({ images: null, trueColor: false, hyperlinks: false });
		expect(renderImage("aGVsbG8=", { widthPx: 180, heightPx: 360 })).toBeNull();
	});

	it("encodes Kitty graphics when images is 'kitty'", () => {
		setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
		const result = renderImage("aGVsbG8=", { widthPx: 180, heightPx: 360 });
		expect(result).not.toBeNull();
		expect(result!.sequence).toContain("\x1b_G");
		expect(result!.rows).toBeGreaterThan(0);
	});

	it("passes the imageId through for Kitty", () => {
		setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
		const result = renderImage("aGVsbG8=", { widthPx: 180, heightPx: 360 }, { imageId: 42 });
		expect(result!.sequence).toContain("i=42");
		expect(result!.imageId).toBe(42);
	});

	it("encodes iTerm2 when images is 'iterm2'", () => {
		setCapabilities({ images: "iterm2", trueColor: true, hyperlinks: true });
		const result = renderImage("aGVsbG8=", { widthPx: 180, heightPx: 360 });
		expect(result).not.toBeNull();
		expect(result!.sequence).toContain("\x1b]1337;File=");
	});
});

describe("hyperlink", () => {
	it("wraps text in an OSC 8 hyperlink sequence", () => {
		expect(hyperlink("click", "https://example.com")).toBe(
			"\x1b]8;;https://example.com\x1b\\click\x1b]8;;\x1b\\",
		);
	});

	it("contains the visible text", () => {
		expect(hyperlink("docs", "https://docs.example.com")).toContain("docs");
	});
});

describe("imageFallback", () => {
	it("formats the mime type only", () => {
		expect(imageFallback("image/png")).toBe("[Image: [image/png]]");
	});

	it("includes dimensions when provided", () => {
		expect(imageFallback("image/png", { widthPx: 100, heightPx: 200 })).toBe(
			"[Image: [image/png] 100x200]",
		);
	});

	it("places the filename first when provided", () => {
		expect(imageFallback("image/png", { widthPx: 10, heightPx: 20 }, "photo.png")).toBe(
			"[Image: photo.png [image/png] 10x20]",
		);
	});

	it("includes the filename even without dimensions", () => {
		expect(imageFallback("image/jpeg", undefined, "photo.jpg")).toBe("[Image: photo.jpg [image/jpeg]]");
	});
});
