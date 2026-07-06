// Built-in icon catalog — the *component* layer: maps each curated glyph name
// (from `iconCatalog.ts`) to its lucide component, and resolves a stored
// `builtin:<name>[~<color>]` value to a renderable icon. Kept separate from the
// pure string logic so that layer stays free of Svelte imports (unit-testable).

import type { Component } from "svelte";
import { BUILTIN_ICON_NAMES, parseBuiltinKey } from "$lib/iconCatalog";
import RocketIcon from "@lucide/svelte/icons/rocket";
import StarIcon from "@lucide/svelte/icons/star";
import FlameIcon from "@lucide/svelte/icons/flame";
import ZapIcon from "@lucide/svelte/icons/zap";
import SparklesIcon from "@lucide/svelte/icons/sparkles";
import WandSparklesIcon from "@lucide/svelte/icons/wand-sparkles";
import BugIcon from "@lucide/svelte/icons/bug";
import WrenchIcon from "@lucide/svelte/icons/wrench";
import HammerIcon from "@lucide/svelte/icons/hammer";
import CogIcon from "@lucide/svelte/icons/cog";
import GitBranchIcon from "@lucide/svelte/icons/git-branch";
import GitMergeIcon from "@lucide/svelte/icons/git-merge";
import GitForkIcon from "@lucide/svelte/icons/git-fork";
import GitPullRequestIcon from "@lucide/svelte/icons/git-pull-request";
import WorkflowIcon from "@lucide/svelte/icons/workflow";
import CodeIcon from "@lucide/svelte/icons/code";
import TerminalIcon from "@lucide/svelte/icons/terminal";
import CpuIcon from "@lucide/svelte/icons/cpu";
import DatabaseIcon from "@lucide/svelte/icons/database";
import ServerIcon from "@lucide/svelte/icons/server";
import PackageIcon from "@lucide/svelte/icons/package";
import BoxIcon from "@lucide/svelte/icons/box";
import BoxesIcon from "@lucide/svelte/icons/boxes";
import LayersIcon from "@lucide/svelte/icons/layers";
import ComponentIcon from "@lucide/svelte/icons/component";
import BeakerIcon from "@lucide/svelte/icons/beaker";
import AtomIcon from "@lucide/svelte/icons/atom";
import BrainIcon from "@lucide/svelte/icons/brain";
import ShieldIcon from "@lucide/svelte/icons/shield";
import LockIcon from "@lucide/svelte/icons/lock";
import KeyIcon from "@lucide/svelte/icons/key";
import FlagIcon from "@lucide/svelte/icons/flag";
import BookmarkIcon from "@lucide/svelte/icons/bookmark";
import TagIcon from "@lucide/svelte/icons/tag";
import PinIcon from "@lucide/svelte/icons/pin";
import BellIcon from "@lucide/svelte/icons/bell";
import HeartIcon from "@lucide/svelte/icons/heart";
import CrownIcon from "@lucide/svelte/icons/crown";
import TrophyIcon from "@lucide/svelte/icons/trophy";
import GemIcon from "@lucide/svelte/icons/gem";
import DiamondIcon from "@lucide/svelte/icons/diamond";
import TargetIcon from "@lucide/svelte/icons/target";
import CompassIcon from "@lucide/svelte/icons/compass";
import MapIcon from "@lucide/svelte/icons/map";
import RadarIcon from "@lucide/svelte/icons/radar";
import SatelliteIcon from "@lucide/svelte/icons/satellite";
import OrbitIcon from "@lucide/svelte/icons/orbit";
import GlobeIcon from "@lucide/svelte/icons/globe";
import CloudIcon from "@lucide/svelte/icons/cloud";
import SunIcon from "@lucide/svelte/icons/sun";
import MoonIcon from "@lucide/svelte/icons/moon";
import SnowflakeIcon from "@lucide/svelte/icons/snowflake";
import LeafIcon from "@lucide/svelte/icons/leaf";
import SproutIcon from "@lucide/svelte/icons/sprout";
import MountainIcon from "@lucide/svelte/icons/mountain";
import FeatherIcon from "@lucide/svelte/icons/feather";
import GhostIcon from "@lucide/svelte/icons/ghost";
import PuzzleIcon from "@lucide/svelte/icons/puzzle";
import LightbulbIcon from "@lucide/svelte/icons/lightbulb";
import MusicIcon from "@lucide/svelte/icons/music";
import PaletteIcon from "@lucide/svelte/icons/palette";
import BrushIcon from "@lucide/svelte/icons/brush";
import AnchorIcon from "@lucide/svelte/icons/anchor";
import ShipIcon from "@lucide/svelte/icons/ship";
import GiftIcon from "@lucide/svelte/icons/gift";
import EyeIcon from "@lucide/svelte/icons/eye";
import HexagonIcon from "@lucide/svelte/icons/hexagon";

