const BUSINESS_TIMEZONE = "America/Jamaica";

const businessDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function getBusinessDateParts(instant: Date): {
  year: string;
  month: string;
  day: string;
} {
  const parts = Object.fromEntries(
    businessDateFormatter
      .formatToParts(instant)
      .filter((part) => part.type === "year" || part.type === "month" || part.type === "day")
      .map((part) => [part.type, part.value]),
  );

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
  };
}

export function toBusinessDateKey(instant: Date): string {
  const { year, month, day } = getBusinessDateParts(instant);
  return `${year}-${month}-${day}`;
}

export function toBusinessMonthKey(instant: Date): string {
  const { year, month } = getBusinessDateParts(instant);
  return `${year}-${month}`;
}

const businessDateKeyPattern = /^(\d{4})-(\d{2})-(\d{2})$/;

export function fromBusinessDateKey(dateKey: string): Date | null {
  const match = businessDateKeyPattern.exec(dateKey);
  if (!match) return null;
  const [, year, month, day] = match;
  const instant = new Date(`${year}-${month}-${day}T00:00:00-05:00`);
  if (Number.isNaN(instant.getTime())) return null;
  return toBusinessDateKey(instant) === dateKey ? instant : null;
}

export function nextBusinessDateStart(dateKey: string): Date | null {
  const start = fromBusinessDateKey(dateKey);
  if (!start) return null;
  return new Date(start.getTime() + 24 * 60 * 60 * 1_000);
}
