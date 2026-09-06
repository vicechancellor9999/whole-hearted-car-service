export function displayedRepairRoundPerformanceMinor(input: {
  roundNo: number;
  performanceDraftMinor: number | null | undefined;
  laborSubtotalMinor: number;
}): number {
  if (typeof input.performanceDraftMinor === "number") return input.performanceDraftMinor;
  return input.roundNo === 1 ? input.laborSubtotalMinor : 0;
}
