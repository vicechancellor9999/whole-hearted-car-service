export interface VehicleRecognitionResult {
  readonly plate?: string;
  readonly vin?: string;
  readonly engineNumber?: string;
  readonly make?: string;
  readonly model?: string;
  readonly year?: string;
  readonly color?: string;
  readonly bodyType?: string;
  readonly seating?: string;
  readonly ccRating?: string;
  readonly fuelType?: string;
}

type VehicleRecognitionDraft = Record<string, string>;

const VIN = /\b[A-HJ-NPR-Z0-9]{17}\b/i;
const PLATE = /\b(?:[A-Z]{1,3}[ \t]*\d{3,4}|\d{3,4}[ \t]*[A-Z]{1,3})\b/i;
const OTHER_FIELD_LABEL = /\b(?:OWNER|ADDRESS|YEAR|COLOUR|COLOR|BODY|ENGINE|CHASSIS|SEATING|FUEL|RATING|MODEL|MAKE|PLATE|REGISTRATION|ISSUING)\b/i;

function clean(value: string): string {
  return value.replace(/^[\s:;#.-]+|[\s:;#.-]+$/g, "").replace(/\s+/g, " ").trim();
}

function labelled(lines: readonly string[], patterns: readonly RegExp[]): string | undefined {
  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      const value = match?.[1] ? clean(match[1]) : "";
      if (value) return value;
    }
  }
  return undefined;
}

function afterStandaloneLabel(lines: readonly string[], label: RegExp): string | undefined {
  const index = lines.findIndex((line) => label.test(line));
  return index >= 0 ? lines[index + 1] : undefined;
}

function safeFieldValue(value: string | undefined): string | undefined {
  const candidate = value ? clean(value) : "";
  return candidate && !OTHER_FIELD_LABEL.test(candidate) ? candidate : undefined;
}

function plausibleYear(value: string | undefined): string | undefined {
  if (!value || !/^\d{4}$/.test(value)) return undefined;
  const year = Number(value);
  return year >= 1886 && year <= new Date().getFullYear() + 1 ? value : undefined;
}

function plausibleNumber(value: string | undefined, min: number, max: number): string | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const number = Number(value);
  return number >= min && number <= max ? String(number) : undefined;
}

function normalizedPlate(value: string | undefined): string | undefined {
  const match = value?.toUpperCase().match(PLATE)?.[0];
  if (!match) return undefined;
  return compactVehicleIdentifier(match);
}

function normalizedVin(value: string | undefined): string | undefined {
  return value?.toUpperCase().match(VIN)?.[0];
}

export function compactVehicleIdentifier(value: string): string {
  return value.toUpperCase().replace(/\s+/g, "");
}

export function parseVehicleVinRegionText(text: string): string | undefined {
  const normalized = text.toUpperCase().replace(/\r/g, "\n");
  const spacedCandidate = normalized.match(/(?:[A-HJ-NPR-Z0-9][\s-]*){17}/)?.[0];
  const direct = normalizedVin(spacedCandidate?.replace(/[\s-]+/g, ""));
  if (direct) return direct;

  const lines = normalized.split(/\n+/).map(clean).filter(Boolean);
  const labelIndex = lines.findIndex((line) => /(?:CHASSIS|VIN)(?:\s+(?:NUMBER|NO\.?))?/.test(line));
  if (labelIndex < 0) return undefined;

  let candidate = "";
  for (const line of lines.slice(labelIndex + 1, labelIndex + 5)) {
    if (OTHER_FIELD_LABEL.test(line)) break;
    const token = line.replace(/[^A-Z0-9]/g, "");
    if (!token || !/[A-Z]/.test(token) || !/\d/.test(token)) continue;
    candidate += token;
    if (candidate.length >= 17) break;
  }
  return candidate.length === 17 ? normalizedVin(candidate) : undefined;
}

