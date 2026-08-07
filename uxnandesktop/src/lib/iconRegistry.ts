// Built-in icon catalog — the *glyph* layer: maps each curated glyph name (from
// `iconCatalog.ts`) to its Hugeicons drawing data, and resolves a stored
// `builtin:<name>[~<color>]` value to a renderable icon. Kept separate from the
// pure string logic so that layer stays free of Svelte imports (unit-testable).
//
// The names here are a *persisted contract*: a user's chosen glyph is stored as
// `builtin:<name>` in their project/branch state, so a name may never be renamed
// or dropped without orphaning that value. Swapping which glyph a name draws is
// fine; changing the name is not.

import type { IconNode } from "$lib/components/ui/icon";
import { BUILTIN_ICON_NAMES, parseBuiltinKey } from "$lib/iconCatalog";
import RocketIcon from "@hugeicons/core-free-icons/RocketIcon";
import StarIcon from "@hugeicons/core-free-icons/StarIcon";
import FlameIcon from "@hugeicons/core-free-icons/FlameIcon";
import EnergyIcon from "@hugeicons/core-free-icons/EnergyIcon";
import SparklesIcon from "@hugeicons/core-free-icons/SparklesIcon";
import WandSparklesIcon from "@hugeicons/core-free-icons/MagicWand01Icon";
import BugIcon from "@hugeicons/core-free-icons/Bug01Icon";
import WrenchIcon from "@hugeicons/core-free-icons/Wrench01Icon";
import HammerIcon from "@hugeicons/core-free-icons/HammerIcon";
import CogIcon from "@hugeicons/core-free-icons/CogIcon";
import GitBranchIcon from "@hugeicons/core-free-icons/GitBranchIcon";
import GitMergeIcon from "@hugeicons/core-free-icons/GitMergeIcon";
import GitForkIcon from "@hugeicons/core-free-icons/GitForkIcon";
import GitPullRequestIcon from "@hugeicons/core-free-icons/GitPullRequestIcon";
import WorkflowIcon from "@hugeicons/core-free-icons/Flowchart01Icon";
import CodeIcon from "@hugeicons/core-free-icons/CodeIcon";
import TerminalIcon from "@hugeicons/core-free-icons/TerminalIcon";
import CpuIcon from "@hugeicons/core-free-icons/CpuIcon";
import DatabaseIcon from "@hugeicons/core-free-icons/DatabaseIcon";
import ServerIcon from "@hugeicons/core-free-icons/ServerStack01Icon";
import PackageIcon from "@hugeicons/core-free-icons/PackageIcon";
import BoxIcon from "@hugeicons/core-free-icons/BoxIcon";
import BoxesIcon from "@hugeicons/core-free-icons/BoxesIcon";
import LayersIcon from "@hugeicons/core-free-icons/Layers01Icon";
import ComponentIcon from "@hugeicons/core-free-icons/ComponentIcon";
import BeakerIcon from "@hugeicons/core-free-icons/BeakerIcon";
import AtomIcon from "@hugeicons/core-free-icons/Atom01Icon";
import BrainIcon from "@hugeicons/core-free-icons/BrainIcon";
import ShieldIcon from "@hugeicons/core-free-icons/Shield01Icon";
import LockIcon from "@hugeicons/core-free-icons/LockIcon";
import KeyIcon from "@hugeicons/core-free-icons/Key01Icon";
import FlagIcon from "@hugeicons/core-free-icons/Flag01Icon";
import BookmarkIcon from "@hugeicons/core-free-icons/Bookmark01Icon";
import TagIcon from "@hugeicons/core-free-icons/Tag01Icon";
import PinIcon from "@hugeicons/core-free-icons/PinIcon";
import BellIcon from "@hugeicons/core-free-icons/BellIcon";
import HeartIcon from "@hugeicons/core-free-icons/HeartIcon";
import CrownIcon from "@hugeicons/core-free-icons/CrownIcon";
import TrophyIcon from "@hugeicons/core-free-icons/ChampionIcon";
import GemIcon from "@hugeicons/core-free-icons/GemIcon";
import DiamondIcon from "@hugeicons/core-free-icons/DiamondIcon";
import TargetIcon from "@hugeicons/core-free-icons/Target01Icon";
import CompassIcon from "@hugeicons/core-free-icons/CompassIcon";
import MapIcon from "@hugeicons/core-free-icons/MapsIcon";
import RadarIcon from "@hugeicons/core-free-icons/Radar01Icon";
import SatelliteIcon from "@hugeicons/core-free-icons/SatelliteIcon";
import OrbitIcon from "@hugeicons/core-free-icons/Orbit01Icon";
import GlobeIcon from "@hugeicons/core-free-icons/GlobeIcon";
import CloudIcon from "@hugeicons/core-free-icons/CloudIcon";
import SunIcon from "@hugeicons/core-free-icons/Sun01Icon";
import MoonIcon from "@hugeicons/core-free-icons/MoonIcon";
import SnowflakeIcon from "@hugeicons/core-free-icons/CloudSnowIcon";
import LeafIcon from "@hugeicons/core-free-icons/Leaf01Icon";
import SproutIcon from "@hugeicons/core-free-icons/Plant01Icon";
import MountainIcon from "@hugeicons/core-free-icons/MountainIcon";
import FeatherIcon from "@hugeicons/core-free-icons/FeatherIcon";
import GhostIcon from "@hugeicons/core-free-icons/GhostIcon";
import PuzzleIcon from "@hugeicons/core-free-icons/PuzzleIcon";
import LightbulbIcon from "@hugeicons/core-free-icons/BulbIcon";
import MusicIcon from "@hugeicons/core-free-icons/MusicNote01Icon";
import PaletteIcon from "@hugeicons/core-free-icons/PaintBoardIcon";
import BrushIcon from "@hugeicons/core-free-icons/BrushIcon";
import AnchorIcon from "@hugeicons/core-free-icons/AnchorIcon";
import ShipIcon from "@hugeicons/core-free-icons/CargoShipIcon";
import GiftIcon from "@hugeicons/core-free-icons/GiftIcon";
import EyeIcon from "@hugeicons/core-free-icons/EyeIcon";
import HexagonIcon from "@hugeicons/core-free-icons/HexagonIcon";

/** Glyph name → Hugeicons drawing data. Every name in `BUILTIN_ICON_NAMES` has
 *  an entry. */
const REGISTRY: Record<string, IconNode> = {
  rocket: RocketIcon,
  star: StarIcon,
  flame: FlameIcon,
  zap: EnergyIcon,
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
export const BUILTIN_ICONS: { name: string; icon: IconNode }[] = BUILTIN_ICON_NAMES.map(
  (name) => ({ name, icon: REGISTRY[name] }),
);

/** Resolve a `builtin:<name>[~<color>]` value to its glyph data + color hex.
 *  Returns null when the value isn't a known built-in (unknown glyph → null, so
 *  the caller falls back to its default glyph). */
export function resolveBuiltinIcon(
  value?: string | null,
): { name: string; icon: IconNode; color: string | null } | null {
  const parsed = parseBuiltinKey(value);
  if (!parsed) return null;
  const icon = REGISTRY[parsed.name];
  if (!icon) return null;
  return { name: parsed.name, icon, color: parsed.color };
}
