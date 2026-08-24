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
