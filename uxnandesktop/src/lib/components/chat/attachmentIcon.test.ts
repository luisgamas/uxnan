import { describe, expect, it } from "vitest";
import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import FileCodeIcon from "@hugeicons/core-free-icons/FileCodeIcon";
import Image01Icon from "@hugeicons/core-free-icons/Image01Icon";
import Pdf01Icon from "@hugeicons/core-free-icons/Pdf01Icon";
import Txt01Icon from "@hugeicons/core-free-icons/Txt01Icon";
import Zip01Icon from "@hugeicons/core-free-icons/Zip01Icon";
import { attachmentIcon, isTextAttachment } from "./attachmentIcon";

describe("attachment glyphs", () => {
  it("tells a file's kind from its name, then its MIME type", () => {
    expect(attachmentIcon("Report.PDF")).toBe(Pdf01Icon);
    expect(attachmentIcon("bundle.tar.gz")).toBe(Zip01Icon);
    expect(attachmentIcon("notes.md")).toBe(Txt01Icon);
    expect(attachmentIcon("main.rs")).toBe(FileCodeIcon);
    expect(attachmentIcon("blob", "image/png")).toBe(Image01Icon);
    expect(attachmentIcon("blob", "application/pdf")).toBe(Pdf01Icon);
    expect(attachmentIcon("data", "text/plain")).toBe(Txt01Icon);
    expect(attachmentIcon("thing.bin", "application/octet-stream")).toBe(File01Icon);
  });

  it("knows which files read as text", () => {
    expect(isTextAttachment("a.csv", "text/csv")).toBe(true);
    expect(isTextAttachment("config.json")).toBe(true);
    expect(isTextAttachment("x", "application/json")).toBe(true);
    expect(isTextAttachment("photo.png", "image/png")).toBe(false);
  });
});
