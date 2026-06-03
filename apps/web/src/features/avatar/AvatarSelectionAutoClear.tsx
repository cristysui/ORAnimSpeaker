import { useEffect } from "react";
import { useTimelineStore } from "../../stores/timeline-store";
import { useAvatarSelectionStore } from "./avatar-selection-store";

const INTERACTIVE_SELECTOR = [
  "[data-avatar-selection-keep]",
  "button",
  "input",
  "select",
  "textarea",
  "label",
  "[role='button']",
].join(",");

export const AvatarSelectionAutoClear: React.FC = () => {
  const selectedConfig = useAvatarSelectionStore((state) => state.selectedConfig);
  const clearConfigSelection = useAvatarSelectionStore(
    (state) => state.clearConfigSelection,
  );
  const playbackState = useTimelineStore((state) => state.playbackState);

  useEffect(() => {
    if (playbackState === "playing") {
      clearConfigSelection();
    }
  }, [clearConfigSelection, playbackState]);

  useEffect(() => {
    if (!selectedConfig) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest(INTERACTIVE_SELECTOR)) return;
      clearConfigSelection();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [clearConfigSelection, selectedConfig]);

  return null;
};

export default AvatarSelectionAutoClear;
