import type { LucideIcon } from "lucide-react";
import { Crosshair, Move, Palette, Wand2, Volume2, Gauge, Film, Sparkles, Type, Gamepad2 } from "lucide-react";

export type InspectorTabId =
  | "avatarAlign"
  | "transform"
  | "color"
  | "effects"
  | "audio"
  | "speed"
  | "animate"
  | "ai"
  | "style"
  | "avatarActions";

export type InspectorClipType =
  | "video"
  | "image"
  | "audio"
  | "text"
  | "shape"
  | "svg"
  | "sticker";

export interface InspectorTabDef {
  id: InspectorTabId;
  label: string;
  icon: LucideIcon;
}

export const TAB_DEFS: Record<InspectorTabId, InspectorTabDef> = {
  avatarAlign: { id: "avatarAlign", label: "动作对齐", icon: Crosshair },
  transform: { id: "transform", label: "Transform", icon: Move },
  color: { id: "color", label: "Color", icon: Palette },
  effects: { id: "effects", label: "Effects", icon: Wand2 },
  audio: { id: "audio", label: "Audio", icon: Volume2 },
  speed: { id: "speed", label: "Speed", icon: Gauge },
  animate: { id: "animate", label: "Animate", icon: Film },
  ai: { id: "ai", label: "AI", icon: Sparkles },
  style: { id: "style", label: "Style", icon: Type },
  avatarActions: { id: "avatarActions", label: "手动动画", icon: Gamepad2 },
};

const TABS_BY_CLIP_TYPE: Record<InspectorClipType, InspectorTabId[]> = {
  video: ["transform", "color", "effects", "audio", "speed", "animate", "ai"],
  image: ["transform", "color", "effects", "speed", "animate", "ai"],
  audio: ["audio", "ai"],
  text: ["transform", "style", "effects", "animate"],
  shape: ["transform", "style", "effects", "animate"],
  svg: ["transform", "style", "effects", "animate"],
  sticker: ["transform", "effects", "animate"],
};

export function getTabIdsForClipType(
  clipType: InspectorClipType | null,
): InspectorTabId[] {
  if (!clipType) return [];
  return TABS_BY_CLIP_TYPE[clipType];
}

export function getTabsForClipType(
  clipType: InspectorClipType | null,
): InspectorTabDef[] {
  return getTabIdsForClipType(clipType).map((id) => TAB_DEFS[id]);
}
