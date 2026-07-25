import { cn } from "@/lib/utils";

/**
 * The right panel's **Files** tab: a lazy tree of the whole working tree.
 *
 * Changed entries are tinted with the app's own git palette — untracked green,
 * modified amber, deleted red — and a changed folder carries its children's
 * colour so you can see where the work is without expanding it.
 */

type Change = "none" | "modified" | "untracked" | "deleted";

const CHANGE_COLOR: Record<Change, string> = {
  none: "text-muted-foreground",
  modified: "text-warning",
  untracked: "text-positive",
  deleted: "text-danger",
};

interface Node {
  name: string;
  depth: number;
  kind: "dir" | "file";
  open?: boolean;
  change?: Change;
  selected?: boolean;
}

const TREE: Node[] = [
  { name: "src", depth: 0, kind: "dir", open: true, change: "modified" },
  { name: "billing", depth: 1, kind: "dir", open: true, change: "modified" },
  { name: "retry.ts", depth: 2, kind: "file", change: "modified", selected: true },
  { name: "queue.ts", depth: 2, kind: "file", change: "modified" },
  { name: "index.ts", depth: 2, kind: "file" },
  { name: "checkout", depth: 1, kind: "dir" },
  { name: "lib", depth: 1, kind: "dir" },
  { name: "tests", depth: 0, kind: "dir", open: true, change: "untracked" },
  { name: "retry.spec.ts", depth: 1, kind: "file", change: "untracked" },
  { name: "package.json", depth: 0, kind: "file" },
  { name: "README.md", depth: 0, kind: "file" },
];

export function FileTree({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col py-1", className)}>
      {TREE.map((node) => {
        const color = CHANGE_COLOR[node.change ?? "none"];
        return (
          <div
            key={`${node.depth}-${node.name}`}
            className={cn(
              "flex items-center gap-1 rounded px-1 py-[2px]",
              node.selected && "bg-sidebar-accent",
            )}
            style={{ paddingLeft: `${4 + node.depth * 10}px` }}
          >
            {node.kind === "dir" ? (
              <svg
                viewBox="0 0 24 24"
                className={cn(
                  "size-2.5 shrink-0 text-faint-foreground",
                  node.open ? "rotate-90" : "",
                )}
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <span className="w-2.5 shrink-0" />
            )}
            {node.kind === "dir" ? (
              <svg viewBox="0 0 24 24" className={cn("size-[11px] shrink-0", color)} fill="none" stroke="currentColor" strokeWidth="1.9">
                <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className={cn("size-[11px] shrink-0", color)} fill="none" stroke="currentColor" strokeWidth="1.9">
                <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
                <path d="M14 3v5h5" />
              </svg>
            )}
            <span
              className={cn(
                "min-w-0 truncate text-[9.5px]",
                node.change && node.change !== "none"
                  ? color
                  : node.selected
                    ? "text-foreground"
                    : "text-foreground/80",
              )}
            >
              {node.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** The right panel's tab strip — Files · Changes · History · GitHub. */
export function RightPanelTabs({ active = "files" }: { active?: string }) {
  const tabs = [
    { id: "files", label: "Files" },
    { id: "changes", label: "Changes" },
    { id: "history", label: "History" },
    { id: "github", label: "GitHub" },
  ];
  return (
    <div className="flex h-[26px] shrink-0 items-stretch gap-px border-b border-border/60 px-1">
      {tabs.map((tab) => (
        <span
          key={tab.id}
          className={cn(
            "flex items-center px-2 text-[9.5px]",
            tab.id === active
              ? "border-b-2 border-foreground/70 font-medium text-foreground"
              : "border-b-2 border-transparent text-faint-foreground",
          )}
        >
          {tab.label}
        </span>
      ))}
    </div>
  );
}
