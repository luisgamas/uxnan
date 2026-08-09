<script lang="ts">
  import { untrack } from "svelte";
  import { Input } from "$lib/components/ui/input";
  import { Spinner } from "$lib/components/ui/spinner";
  import { Icon } from "$lib/components/ui/icon";
  import {
    githubIssueList,
    githubIssueView,
    githubPrList,
    githubPrView,
    githubRepoContext,
  } from "$lib/api";
  import {
    githubWorkItemBranch,
    parseGitHubWorkItemInput,
    rankGitHubWorkItemSearch,
    type GitHubWorkItemKind,
  } from "$lib/githubInput";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import GitPullRequestIcon from "@hugeicons/core-free-icons/GitPullRequestIcon";
  import CircleDotIcon from "@hugeicons/core-free-icons/CircleDotIcon";
  import SearchIcon from "@hugeicons/core-free-icons/Search01Icon";

  interface Item {
    number: number;
    title: string;
    url: string;
    author: string | null;
    meta: string;
    branch: string;
  }

  let {
    active = false,
    repoPath,
    kind,
    initialQuery = "",
    number = $bindable<number | null>(null),
    title = $bindable(""),
    url = $bindable(""),
    branch = $bindable(""),
  }: {
    active?: boolean;
    repoPath: string;
    kind: GitHubWorkItemKind;
    initialQuery?: string;
    number?: number | null;
    title?: string;
    url?: string;
    branch?: string;
  } = $props();

  let query = $state("");
  let items = $state<Item[]>([]);
  let loading = $state(false);
  let resolving = $state(false);
  let error = $state<string | null>(null);
  let identity = $state<{ owner: string; repo: string } | null>(null);
  let request = 0;

  const filtered = $derived.by(() => {
    return items
      .map((item, index) => ({ item, index, rank: rankGitHubWorkItemSearch(item, query, kind) }))
      .filter((entry) => entry.rank !== null)
      .sort((a, b) => a.rank! - b.rank! || a.index - b.index)
      .map((entry) => entry.item);
  });

  const message = (e: unknown) =>
    e && typeof e === "object" && "message" in e
      ? String((e as { message: unknown }).message)
      : String(e);

  function choose(item: Item): void {
    number = item.number;
    title = item.title;
    url = item.url;
    branch = item.branch;
    error = null;
  }

  async function load(): Promise<void> {
    const id = ++request;
    loading = true;
    error = null;
    try {
      const context = await githubRepoContext(repoPath);
      let nextItems: Item[];
      if (kind === "pr") {
        const rows = await githubPrList(repoPath, "open", null, 50);
        nextItems = rows.map((item) => ({
          number: item.number,
          title: item.title,
          url: item.url,
          author: item.author,
          meta: `${item.headRefName}${item.headRefName && item.baseRefName ? " → " : ""}${item.baseRefName}`,
          branch: githubWorkItemBranch("pr", item.number, item.title, item.headRefName),
        }));
      } else {
        const rows = await githubIssueList(repoPath, "open", null, 50);
        nextItems = rows.map((item) => ({
          number: item.number,
          title: item.title,
          url: item.url,
          author: item.author,
          meta: item.labels.slice(0, 3).join(" · "),
          branch: githubWorkItemBranch("issue", item.number, item.title),
        }));
      }
      if (id !== request) return;
      identity = context ? { owner: context.owner, repo: context.repo } : null;
      items = nextItems;
    } catch (e) {
      if (id === request) error = message(e);
    } finally {
      if (id === request) loading = false;
    }
  }

  async function resolveTyped(): Promise<void> {
    const parsed = parseGitHubWorkItemInput(query, kind);
    if (!parsed || resolving) {
      if (query.trim()) error = i18n.t("launcher.github.invalidReference");
      return;
    }
    if (
      parsed.owner &&
      parsed.repo &&
      identity &&
      (parsed.owner.toLowerCase() !== identity.owner.toLowerCase() ||
        parsed.repo.toLowerCase() !== identity.repo.toLowerCase())
    ) {
      error = i18n.t("launcher.github.otherRepository");
      return;
    }
    const cached = items.find((item) => item.number === parsed.number);
    if (cached) {
      choose(cached);
      return;
    }
    resolving = true;
    error = null;
    try {
      let item: Item;
      if (kind === "pr") {
        const detail = await githubPrView(repoPath, String(parsed.number));
        item = {
          number: detail.number,
          title: detail.title,
          url: detail.url,
          author: detail.author,
          meta: `${detail.headRefName}${detail.headRefName && detail.baseRefName ? " → " : ""}${detail.baseRefName}`,
          branch: githubWorkItemBranch("pr", detail.number, detail.title, detail.headRefName),
        };
      } else {
        const detail = await githubIssueView(repoPath, String(parsed.number));
        item = {
          number: detail.number,
          title: detail.title,
          url: detail.url,
          author: detail.author,
          meta: detail.labels.slice(0, 3).join(" · "),
          branch: githubWorkItemBranch("issue", detail.number, detail.title),
        };
      }
      items = [item, ...items];
      choose(item);
    } catch (e) {
      error = message(e);
    } finally {
      resolving = false;
    }
  }

  $effect(() => {
    if (!active) return;
    void repoPath;
    void kind;
    void initialQuery;
    untrack(() => {
      query = initialQuery.trim();
      items = [];
      identity = null;
      void load().then(() => {
        if (initialQuery.trim()) void resolveTyped();
      });
    });
  });
