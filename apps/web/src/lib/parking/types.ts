export interface ParkingAccrualInput {
  readonly notificationDate: string;
  readonly pickupDate: string;
  readonly dailyRateJmd: number;
}

export interface ParkingAccrual {
  readonly chargeableDays: number;
  readonly originalAmountJmd: number;
}

export interface ParkingWaiverInput {
  readonly caseId: string;
  readonly originalChargeableDays: number;
  readonly dailyRateJmd: number;
  readonly existingWaivedDays: number;
  readonly existingWaivedAmountJmd: number;
  readonly proposedWaivedDays: number;
  readonly proposedWaivedAmountJmd: number;
}

export interface ParkingWaiverPreview {
  readonly caseId: string;
  readonly originalChargeableDays: number;
  readonly originalAmountJmd: number;
  readonly existingWaivedDays: number;
  readonly existingWaivedAmountJmd: number;
  readonly proposedWaivedDays: number;
  readonly proposedWaivedAmountJmd: number;
  readonly cumulativeWaivedDays: number;
  readonly cumulativeWaivedAmountJmd: number;
  readonly requiresAdministratorSignature: boolean;
  readonly finalChargeableDays: number;
  readonly finalAmountJmd: number;
}

/** Archived parking facts retain the original formula and every waiver result. */
export interface ParkingCaseRecord {
  readonly id: string;
  readonly notificationDate: string;
  readonly pickupDate?: string;
  readonly accrual: ParkingAccrual;
  readonly waiverHistory: ReadonlyArray<ParkingWaiverPreview>;
}
