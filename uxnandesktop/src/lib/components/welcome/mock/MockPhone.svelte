<script lang="ts" module>
  /** Uxnan Mobile's own Material 3 surfaces (light scheme), as the website's
   *  recreation draws them — the phone looks like the phone app, whatever the
   *  desktop's theme. */
  export const M3 = {
    bg: "#f7f7fb",
    container: "#ecedf1",
    onSurface: "#1a1b20",
    onSurfaceVar: "#5f6068",
    outline: "#8b8d95",
    hairline: "#e3e4e9",
    mint: "#b8e9c6",
    periwinkle: "#dce3f7",
    onPeriwinkle: "#26365f",
    live: "#12a150",
    orange: "#f97316",
  } as const;
</script>

<script lang="ts">
  // Uxnan Mobile in a phone frame — the website's recreation
  // (web/src/components/mockups/phone.tsx) ported to Svelte. Screens are drawn
  // once at a canonical 260 × 563 and the frame scales them, so a small phone
  // and a big one show the same proportions. `screen` picks the conversation
  // list (with the desktop linked) or a live conversation.
  import AgentLogo from "$lib/components/AgentLogo.svelte";
  import { Icon } from "$lib/components/ui/icon";
  import ArrowLeftIcon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
  import ChevronDownIcon from "@hugeicons/core-free-icons/ChevronDownIcon";
  import ChevronRightIcon from "@hugeicons/core-free-icons/ChevronRightIcon";
  import CircleDashedIcon from "@hugeicons/core-free-icons/CircleDashedIcon";
  import FolderIcon from "@hugeicons/core-free-icons/Folder01Icon";
  import GitBranchIcon from "@hugeicons/core-free-icons/GitBranchIcon";
  import LaptopIcon from "@hugeicons/core-free-icons/LaptopIcon";
  import ListFilterIcon from "@hugeicons/core-free-icons/FilterIcon";
  import MicIcon from "@hugeicons/core-free-icons/Mic01Icon";
  import MoreVerticalIcon from "@hugeicons/core-free-icons/MoreVerticalIcon";
  import PlusIcon from "@hugeicons/core-free-icons/PlusSignIcon";
  import SearchIcon from "@hugeicons/core-free-icons/Search01Icon";
  import SparklesIcon from "@hugeicons/core-free-icons/SparklesIcon";
  import SquarePenIcon from "@hugeicons/core-free-icons/Edit02Icon";

  let {
    width = 200,
    screen = "threads",
    class: className,
  }: { width?: number; screen?: "threads" | "chat"; class?: string } = $props();

  const BASE_W = 260;
  const BASE_H = 563;
  const pad = $derived(width * 0.027);
  const inner = $derived(width - pad * 2);
  const scale = $derived(inner / BASE_W);

  const threads = [
    { title: "Reconnect backoff", preview: "The socket now retries with jittered backoff…", logo: "claudecode", time: "17:35", desktop: true },
    { title: "Checkout review", preview: "Two things before shipping: the coupon total…", logo: "codex", time: "17:34", desktop: false },
  ];
</script>

<div
  class="border border-foreground/15 bg-[#0e0e11] shadow-[0_24px_70px_-20px_rgb(0_0_0/0.55)] {className ?? ''}"
  style="width: {width}px; padding: {pad}px; border-radius: {width * 0.148}px"
