import { jsonModelSchema, parseJsonModel, staircaseContinuityIssues, type JsonModelInput, type ValidationIssue } from "../schema";
import { detectFormat } from "./detect";
import { importCubicasa } from "./cubicasa";
import { importClaudeExtraction } from "./claude-extraction";

export type ImportFormat = "native" | "cubicasa" | "claude-extraction";

export interface ParseAnyResult {
  ok: boolean;
  data: JsonModelInput | null;
  issues: ValidationIssue[];
  notes: string[];
  format: ImportFormat;
}

function zodIssuesToValidationIssues(issues: { path: (string | number)[]; message: string }[]): ValidationIssue[] {
  return issues.map((iss) => ({
    path: iss.path.length ? iss.path.join(".") : "(root)",
    message: iss.message,
  }));
}

/** Auto-detects whether pasted JSON is the native schema, a CubiCasa5k
 *  plan-analysis export, or a claude-opus-5 floor-plan extraction, converts
 *  external formats into the native shape, and validates the result through
 *  the same zod schema as native input. External-format conversions surface
 *  informational `notes` (non-blocking) in addition to any `issues`. */
export function parseAnyBuildingJson(text: string): ParseAnyResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return {
      ok: false,
      data: null,
      issues: [{ path: "(document)", message: `Invalid JSON: ${(e as Error).message}` }],
      notes: [],
      format: "native",
    };
  }

  const detected = detectFormat(parsed);

  if (detected === "cubicasa" || detected === "claude-extraction") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, notes } = detected === "cubicasa" ? importCubicasa(parsed as any) : importClaudeExtraction(parsed as any);
    const result = jsonModelSchema.safeParse(data);
    if (!result.success) {
      return { ok: false, data: null, issues: zodIssuesToValidationIssues(result.error.issues), notes, format: detected };
    }
    return { ok: true, data: result.data, issues: staircaseContinuityIssues(result.data.rooms), notes, format: detected };
  }

  // Not a recognized external format — delegate untouched to the existing native parser.
  const nativeResult = parseJsonModel(text);
  return { ok: nativeResult.ok, data: nativeResult.data ?? null, issues: nativeResult.issues, notes: [], format: "native" };
}
