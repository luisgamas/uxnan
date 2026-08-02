import { describe, expect, it } from "vitest";
import { mount, until } from "../../test/render";
import FilePreview from "./FilePreview.svelte";

const tableReadme = `<table>
<tr>
<td>

<img src="assets/shorts/demo.gif" alt="Animated demo" width="440" />

</td>
</tr>
</table>`;

describe("FilePreview", () => {
  it.each([
    ["Windows", "C:\\repo\\README.md", "C:/repo/assets/shorts/demo.gif"],
    ["macOS", "/Users/dev/repo/README.md", "/Users/dev/repo/assets/shorts/demo.gif"],
    ["Linux", "/home/dev/repo/README.md", "/home/dev/repo/assets/shorts/demo.gif"],
    ["Windows UNC", "\\\\server\\share\\repo\\README.md", "//server/share/repo/assets/shorts/demo.gif"],
  ])("loads an inline-table README GIF from a %s path", async (_, path, expectedPath) => {
    const gif = "data:image/gif;base64,R0lGODlhAQABAIAAAAUEBA==";
    const { screen, backend } = mount(FilePreview, {
      props: { path, kind: "markdown", content: tableReadme },
      commands: { fs_read_data_url: () => gif },
    });

    await until(() => backend.called("fs_read_data_url"), {
      label: "the local GIF request",
    });
    expect(backend.lastCallTo("fs_read_data_url")?.args.path).toBe(expectedPath);
    await until(
      () => screen.queryByRole("img", { name: "Animated demo" })?.getAttribute("src") === gif,
      { label: "the README GIF" },
    );
    expect(screen.getByRole("img", { name: "Animated demo" })).toHaveStyle({ width: "440px" });
  });
});
