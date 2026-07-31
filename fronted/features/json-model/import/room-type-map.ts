import type { RoomType } from "../schema";

interface Rule { test: (s: string) => boolean; type: RoomType; }

// Ordered, case-insensitive substring rules — first match wins. Checked against
// whichever hint string is the strongest signal for the source format (see callers).
const RULES: Rule[] = [
  {
    test: (s) => s.includes("bed") && (s.includes("master") || s.includes("primary") || s.includes("m. bed") || s.includes("m bed")),
    type: "master_bedroom",
  },
  { test: (s) => s.includes("bed"), type: "bedroom" },
  { test: (s) => s.includes("kitchen"), type: "kitchen" },
  {
    test: (s) => ["bath", "t&b", "toilet", "wc", "powder", "en-suite", "ensuite", "vanity"].some((k) => s.includes(k)),
    type: "bathroom",
  },
  {
    test: (s) => !s.includes("hallway") && (s.includes("living") || s.includes("lounge") || s.includes("great room") || s.includes("hall")),
    type: "living_room",
  },
  { test: (s) => s.includes("dining") || s.includes("breakfast"), type: "dining" },
  { test: (s) => s.includes("utility") || s.includes("laundry"), type: "utility" },
  { test: (s) => s.includes("garage"), type: "garage" },
  { test: (s) => s.includes("balcony") || s.includes("deck") || s.includes("terrace"), type: "balcony" },
  { test: (s) => s.includes("foyer") || s.includes("entry") || s.includes("porch") || s.includes("mud room"), type: "foyer" },
  { test: (s) => s.includes("passage") || s.includes("corridor") || s.includes("hallway"), type: "corridor" },
  { test: (s) => s.includes("office") || s.includes("meeting") || s.includes("study"), type: "office" },
  { test: (s) => s.includes("stair"), type: "staircase" },
  { test: (s) => s.includes("lift") || s.includes("elevator"), type: "lift" },
  { test: (s) => s.includes("lobby"), type: "foyer" },
];

export interface RoomTypeInference { type: RoomType; matched: boolean; }

/** Maps a set of candidate hint strings (checked in priority order, e.g.
 *  [subtype, name] or [name]) to a native room type. Falls back to the generic
 *  "room" type (matched: false) when nothing recognizable was found — this is
 *  informational, never an error; callers surface it as a non-blocking note. */
export function inferRoomType(hints: Array<string | null | undefined>): RoomTypeInference {
  for (const hint of hints) {
    if (!hint) continue;
    const s = hint.toLowerCase();
    for (const rule of RULES) {
      if (rule.test(s)) return { type: rule.type, matched: true };
    }
  }
  return { type: "room", matched: false };
}
