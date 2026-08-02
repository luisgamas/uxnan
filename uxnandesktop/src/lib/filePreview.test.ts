import { describe, expect, it } from "vitest";
import {
  fileParentDirectory,
  filePreviewKind,
  opensInPreview,
  resolvePreviewAssetPath,
} from "./filePreview";

describe("fileParentDirectory", () => {
  it("normalizes native Windows paths for relative preview assets", () => {
    expect(fileParentDirectory("C:\\repo\\docs\\README.es.md")).toBe("C:/repo/docs");
  });

  it("handles macOS/Linux roots and parentless paths", () => {
    expect(fileParentDirectory("/repo/README.md")).toBe("/repo");
    expect(fileParentDirectory("/README.md")).toBe("/");
    expect(fileParentDirectory("C:\\README.md")).toBe("C:/");
    expect(fileParentDirectory("README.md")).toBeNull();
  });

  it("preserves a Windows UNC share", () => {
    expect(fileParentDirectory("\\\\server\\share\\repo\\README.md")).toBe(
      "//server/share/repo",
    );
  });
});

describe("resolvePreviewAssetPath", () => {
  it.each([
    ["C:/repo/docs", "C:/repo/docs/assets/demo.gif"],
    ["/Users/dev/repo/docs", "/Users/dev/repo/docs/assets/demo.gif"],
    ["/home/dev/repo/docs", "/home/dev/repo/docs/assets/demo.gif"],
    ["//server/share/repo/docs", "//server/share/repo/docs/assets/demo.gif"],
  ])("resolves the same README asset from %s", (baseDir, expected) => {
    expect(resolvePreviewAssetPath(baseDir, "assets/demo.gif")).toBe(expected);
  });

  it("normalizes parent segments, URL encoding, and delivery suffixes", () => {
    expect(resolvePreviewAssetPath("/repo/docs", "../media/demo%20clip.gif?raw=true#demo")).toBe(
      "/repo/media/demo clip.gif",
    );
  });
});

describe("filePreviewKind", () => {
  it("recognizes images, including editable SVG", () => {
    expect(filePreviewKind("assets/logo.svg")).toBe("image");
    expect(filePreviewKind("photo.AVIF")).toBe("image");
  });

  it("recognizes Markdown and PDF documents", () => {
    expect(filePreviewKind("README.md")).toBe("markdown");
    expect(filePreviewKind("manual.PDF")).toBe("pdf");
  });

  it("leaves ordinary source files without a preview", () => {
    expect(filePreviewKind("src/main.rs")).toBeNull();
  });
});

describe("opensInPreview", () => {
  it("opens visual binaries in Preview while Markdown remains source-first", () => {
    expect(opensInPreview("diagram.svg")).toBe(true);
    expect(opensInPreview("guide.pdf")).toBe(true);
    expect(opensInPreview("README.md")).toBe(false);
  });
});