>
  <div
    class="relative overflow-hidden"
    style="width: {inner}px; height: {(inner * 19.5) / 9}px; border-radius: {width * 0.122}px; background: {M3.bg}"
  >
    <div
      class="absolute left-0 top-0 origin-top-left"
      style="width: {BASE_W}px; height: {BASE_H}px; transform: scale({scale}); color: {M3.onSurface}"
    >
      <!-- status bar -->
      <div class="flex items-center justify-between px-[14px] pb-[4px] pt-[9px]">
        <span class="text-[9.5px] font-medium">9:41</span>
        <span class="absolute left-1/2 top-[7px] size-[7px] -translate-x-1/2 rounded-full bg-[#0e0e11]"></span>
        <span class="flex items-center gap-[3px]">
          <span class="inline-block h-[7px] w-[9px]" style="background: {M3.onSurface}; clip-path: polygon(0 100%,100% 100%,100% 0)"></span>
          <span class="inline-block h-[7px] w-[13px] rounded-[2px]" style="background: {M3.onSurface}"></span>
        </span>
      </div>

      {#if screen === "threads"}
        <div class="flex items-center gap-[6px] px-[10px] pb-[6px] pt-[4px]">
          <span class="grid size-[23px] place-items-center rounded-full" style="background: {M3.container}">
            <Icon icon={ArrowLeftIcon} class="size-[11px]" />
          </span>
          <span class="truncate text-[12px] font-medium">Studio</span>
          <span class="ml-auto flex items-center gap-[5px]">
            {#each [SearchIcon, ListFilterIcon, MoreVerticalIcon] as glyph, i (i)}
              <span class="grid size-[23px] place-items-center rounded-full" style="background: {M3.container}">
                <Icon icon={glyph} class="size-[10px]" />
              </span>
            {/each}
          </span>
        </div>
        <!-- Uxnan Desktop is on the same bridge -->
        <div class="flex items-center gap-[5px] px-[14px] pb-[6px] text-[7.5px]" style="color: {M3.onSurfaceVar}">
          <Icon icon={LaptopIcon} class="size-[9px]" style="color: {M3.onPeriwinkle}" />
          Linked with Uxnan Desktop on Studio
        </div>
        <div class="flex flex-col px-[10px]">
          <div class="flex items-center gap-[4px] py-[5px]">
            <Icon icon={ChevronDownIcon} class="size-[8px]" style="color: {M3.onSurfaceVar}" />
            <Icon icon={GitBranchIcon} class="size-[11px]" style="color: {M3.onSurfaceVar}" />
            <span class="truncate text-[10px] font-medium">uxnan</span>
            <span class="ml-auto text-[7px]" style="color: {M3.onSurfaceVar}">3 folders</span>
          </div>
          <div class="flex items-center gap-[4px] py-[4px] pl-[12px]">
            <Icon icon={ChevronDownIcon} class="size-[8px]" style="color: {M3.onSurfaceVar}" />
            <Icon icon={FolderIcon} class="size-[11px]" style="color: {M3.onSurfaceVar}" />
            <span class="truncate text-[9px]">uxnan</span>
            <span class="ml-[6px] text-[7px]" style="color: {M3.onSurfaceVar}">2 conversations</span>
            <span class="ml-auto text-[6.5px]" style="color: {M3.live}">↑2</span>
          </div>
          <div class="flex flex-col gap-[5px] pb-[4px] pl-[24px] pt-[2px]">
            {#each threads as thread (thread.title)}
              <div class="flex items-center gap-[7px] rounded-[15px] px-[8px] py-[7px]" style="background: {M3.container}">
                <span class="grid size-[16px] shrink-0 place-items-center overflow-hidden rounded-[5px] bg-white" style="border: 1px solid {M3.hairline}">
                  <AgentLogo logo={thread.logo} class="size-[10px]" />
                </span>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-[4px]">
                    <span class="truncate text-[8px]">{thread.title}</span>
                    {#if thread.desktop}
                      <Icon icon={LaptopIcon} class="size-[7px] shrink-0" style="color: {M3.onSurfaceVar}" />
                    {/if}
                    <span class="ml-auto shrink-0 text-[6.5px]" style="color: {M3.onSurfaceVar}">{thread.time}</span>
                  </div>
                  <div class="mt-[2px] flex items-center gap-[3px]">
                    <span class="size-[3.5px] shrink-0 rounded-full" style="background: {M3.live}"></span>
                    <span class="truncate text-[6.5px]" style="color: {M3.onSurfaceVar}">{thread.preview}</span>
                  </div>
                </div>
              </div>
            {/each}
          </div>
          {#each [{ name: "uxnan--pets", count: "3 conversations", logos: ["opencode", "pi"] }, { name: "notes", count: "2 conversations", logos: ["antigravity"] }] as folder (folder.name)}
            <div class="flex flex-col py-[5px] pl-[12px] pr-[4px]">
              <div class="flex items-center gap-[4px]">
                <Icon icon={ChevronRightIcon} class="size-[8px]" style="color: {M3.onSurfaceVar}" />
                <Icon icon={FolderIcon} class="size-[11px]" style="color: {M3.onSurfaceVar}" />
                <span class="truncate text-[9px]">{folder.name}</span>
                <span class="ml-auto flex items-center gap-[4px]">
                  <Icon icon={CircleDashedIcon} class="size-[8px]" style="color: {M3.live}" />
                  <Icon icon={PlusIcon} class="size-[9px]" style="color: {M3.onSurfaceVar}" />
                </span>
              </div>
              <div class="mt-[1px] flex items-center gap-[5px] pl-[23px]">
                <span class="truncate text-[7px]" style="color: {M3.onSurfaceVar}">{folder.count}</span>
                <span class="ml-auto flex items-center gap-[2px]">
                  {#each folder.logos as logo (logo)}
                    <span class="grid size-[10px] place-items-center overflow-hidden rounded-[3px] bg-white" style="border: 1px solid {M3.hairline}">
                      <AgentLogo logo={logo} class="size-[7px]" />
                    </span>
                  {/each}
                </span>
              </div>
            </div>
          {/each}
        </div>
        <div class="absolute bottom-[14px] right-[12px]">
          <span class="flex h-[30px] items-center gap-[6px] rounded-[11px] px-[12px] text-[9px] font-medium" style="background: {M3.periwinkle}; color: {M3.onPeriwinkle}">
            <Icon icon={SquarePenIcon} class="size-[11px]" /> New conversation
          </span>
        </div>
      {:else}
        <div class="flex items-center gap-[5px] px-[9px] pb-[8px] pt-[4px]">
          <span class="grid size-[23px] place-items-center rounded-full" style="background: {M3.container}">
            <Icon icon={ArrowLeftIcon} class="size-[11px]" />
          </span>
          <span class="flex h-[23px] min-w-0 flex-1 items-center gap-[4px] rounded-full px-[8px] text-[8.5px]" style="background: {M3.container}">
            <Icon icon={SparklesIcon} class="size-[9px] shrink-0" />
            <span class="truncate">codex/gpt-5.5</span>
            <Icon icon={ChevronDownIcon} class="ml-auto size-[8px] shrink-0" />
          </span>
          {#each [FolderIcon, GitBranchIcon, MoreVerticalIcon] as glyph, i (i)}
            <span class="grid size-[23px] place-items-center rounded-full" style="background: {M3.container}">
              <Icon icon={glyph} class="size-[10px]" />
            </span>
          {/each}
        </div>
        <div class="px-[13px] text-[9px] leading-[1.5]">
          <div class="mb-[9px] flex justify-end">
            <span class="max-w-[80%] rounded-[14px] rounded-br-[4px] px-[9px] py-[6px]" style="background: {M3.periwinkle}; color: {M3.onPeriwinkle}">
              /review the checkout flow before we ship
            </span>
          </div>
          <p>Two things before shipping:</p>
          <ul class="mt-[4px] flex flex-col gap-[4px]">
            <li class="flex gap-[6px]"><span style="color: {M3.outline}">•</span><span>the coupon total rounds <b>before</b> tax;</span></li>
            <li class="flex gap-[6px]"><span style="color: {M3.outline}">•</span><span>the empty cart keeps the saved address.</span></li>
          </ul>
          <p class="mt-[8px]">I can fix both and add a test for each.</p>
          <!-- an approval, answered from the phone -->
          <div class="mt-[10px] rounded-[14px] p-[9px]" style="background: {M3.container}">
            <div class="flex items-center gap-[5px] text-[8.5px] font-medium">
              <span class="size-[5px] rounded-full" style="background: {M3.orange}"></span>
              Edit 2 files in src/checkout
            </div>
            <div class="mt-[7px] flex justify-end gap-[6px] text-[8px]">
              <span class="rounded-full px-[9px] py-[4px]" style="color: {M3.onSurfaceVar}">Reject</span>
              <span class="rounded-full px-[9px] py-[4px] font-medium" style="background: {M3.onPeriwinkle}; color: white">Approve</span>
            </div>
          </div>
        </div>
        <div class="absolute inset-x-[11px] bottom-[11px]">
          <div class="flex h-[29px] items-center gap-[8px] rounded-full px-[10px]" style="background: {M3.container}">
            <Icon icon={PlusIcon} class="size-[12px] shrink-0" />
            <span class="truncate text-[9px]" style="color: {M3.outline}">Message…</span>
            <Icon icon={MicIcon} class="ml-auto size-[11px] shrink-0" style="color: {M3.onSurfaceVar}" />
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>
