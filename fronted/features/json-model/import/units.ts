/** Convert a numeric value in the given unit to metres.
 *  Handles ft/in/m (and common spellings); unrecognized units are treated as
 *  already being metres, per the importer spec (never throws on odd units). */
export function toMeters(value: number, unit: string | undefined | null): number {
  const u = (unit ?? "m").trim().toLowerCase();
  switch (u) {
    case "ft":
    case "feet":
    case "foot":
      return value * 0.3048;
    case "in":
    case "inch":
    case "inches":
      return value * 0.0254;
    case "m":
    case "meter":
    case "meters":
    case "metre":
    case "metres":
      return value;
    default:
      return value; // unrecognized unit: assume already metres
  }
}
