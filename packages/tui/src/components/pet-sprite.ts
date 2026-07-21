/**
 * @my-agent/tui — Pet sprite renderer (truecolor half-block).
 * H12: renders ASCII art pet sprites in the TUI status bar.
 * Source: PLAN-FEATURES H12.
 */

export interface PetSprite {
  name: string;
  frames: string[]; // ASCII art frames (cycling animation)
  color: [number, number, number]; // RGB truecolor
}

export const PET_SPRITES: PetSprite[] = [
  {
    name: "cat",
    color: [255, 180, 100],
    frames: [
      " /\\_/\\\n( o.o )\n > ^ <",
      " /\\_/\\\n( -.- )\n > ^ <",
      " /\\_/\\\n( ^.^ )\n > ^ <",
    ],
  },
  {
    name: "dog",
    color: [180, 140, 100],
    frames: [
      "  /\\__\n (    @___\n /         O\n/   (____/\n/_____/   U",
      "  /\\__\n (    @___\n /         O\n/   (____/\n/_____/   u",
    ],
  },
  {
    name: "robot",
    color: [100, 200, 255],
    frames: [
      " [♢_♢]\n |[_]|\n  _|_",
      " [♢_♢]\n |[ ]|\n  _|_",
    ],
  },
];

/** Render a pet sprite frame with truecolor ANSI codes. */
export function renderPetSprite(sprite: PetSprite, frameIndex: number): string {
  const frame = sprite.frames[frameIndex % sprite.frames.length]!;
  const [r, g, b] = sprite.color;
  const prefix = `\x1b[38;2;${r};${g};${b}m`;
  const suffix = "\x1b[0m";
  return prefix + frame + suffix;
}

/** Get a random pet sprite by name. */
export function getPetSprite(name: string): PetSprite | undefined {
  return PET_SPRITES.find((p) => p.name === name);
}
