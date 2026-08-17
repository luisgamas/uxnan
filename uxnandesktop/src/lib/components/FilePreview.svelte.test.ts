import { describe, expect, it } from "vitest";
import { mount, mountWithProviders, until } from "../../test/render";
import { failsWith } from "../../test/tauri";
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

  it("reads a host's image from that host", async () => {
    // Reported: opening an image in a remote project drew the failure instead of
    // the picture, because the viewer asked *this* machine for a path that lives
    // on another one.
    const png = "data:image/png;base64,iVBORw0KGgo=";
    // With providers: a loaded image draws the zoom cluster, whose tooltips
    // need the provider the root layout supplies.
    const { screen, backend } = mountWithProviders(FilePreview, {
      props: { path: "C:/Users/gamas/app/logo.png", kind: "image", target: "ssh:h1" },
      commands: { ssh_fs_read_data_url: () => png },
    });

    await until(() => backend.called("ssh_fs_read_data_url"), {
      label: "the host image request",
    });
    expect(backend.lastCallTo("ssh_fs_read_data_url")?.args).toEqual({
      hostId: "h1",
      path: "C:/Users/gamas/app/logo.png",
    });
    expect(backend.lastCallTo("fs_read_data_url")).toBeUndefined();
    await until(() => screen.queryByRole("img", { name: "logo.png" })?.getAttribute("src") === png, {
      label: "the host's image",
    });
  });

  it("says why a preview failed instead of stringifying the error object", async () => {
    // A backend refusal is `{ code, message }`, not an `Error`: `String(e)` on it
    // is the "[object Object]" the user saw where the image should have been.
    const { screen, backend } = mount(FilePreview, {
      props: { path: "/home/dev/app/logo.png", kind: "image" },
      commands: {
        fs_read_data_url: failsWith("IO_ERROR", "logo.png: no such file or directory"),
      },
    });

    await until(() => backend.called("fs_read_data_url"), { label: "the image request" });
    expect(await screen.findByText(/no such file or directory/)).toBeInTheDocument();
    expect(screen.queryByText(/\[object Object\]/)).toBeNull();
  });
});