/** Glyph name → lucide component. Every name in `BUILTIN_ICON_NAMES` has an entry. */
const REGISTRY: Record<string, Component> = {
  rocket: RocketIcon,
  star: StarIcon,
  flame: FlameIcon,
  zap: ZapIcon,
  sparkles: SparklesIcon,
  "wand-sparkles": WandSparklesIcon,
  bug: BugIcon,
  wrench: WrenchIcon,
  hammer: HammerIcon,
  cog: CogIcon,
  "git-branch": GitBranchIcon,
  "git-merge": GitMergeIcon,
  "git-fork": GitForkIcon,
  "git-pull-request": GitPullRequestIcon,
  workflow: WorkflowIcon,
  code: CodeIcon,
  terminal: TerminalIcon,
  cpu: CpuIcon,
  database: DatabaseIcon,
  server: ServerIcon,
  package: PackageIcon,
  box: BoxIcon,
  boxes: BoxesIcon,
  layers: LayersIcon,
  component: ComponentIcon,
  beaker: BeakerIcon,
  atom: AtomIcon,
  brain: BrainIcon,
  shield: ShieldIcon,
  lock: LockIcon,
  key: KeyIcon,
  flag: FlagIcon,
  bookmark: BookmarkIcon,
  tag: TagIcon,
  pin: PinIcon,
  bell: BellIcon,
  heart: HeartIcon,
  crown: CrownIcon,
  trophy: TrophyIcon,
  gem: GemIcon,
  diamond: DiamondIcon,
  target: TargetIcon,
  compass: CompassIcon,
  map: MapIcon,
  radar: RadarIcon,
  satellite: SatelliteIcon,
  orbit: OrbitIcon,
  globe: GlobeIcon,
  cloud: CloudIcon,
  sun: SunIcon,
  moon: MoonIcon,
  snowflake: SnowflakeIcon,
  leaf: LeafIcon,
  sprout: SproutIcon,
  mountain: MountainIcon,
  feather: FeatherIcon,
  ghost: GhostIcon,
  puzzle: PuzzleIcon,
  lightbulb: LightbulbIcon,
  music: MusicIcon,
  palette: PaletteIcon,
  brush: BrushIcon,
  anchor: AnchorIcon,
  ship: ShipIcon,
  gift: GiftIcon,
  eye: EyeIcon,
  hexagon: HexagonIcon,
};

/** One choosable built-in glyph, in display order. */
export const BUILTIN_ICONS: { name: string; Icon: Component }[] = BUILTIN_ICON_NAMES.map(
  (name) => ({ name, Icon: REGISTRY[name] }),
);

/** Resolve a `builtin:<name>[~<color>]` value to its component + color hex.
 *  Returns null when the value isn't a known built-in (unknown glyph → null, so
 *  the caller falls back to its default glyph). */
export function resolveBuiltinIcon(
  value?: string | null,
): { name: string; Icon: Component; color: string | null } | null {
  const parsed = parseBuiltinKey(value);
  if (!parsed) return null;
  const Icon = REGISTRY[parsed.name];
  if (!Icon) return null;
  return { name: parsed.name, Icon, color: parsed.color };
}
