import type { VehicleRecognitionResult } from "./vehicle-photo-recognition";

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function identifier(value: unknown): string | undefined {
  const result = text(value)?.toUpperCase().replace(/\s+/g, "");
  return result || undefined;
}

function plausibleNumber(value: unknown, min: number, max: number): string | undefined {
  const result = typeof value === "number" ? String(value) : text(value);
  if (!result || !/^\d+$/.test(result)) return undefined;
  const number = Number(result);
  return number >= min && number <= max ? String(number) : undefined;
}

function chineseBodyType(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const normalized = raw.toUpperCase().replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();
  if (/STN|STATION|WAG+ON/.test(normalized)) return "旅行车";
  if (/MOTOR CAR|SEDAN|SALOON/.test(normalized)) return "轿车";
  if (/HATCH/.test(normalized)) return "掀背车";
  if (/SUV|SPORT UTILITY/.test(normalized)) return "SUV";
  if (/PICK ?UP/.test(normalized)) return "皮卡";
  if (/VAN/.test(normalized)) return "厢式车";
  if (/BUS/.test(normalized)) return "客车";
  if (/TRUCK|LORRY/.test(normalized)) return "货车";
  return raw;
}

function chineseFuelType(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const normalized = raw.toUpperCase().replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();
  if (/DSL|DIESEL/.test(normalized)) return "柴油";
  if (/PETROL|GASOLINE|GAS/.test(normalized)) return "汽油";
  if (/HYBRID/.test(normalized)) return "混合动力";
  if (/ELECTRIC|EV/.test(normalized)) return "电动";
  return raw;
}

export function sanitizeOpenAiVehicleFields(value: unknown): VehicleRecognitionResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const plate = identifier(input.plate);
  const vinCandidate = identifier(input.vin)?.replace(/O/g, "0");
  const vin = vinCandidate && /^[A-HJ-NPR-Z0-9]{17}$/.test(vinCandidate) ? vinCandidate : undefined;
  const year = plausibleNumber(input.year, 1886, new Date().getFullYear() + 1);

  return Object.fromEntries(Object.entries({
    plate: plate && /^(?:[A-Z]{1,3}\d{3,4}|\d{3,4}[A-Z]{1,3})$/.test(plate) ? plate : undefined,
    vin,
    engineNumber: identifier(input.engineNumber),
    make: text(input.make)?.toUpperCase(),
    model: text(input.model)?.toUpperCase(),
    year,
    color: text(input.color)?.toUpperCase(),
    bodyType: chineseBodyType(input.bodyType),
    seating: plausibleNumber(input.seating, 1, 20),
    ccRating: plausibleNumber(input.ccRating, 50, 20_000),
    fuelType: chineseFuelType(input.fuelType),
  }).filter((entry): entry is [string, string] => Boolean(entry[1])));
}
