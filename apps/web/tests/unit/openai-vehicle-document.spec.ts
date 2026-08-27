import { expect, test } from "@playwright/test";
import { sanitizeOpenAiVehicleFields } from "../../src/lib/customers/openai-vehicle-document";

test("OpenAI vehicle document fields are normalized before entering the form", () => {
  expect(sanitizeOpenAiVehicleFields({
    plate: "4597 jc",
    vin: "JHLRD58806C202406",
    engineNumber: "K20A 45902118",
    make: "Honda",
    model: "CRV",
    year: "2006",
    seating: 5,
    ccRating: 1998,
  })).toEqual({
    plate: "4597JC",
    vin: "JHLRD58806C202406",
    engineNumber: "K20A45902118",
    make: "HONDA",
    model: "CRV",
    year: "2006",
    seating: "5",
    ccRating: "1998",
  });
});

test("OpenAI vehicle document fields reject an incomplete VIN and implausible values", () => {
  expect(sanitizeOpenAiVehicleFields({
    vin: "JHLRD58806C2024",
    year: 3026,
    seating: 99,
    ccRating: 99999,
  })).toEqual({});
});

test("OpenAI vehicle document fields normalize OCR O to zero in a 17-character chassis number", () => {
  expect(sanitizeOpenAiVehicleFields({
    vin: "WBALS0204JOU16801",
  })).toEqual({
    vin: "WBALS0204J0U16801",
  });
});

test("OpenAI vehicle document fields present fuel and body type in Chinese", () => {
  expect(sanitizeOpenAiVehicleFields({
    bodyType: "Stn/Waggon",
    fuelType: "DSL",
  })).toEqual({
    bodyType: "旅行车",
    fuelType: "柴油",
  });

  expect(sanitizeOpenAiVehicleFields({
    bodyType: "Motor Car",
    fuelType: "PETROL",
  })).toEqual({
    bodyType: "轿车",
    fuelType: "汽油",
  });
});
