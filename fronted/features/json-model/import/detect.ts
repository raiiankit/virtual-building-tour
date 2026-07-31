export type DetectedFormat = "native" | "cubicasa" | "claude-extraction" | "unknown";

/** Sniffs a parsed JSON document to decide which importer (if any) should run
 *  before native schema validation. Purely structural — no schema validation
 *  happens here, that's still schema.ts's job. */
export function detectFormat(raw: unknown): DetectedFormat {
  if (!raw || typeof raw !== "object") return "unknown";
  const obj = raw as Record<string, unknown>;

  // CubiCasa5k plan-analysis export: top-level schemaVersion + coordinateSystem object.
  if (typeof obj.schemaVersion === "string" && obj.coordinateSystem && typeof obj.coordinateSystem === "object") {
    return "cubicasa";
  }

  // claude-opus-5 floor-plan extraction export: project.source string + canvas.pixelsPerFoot number.
  const project = obj.project as Record<string, unknown> | undefined;
  const canvas = obj.canvas as Record<string, unknown> | undefined;
  if (project && typeof project.source === "string" && canvas && typeof canvas.pixelsPerFoot === "number") {
    return "claude-extraction";
  }

  return "unknown";
}