</script>

<div class="flex flex-col gap-2">
  <div class="relative">
    <Icon icon={SearchIcon}
      class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/70"
    />
    <Input
      class="pl-8"
      bind:value={query}
      placeholder={i18n.t(kind === "pr" ? "launcher.github.searchPr" : "launcher.github.searchIssue")}
      autocomplete="off"
      onkeydown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void resolveTyped();
        }
      }}
    />
  </div>

  <div
    class="uxnan-scroll min-h-32 max-h-52 overflow-y-auto rounded-lg border border-border/50 bg-background/40 p-1"
    role="listbox"
    aria-label={i18n.t(kind === "pr" ? "launcher.github.prList" : "launcher.github.issueList")}
  >
    {#if loading}
      <div class={cn("flex min-h-32 items-center justify-center gap-2", text.meta)}>
        <Spinner aria-label={i18n.t("common.loading")} />{i18n.t("common.loading")}
      </div>
    {:else if filtered.length === 0}
      <div class={cn("flex min-h-32 items-center justify-center px-5 text-center", text.meta)}>
        {i18n.t("launcher.github.empty")}
      </div>
    {:else}
      {#each filtered as item (item.number)}
        <button
          type="button"
          role="option"
          aria-selected={number === item.number}
          class={cn(
            "flex min-h-11 w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors",
            number === item.number ? "bg-accent text-foreground" : "hover:bg-accent/55",
          )}
          onclick={() => choose(item)}
        >
          <Icon
            icon={kind === "pr" ? GitPullRequestIcon : CircleDotIcon}
            class={cn(icon.button, "mt-0.5 shrink-0", number === item.number ? "text-primary" : "text-muted-foreground")}
          />
          <span class="min-w-0 flex-1">
            <span class={cn("block truncate", text.bodyStrong)}>#{item.number} · {item.title}</span>
            <span class={cn("block truncate", text.meta)}>
              {[item.author, item.meta].filter(Boolean).join(" · ")}
            </span>
          </span>
        </button>
      {/each}
    {/if}
  </div>

  {#if resolving}
    <p class={cn("flex items-center gap-1.5", text.meta)}>
      <Spinner aria-label={i18n.t("common.loading")} />{i18n.t("launcher.github.resolving")}
    </p>
  {:else if error}
    <p class="text-xs leading-5 text-destructive">{error}</p>
  {:else if number !== null}
    <p class={cn("truncate", text.meta)}>{i18n.t("launcher.github.selected", { n: number })}: {title}</p>
  {:else}
    <p class={text.meta}>{i18n.t("launcher.github.inputHint")}</p>
  {/if}
</div>
