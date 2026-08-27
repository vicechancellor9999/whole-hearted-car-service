import sharp from "sharp";

export const VEHICLE_DOCUMENT_RECOGNITION_PROMPT = [
  "Read this Jamaican vehicle registration or certificate of fitness document.",
  "Return only fields that are visibly present; never guess or complete a missing character.",
  "A handwritten correction is the current value and overrides an older printed or stamped value in the same field.",
  "For REG. PLATE NO., inspect dark pen handwriting crossing or sitting beside the printed plate box; return that handwritten replacement and ignore the older printed or stamped plate underneath it.",
  "CHASSIS NO. is the vehicle frame number and the 17-character VIN; copy it into vin.",
  "VIN never contains the letter O, so an O-shaped character printed inside CHASSIS NO. must be returned as digit 0.",
].join(" ");

export interface PreparedVehicleDocumentImage {
  readonly buffer: Buffer;
  readonly mimeType: "image/jpeg";
  readonly width: number;
  readonly height: number;
}

export async function prepareVehicleDocumentImage(
  input: Buffer,
  _mimeType: string,
): Promise<PreparedVehicleDocumentImage> {
  const oriented = await sharp(input, { failOn: "warning" })
    .rotate()
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
    .toBuffer({ resolveWithObject: true });
  const normalized = oriented.info.height > oriented.info.width
    ? await sharp(oriented.data).rotate(90).jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer({ resolveWithObject: true })
    : oriented;
  const recognitionReady = await sharp(normalized.data)
    .resize({ width: 1_024, height: 1_024, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer({ resolveWithObject: true });
  return {
    buffer: recognitionReady.data,
    mimeType: "image/jpeg",
    width: recognitionReady.info.width,
    height: recognitionReady.info.height,
  };
}
