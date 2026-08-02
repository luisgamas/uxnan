import { describe, expect, it, vi } from "vitest";
import { mount, until } from "../../test/render";
import MarkdownView from "./MarkdownView.svelte";

describe("MarkdownView", () => {
  it("renders common README badge HTML as safe elements instead of source code", () => {
    const { screen } = mount(MarkdownView, {
      props: {
        source:
          '<p align="center">\n  <a href="https://github.com/example/project">\n    <img src="https://img.shields.io/badge/build-passing-green" alt="Build" height="20" onclick="bad()" />\n  </a>\n</p>\n\n<h1 align="center">Uxnan</h1>',
      },
    });
    const badge = screen.getByRole("img", { name: "Build" });
    expect(badge).toHaveAttribute(
      "src",
      "https://img.shields.io/badge/build-passing-green",
    );
    expect(badge).not.toHaveAttribute("onclick");
    expect(badge).toHaveStyle({ width: "auto", height: "20px" });
    expect(screen.getByRole("heading", { name: "Uxnan" })).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "https://github.com/example/project",
    );
    expect(screen.container.querySelector(".md-html-fragment pre")).toBeNull();
  });

  it("keeps the document scroller full-width and native like CodeMirror", () => {
    const { screen } = mount(MarkdownView, { props: { source: "# Readme" } });
    const scroller = screen.container.querySelector(".md-scroll");
    expect(scroller).toBeInTheDocument();
    expect(scroller).not.toHaveClass("uxnan-scroll", "scrollbar-sleek");
    expect(scroller?.querySelector(":scope > article.md")).toBeInTheDocument();
  });

  it("loads an encoded local GIF path without GitHub's raw query", async () => {
    const gif = "data:image/gif;base64,R0lGODlhAQABAIAAAAUEBA==";
    const { screen, backend } = mount(MarkdownView, {
      props: {
        source: "![Demo](assets/demo%20clip.gif?raw=true)",
        baseDir: "C:/repo/docs",
      },
      commands: { fs_read_data_url: () => gif },
    });

    await until(() => screen.getByRole("img", { name: "Demo" }).getAttribute("src") === gif, {
      label: "the animated image data URL",
    });
    expect(backend.lastCallTo("fs_read_data_url")?.args.path).toBe(
      "C:/repo/docs/assets/demo clip.gif",
    );
  });

  it("requests remote GIFs with the document-preview size allowance", async () => {
    const gif = "data:image/gif;base64,R0lGODlhAQABAIAAAAUEBA==";
    const url = "https://example.invalid/demo.gif";
    const { screen, backend } = mount(MarkdownView, {
      props: { source: `![Demo](${url})` },
      commands: { image_fetch_data_url: () => gif },
    });

    await until(() => screen.getByRole("img", { name: "Demo" }).getAttribute("src") === gif, {
      label: "the fetched animated image",
    });
    expect(backend.lastCallTo("image_fetch_data_url")?.args).toMatchObject({
      url,
      preview: true,
    });
  });

  it("opens a relative link through the file-view callback", () => {
    const onopenfile = vi.fn();
    const { screen } = mount(MarkdownView, {
      props: {
        source: "[Sibling](../docs/guide.md)",
        baseDir: "C:/repo/readmes",
        onopenfile,
      },
    });
    screen.getByRole("link", { name: "Sibling" }).click();
    expect(onopenfile).toHaveBeenCalledWith("C:/repo/docs/guide.md");
  });
});
