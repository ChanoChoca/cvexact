/**
 * A copy offered to the share sheet of a phone, as well as downloaded.
 *
 * A downloaded file is the person's own, in a folder of their phone; what turns it into a copy is putting it somewhere else — their mail, their cloud, a chat with
 * themselves — and on a phone that is the share sheet, which the system draws and the person drives: nothing here sends the file anywhere, nor to whom. It is the same
 * file the download made, handed to the system at their tap; where it goes is theirs to choose, and cvexact does not see it. Only where the browser can share a file
 * at all (`navigator.canShare`): elsewhere there is no such button.
 */

export function canShareCopy(file: File): boolean {
  try {
    return typeof navigator !== "undefined" && typeof navigator.share === "function" && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

export type Shared = "shared" | "cancelled" | "failed";

/** Opens the share sheet with the copy. «Cancelled» is the person closing it, which is not a failure. */
export async function shareCopy(file: File): Promise<Shared> {
  try {
    await navigator.share({ files: [file], title: "Copia de tu perfil de cvexact" });
    return "shared";
  } catch (error) {
    return error instanceof DOMException && error.name === "AbortError" ? "cancelled" : "failed";
  }
}