export function parseVehicleDocumentText(text: string): VehicleRecognitionResult {
  const normalized = text.toUpperCase().replace(/\r/g, "\n");
  const lines = normalized.split(/\n+/).map(clean).filter(Boolean);
  const labelledPlate = labelled(lines, [
    /(?:REGISTRATION|REG(?:ISTRATION)?\.?|PLATE)(?:\s+(?:NUMBER|NO\.?))?\s*[:#-]?\s*(.+)$/i,
  ]);
  const stackedPlate = afterStandaloneLabel(lines, /(?:REG\.?\s*)?PLATE\s+(?:NUMBER|NO\.?)/i);
  const plate = normalizedPlate(labelledPlate) ?? normalizedPlate(stackedPlate) ?? normalizedPlate(normalized);
  const labelledVin = labelled(lines, [
    /(?:CHASSIS|VIN)(?:\s+(?:NUMBER|NO\.?))?\s*[:#-]?\s*(.+)$/i,
  ]);
  const vin = normalizedVin(labelledVin) ?? normalizedVin(normalized) ?? parseVehicleVinRegionText(normalized);
  const engineInline = labelled(lines, [
    /ENGINE(?:\s+(?:NUMBER|NO\.?))?\s*[:#-]?\s*([A-Z0-9-]{5,30})$/i,
  ]);
  const engineStacked = afterStandaloneLabel(lines, /ENGINE\s+NO\.?/i);
  const engineNumber = compactVehicleIdentifier(engineInline ?? engineStacked?.split(/\s+/).find((token) => token.length >= 6 && /[A-Z]/.test(token) && /\d/.test(token)) ?? "") || undefined;
  const make = safeFieldValue(afterStandaloneLabel(lines, /^MAKE$/i))
    ?? safeFieldValue(labelled(lines, [/MAKE\s*[:#-]?\s*([A-Z][A-Z0-9 &.'-]{1,40})$/i]));
  const model = safeFieldValue(afterStandaloneLabel(lines, /^(?:MODEL(?:\/MFG\.?)?(?:\s+TYPE)?)$/i))
    ?? safeFieldValue(labelled(lines, [/MODEL\s*[:#-]?\s*([A-Z0-9][A-Z0-9 &.'\/-]{0,60})$/i]));
  const year = plausibleYear(labelled(lines, [/(?:YEAR|MODEL YEAR)\s*[:#-]?\s*(\d{4})$/i]));
  const color = safeFieldValue(labelled(lines, [/(?:COLOUR|COLOR)\s*[:#-]?\s*([A-Z][A-Z /-]{1,30})$/i]));
  const bodyType = safeFieldValue(labelled(lines, [/(?:BODY TYPE|BODY)\s*[:#-]?\s*([A-Z][A-Z /-]{1,40})$/i]));
  const seating = plausibleNumber(
    labelled(lines, [/(?:SEATING CAPACITY|SEATING|SEATS)\s*[:#-]?\s*(\d{1,2})$/i])
      ?? engineStacked?.match(/^\s*(\d{1,2})\b/)?.[1],
    1,
    20,
  );
  const ccRating = plausibleNumber(
    labelled(lines, [/(?:CC RATING|ENGINE CAPACITY|CC)\s*[:#-]?\s*(\d{2,5})$/i])
      ?? afterStandaloneLabel(lines, /^C\.?C\.?\s+RATING$/i),
    50,
    20_000,
  );
  const fuelType = safeFieldValue(afterStandaloneLabel(lines, /^FUEL(?:\s+TYPE)?$/i))
    ?? safeFieldValue(labelled(lines, [/(?:FUEL TYPE|FUEL)\s*[:#-]?\s*([A-Z][A-Z /-]{1,30})$/i]));

  return Object.fromEntries(Object.entries({
    plate,
    vin,
    engineNumber,
    make,
    model,
    year,
    color,
    bodyType,
    seating,
    ccRating,
    fuelType,
  }).filter((entry): entry is [string, string] => Boolean(entry[1])));
}

export function mergeVehicleRecognition<T extends VehicleRecognitionDraft>(
  current: T,
  recognized: VehicleRecognitionResult,
): T & VehicleRecognitionResult {
  const next = { ...current } as T & VehicleRecognitionResult;
  for (const [field, value] of Object.entries(recognized)) {
    if (value && !current[field]?.trim()) Object.assign(next, { [field]: value });
  }
  return next;
}
