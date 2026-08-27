import type { MockCustomerVehicleE2EScenario } from "../../api/mock-customers";
import { createMockLicenseExtractionClient } from "./mock-client";
import { LicenseExtractionError, type LicenseExtractionClient } from "./types";

export function createBrowserLicenseExtractionClient(
  scenario?: MockCustomerVehicleE2EScenario["licenseExtraction"],
): LicenseExtractionClient {
  if (scenario) return createMockLicenseExtractionClient(scenario);
  return {
    extract: async () => {
      throw new LicenseExtractionError(
        "LICENSE_EXTRACTION_UNAVAILABLE",
        "License extraction is unavailable",
      );
    },
  };
}
