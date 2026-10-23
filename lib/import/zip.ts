import { WANTED_FILES, type CsvFiles } from "@/lib/parse/linkedin-csv";
import { UnreadableFileError } from "./extract";

/**
 * Opens the ZIP LinkedIn sends for "Descargar tus datos" and returns the few CSV
 * files a profile is made of.
 *
 * Only those are ever opened: the archive holds dozens of files about the whole
 * account — messages, connections, ads — none of which this reads, and a file
 * that is not opened cannot cost anything to open. Each one is also capped in
 * size before it is decompressed, because a ZIP can be made to claim a few
 * kilobytes and expand to gigabytes.
 */

/** No profile CSV is anywhere near this. */
const MAX_FILE_BYTES = 4 * 1024 * 1024;

export async function readLinkedInZip(buffer: ArrayBuffer): Promise<CsvFiles> {
  const { default: JSZip } = await import("jszip");
  let zip: Awaited<ReturnType<typeof JSZip.loadAsync>>;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new UnreadableFileError("No pudimos abrir ese ZIP. ¿Es el archivo de datos que te mandó LinkedIn?", "zip");
  }

  const files: CsvFiles = {};
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir || path.startsWith("__MACOSX/") || /(^|\/)\._/.test(path)) continue;
    const base = path.split("/").pop()!.toLowerCase();
    if (!base.endsWith(".csv")) continue;
    const name = base.slice(0, -4);
    if (!WANTED_FILES.includes(name) || name in files) continue;

    // JSZip keeps the size the archive declares on the entry's internal record.
    const declared = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (typeof declared !== "number" || declared > MAX_FILE_BYTES) continue;
    files[name] = await entry.async("string");
  }

  if (Object.keys(files).length === 0) {
    throw new UnreadableFileError(
      "Ese ZIP no tiene los archivos de tu perfil de LinkedIn (Positions.csv, Education.csv…). Probá con el PDF de tu perfil.",
      "zip",
    );
  }
  return files;
}
