import { describe, expect, it } from "vitest";
import { fileFromBlob, fileFromRead, formatBytes, isImageName, MAX_FILE_BYTES } from "./fileAttachment";

describe("file attachments", () => {
  it("sends a read file as a named file", () => {
    const f = fileFromRead({ name: "people.csv", mimeType: "text/csv", base64Data: "aWQK", bytes: 3 });
    expect(f.attachment).toEqual({ type: "file", name: "people.csv", mimeType: "text/csv", base64Data: "aWQK" });
    expect(f.bytes).toBe(3);
  });

  it("reads a dropped file inline, and refuses one too large", async () => {
    const f = await fileFromBlob(new Blob(["id\n1\n"], { type: "text/csv" }), "people.csv");
    expect(f.attachment.base64Data).toBe("aWQKMQo=");
    expect(f.attachment.mimeType).toBe("text/csv");
    const untyped = await fileFromBlob(new Blob(["x"]), "blob.bin");
    expect(untyped.attachment.mimeType).toBe("application/octet-stream");
    const big = { size: MAX_FILE_BYTES + 1, type: "" } as Blob;
    await expect(fileFromBlob(big, "big.zip")).rejects.toThrow(/larger than 20 MB/);
  });

  it("tells an image by its name, and says a size", () => {
    expect(isImageName("shot.PNG")).toBe(true);
    expect(isImageName("notes.md")).toBe(false);
    expect(isImageName("png")).toBe(false);
    expect(formatBytes(980)).toBe("980 B");
    expect(formatBytes(12_400)).toBe("12 KB");
    expect(formatBytes(3.4 * 1024 * 1024)).toBe("3.4 MB");
    expect(formatBytes(15 * 1024 * 1024)).toBe("15 MB");
  });
});
