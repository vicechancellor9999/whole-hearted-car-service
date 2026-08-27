import { expect, test } from "@playwright/test";
import {
  createMemoryIrGeneratedFileRepository,
  type IrGeneratedFileRecord,
} from "../../src/lib/orders/ir-generated-file-cache";

const languages = ["zh", "en", "bilingual"] as const;

function bundle(bundleId = "bundle-v1"): IrGeneratedFileRecord[] {
  return languages.map((language, index) => ({
    id: `${bundleId}-${language}`,
    bundleId,
    reportId: "inspection-report-demo-01",
    quotationId: "quotation-demo-01",
    language,
    fileName: `IR-V1-${language}.pdf`,
    mediaType: "application/pdf",
    bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, index + 1]),
  }));
}

test("generated-file repository writes exactly three languages atomically and survives a new repository handle", async () => {
  const backend = new Map<string, IrGeneratedFileRecord>();
  const first = createMemoryIrGeneratedFileRepository({ backend });
  const files = bundle();
  await first.writeBundle(files);

  const reloaded = createMemoryIrGeneratedFileRepository({ backend });
  const read = await reloaded.readBundle(files.map((file) => file.id));
  expect(read?.map((file) => file.language)).toEqual(languages);
  expect(read?.map((file) => [...file.bytes])).toEqual(files.map((file) => [...file.bytes]));

  files[0].bytes[0] = 0;
  expect((await reloaded.read(files[0].id))?.bytes[0]).toBe(0x25);
});

test("partial, duplicate-language, corrupt and failed transactions never replace a complete bundle", async () => {
  const repository = createMemoryIrGeneratedFileRepository();
  const v1 = bundle("bundle-v1");
  await repository.writeBundle(v1);

  await expect(repository.writeBundle(bundle("partial").slice(0, 2))).rejects.toThrow(/three|三/iu);
  await expect(repository.writeBundle([
    bundle("duplicate")[0],
    { ...bundle("duplicate")[1], language: "zh" },
    bundle("duplicate")[2],
  ])).rejects.toThrow(/language|语言/iu);
  await expect(repository.writeBundle(bundle("corrupt").map((file, index) => (
    index === 1 ? { ...file, bytes: new Uint8Array([1, 2, 3]) } : file
  )))).rejects.toThrow(/PDF|signature|签名/iu);

  repository.failNextWrite(new Error("transaction failed"));
  await expect(repository.writeBundle(bundle("bundle-v2"))).rejects.toThrow("transaction failed");
  expect(await repository.readBundle(v1.map((file) => file.id))).not.toBeNull();
  expect(await repository.readBundle(bundle("bundle-v2").map((file) => file.id))).toBeNull();
});

test("orphan and superseded records are never returned through a canonical active attachment set", async () => {
  const repository = createMemoryIrGeneratedFileRepository();
  const v1 = bundle("bundle-v1");
  const orphan = bundle("orphan-v2");
  await repository.writeBundle(v1);
  await repository.writeBundle(orphan);

  expect(await repository.readBundle(v1.map((file) => file.id))).not.toBeNull();
  expect(await repository.readBundle([v1[0].id, orphan[1].id, v1[2].id])).toBeNull();

  await repository.deleteBundle("bundle-v1");
  expect(await repository.readBundle(v1.map((file) => file.id))).toBeNull();
  expect(await repository.readBundle(orphan.map((file) => file.id))).not.toBeNull();
});

test("cleanup retains every canonical report bundle and deletes only unreachable bundles", async () => {
  const repository = createMemoryIrGeneratedFileRepository();
  const reportA = bundle("report-a-active");
  const reportB = bundle("report-b-active").map((file) => ({
    ...file,
    reportId: "inspection-report-demo-02",
    quotationId: "quotation-demo-02",
  }));
  const orphan = bundle("unreachable-orphan");
  await repository.writeBundle(reportA);
  await repository.writeBundle(reportB);
  await repository.writeBundle(orphan);

  await repository.cleanupExceptBundleIds([reportA[0].bundleId, reportB[0].bundleId]);

  expect(await repository.readBundle(reportA.map((file) => file.id))).not.toBeNull();
  expect(await repository.readBundle(reportB.map((file) => file.id))).not.toBeNull();
  expect(await repository.readBundle(orphan.map((file) => file.id))).toBeNull();
});
