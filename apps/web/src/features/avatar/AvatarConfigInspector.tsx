import React, { useMemo } from "react";
import type { Transform } from "@openreel/core";
import { Crosshair, Eye, Wand2 } from "lucide-react";
import { useProjectStore } from "../../stores/project-store";
import {
  getAvatarConfig,
  updateAvatarSequenceActionTransform,
  updateAvatarSequenceFrameTransform,
  updateAvatarVideoAssetTransform,
} from "./avatar-project";
import { useAvatarSelectionStore } from "./avatar-selection-store";
import { useAvatarAlignmentStore } from "./avatar-alignment-store";
import {
  detectSubjectBox,
  itemKey,
  sequenceFrameItemsToConfig,
  sequenceItemToConfig,
  subjectCenterOnCanvas,
  videoItemToConfig,
} from "./AvatarConfigStageOverlay";
import { useI18n } from "../../i18n";

const numberOrZero = (value: string): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const AvatarConfigInspector: React.FC<{ mode?: "align" | "transform" }> = ({
  mode = "transform",
}) => {
  const { t } = useI18n();
  const project = useProjectStore((state) => state.project);
  const selectedConfig = useAvatarSelectionStore((state) => state.selectedConfig);
  const referenceKey = useAvatarAlignmentStore((state) => state.referenceKey);
  const setReferenceKey = useAvatarAlignmentStore((state) => state.setReferenceKey);
  const showOnionSkin = useAvatarAlignmentStore((state) => state.showOnionSkin);
  const setShowOnionSkin = useAvatarAlignmentStore((state) => state.setShowOnionSkin);
  const referenceOpacity = useAvatarAlignmentStore((state) => state.referenceOpacity);
  const setReferenceOpacity = useAvatarAlignmentStore((state) => state.setReferenceOpacity);
  const alignMessage = useAvatarAlignmentStore((state) => state.alignMessage);
  const setAlignMessage = useAvatarAlignmentStore((state) => state.setAlignMessage);
  const config = useMemo(() => getAvatarConfig(project), [project]);
  const [isAligning, setIsAligning] = React.useState(false);

  const allItems = useMemo(() => {
    return [
      ...config.videoConfig.idle.map((item) => videoItemToConfig(item)),
      ...config.videoConfig.speaking.map((item) => videoItemToConfig(item)),
      ...config.videoConfig.actions.map((item) => videoItemToConfig(item)),
      ...config.sequenceConfig.idle.map((item) => sequenceItemToConfig(item)),
      ...config.sequenceConfig.speaking.map((item) => sequenceItemToConfig(item)),
      ...config.sequenceConfig.actions.map((item) => sequenceItemToConfig(item)),
      ...config.sequenceConfig.idle.flatMap((item) => sequenceFrameItemsToConfig(item)),
      ...config.sequenceConfig.speaking.flatMap((item) => sequenceFrameItemsToConfig(item)),
      ...config.sequenceConfig.actions.flatMap((item) => sequenceFrameItemsToConfig(item)),
    ];
  }, [config]);

  const selectedItem = useMemo(() => {
    if (!selectedConfig) return null;
    return allItems.find((item) => {
      if (item.source !== selectedConfig.source || item.id !== selectedConfig.id) return false;
      if (selectedConfig.source !== "sequence-frame") return true;
      return item.actionId === selectedConfig.actionId;
    }) ?? null;
  }, [allItems, selectedConfig]);

  const selectedKey = selectedItem ? itemKey(selectedItem) : "";
  const referenceItems = useMemo(
    () => allItems.filter((item) => item.mediaId && itemKey(item) !== selectedKey),
    [allItems, selectedKey],
  );
  const referenceItem = useMemo(
    () => referenceItems.find((item) => itemKey(item) === referenceKey) ?? null,
    [referenceItems, referenceKey],
  );
  const media = useMemo(
    () => project.mediaLibrary.items.find((item) => item.id === selectedItem?.mediaId),
    [project.mediaLibrary.items, selectedItem?.mediaId],
  );
  const referenceMedia = useMemo(
    () => project.mediaLibrary.items.find((item) => item.id === referenceItem?.mediaId),
    [project.mediaLibrary.items, referenceItem?.mediaId],
  );

  React.useEffect(() => {
    if (referenceItems.length === 0) {
      setReferenceKey("");
      return;
    }
    if (referenceItems.some((item) => itemKey(item) === referenceKey)) return;

    const preferred =
      selectedItem?.kind === "idle"
        ? referenceItems.find((item) => item.kind === "speaking")
        : referenceItems.find((item) => item.kind === "idle");
    setReferenceKey(itemKey(preferred ?? referenceItems[0]));
  }, [referenceItems, referenceKey, selectedItem?.kind, setReferenceKey]);

  if (!selectedConfig || !selectedItem) return null;

  const kindText = (kind: string) => {
    if (kind === "idle") return t("avatar.idle");
    if (kind === "speaking") return t("avatar.speaking");
    return t("avatar.manualAction");
  };
  const transform = selectedItem.transform;
  const toEditableTransform = (effectiveTransform: Transform): Transform => {
    if (selectedItem.source !== "sequence-frame") return effectiveTransform;
    const basePosition = {
      x: selectedItem.previewTransform.position.x - selectedItem.transform.position.x,
      y: selectedItem.previewTransform.position.y - selectedItem.transform.position.y,
    };
    const baseScale = {
      x: selectedItem.transform.scale.x !== 0
        ? selectedItem.previewTransform.scale.x / selectedItem.transform.scale.x
        : 1,
      y: selectedItem.transform.scale.y !== 0
        ? selectedItem.previewTransform.scale.y / selectedItem.transform.scale.y
        : 1,
    };
    const baseRotation = selectedItem.previewTransform.rotation - selectedItem.transform.rotation;
    const baseOpacity = selectedItem.transform.opacity !== 0
      ? selectedItem.previewTransform.opacity / selectedItem.transform.opacity
      : 1;

    return {
      ...selectedItem.transform,
      position: {
        x: effectiveTransform.position.x - basePosition.x,
        y: effectiveTransform.position.y - basePosition.y,
      },
      scale: {
        x: effectiveTransform.scale.x / Math.max(0.0001, baseScale.x),
        y: effectiveTransform.scale.y / Math.max(0.0001, baseScale.y),
      },
      rotation: effectiveTransform.rotation - baseRotation,
      opacity: effectiveTransform.opacity / Math.max(0.0001, baseOpacity),
    };
  };
  const updateTransform = (nextTransform: Transform) => {
    if (selectedConfig.source === "video") {
      updateAvatarVideoAssetTransform(selectedConfig.id, nextTransform);
    } else if (selectedConfig.source === "sequence") {
      updateAvatarSequenceActionTransform(selectedConfig.id, nextTransform);
    } else {
      updateAvatarSequenceFrameTransform(
        selectedConfig.actionId,
        selectedConfig.id,
        nextTransform,
      );
    }
  };
  const patchTransform = (patch: Partial<Transform>) => {
    updateTransform({ ...transform, ...patch });
  };
  const applyReferenceTransform = () => {
    if (!referenceItem) return;
    updateTransform(toEditableTransform({
      ...transform,
      position: { ...referenceItem.previewTransform.position },
      scale: { ...referenceItem.previewTransform.scale },
      rotation: referenceItem.previewTransform.rotation,
    }));
    setAlignMessage(t("avatar.alignApplied"));
  };
  const autoAlignSubject = async () => {
    if (!referenceItem || !media || !referenceMedia) return;
    setIsAligning(true);
    setAlignMessage(null);
    try {
      const [currentBox, referenceBox] = await Promise.all([
        detectSubjectBox(media),
        detectSubjectBox(referenceMedia),
      ]);
      if (!currentBox || !referenceBox) {
        setAlignMessage(t("avatar.noSubject"));
        return;
      }

      const referenceCenter = subjectCenterOnCanvas(
        referenceBox,
        referenceItem.previewTransform,
        project.settings.width,
        project.settings.height,
      );
      const currentSourceOffset = {
        x: currentBox.x + currentBox.width / 2 - currentBox.sourceWidth * (transform.anchor?.x ?? 0.5),
        y: currentBox.y + currentBox.height / 2 - currentBox.sourceHeight * (transform.anchor?.y ?? 0.5),
      };
      const scaleByHeight =
        (referenceBox.height * referenceItem.previewTransform.scale.y) / Math.max(1, currentBox.height);
      const scaleByWidth =
        (referenceBox.width * referenceItem.previewTransform.scale.x) / Math.max(1, currentBox.width);
      const nextScale = Math.max(
        0.02,
        Math.min(20, scaleByHeight * 0.75 + scaleByWidth * 0.25),
      );

      updateTransform(toEditableTransform({
        ...transform,
        position: {
          x: referenceCenter.x - project.settings.width / 2 - currentSourceOffset.x * nextScale,
          y: referenceCenter.y - project.settings.height / 2 - currentSourceOffset.y * nextScale,
        },
        scale: { x: nextScale, y: nextScale },
      }));
      setAlignMessage(t("avatar.autoAlignApplied"));
    } catch (error) {
      console.warn("[avatar] Auto align failed", error);
      setAlignMessage(t("avatar.autoAlignFailed"));
    } finally {
      setIsAligning(false);
    }
  };

  return (
    <div className="h-full bg-bg-1 text-fg flex flex-col">
      <div
        className="flex-1 overflow-y-auto p-4 custom-scrollbar"
        data-avatar-selection-keep
      >
        {mode === "align" ? (
        <div className="rounded-lg border border-border bg-bg-2 p-3">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg">
            <Crosshair className="h-4 w-4 text-accent" />
            {t("avatar.align")}
          </div>
          <label className="mb-3 block text-xs text-fg-muted">
            {t("avatar.referenceAction")}
            <select
              value={referenceKey}
              onChange={(event) => setReferenceKey(event.target.value)}
              className="mt-1 w-full rounded border border-border bg-bg px-2 py-1.5 text-fg"
            >
              {referenceItems.length === 0 ? (
                <option value="">{t("avatar.noReference")}</option>
              ) : (
                referenceItems.map((item) => (
                  <option key={itemKey(item)} value={itemKey(item)}>
                    {kindText(item.kind)} · {item.name}
                  </option>
                ))
              )}
            </select>
          </label>

          <div className="mb-3 flex items-center gap-2 text-xs text-fg-muted">
            <label className="flex shrink-0 items-center gap-1 text-fg-2">
              <input
                type="checkbox"
                checked={showOnionSkin}
                onChange={(event) => setShowOnionSkin(event.target.checked)}
              />
              <Eye className="h-3.5 w-3.5" />
              {t("avatar.onionSkin")}
            </label>
            <input
              type="range"
              min="0.1"
              max="0.9"
              step="0.05"
              value={referenceOpacity}
              onChange={(event) => setReferenceOpacity(Number(event.target.value))}
              className="min-w-0 flex-1 accent-accent"
              disabled={!showOnionSkin}
            />
            <span className="w-8 text-right">{Math.round(referenceOpacity * 100)}%</span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              className="rounded bg-bg px-2 py-1.5 text-xs text-fg-2 hover:bg-hover disabled:opacity-50"
              disabled={!referenceItem}
              onClick={applyReferenceTransform}
            >
              {t("avatar.applyTransform")}
            </button>
            <button
              className="inline-flex items-center justify-center gap-1 rounded bg-accent px-2 py-1.5 text-xs text-white hover:opacity-90 disabled:opacity-50"
              disabled={!referenceItem || isAligning}
              onClick={() => void autoAlignSubject()}
            >
              <Wand2 className="h-3.5 w-3.5" />
              {isAligning ? t("avatar.aligning") : t("avatar.autoAlign")}
            </button>
          </div>
          {alignMessage && (
            <div className="mt-2 text-[11px] text-fg-muted">{alignMessage}</div>
          )}
        </div>
        ) : (
          <>
            <div className="mb-4 rounded-lg border border-border bg-bg-2 p-3">
              <div className="text-xs text-fg-muted">{t("avatar.currentAction")}</div>
              <div className="mt-1 truncate text-sm font-medium">{selectedItem.name}</div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="X"
                value={transform.position.x}
                onChange={(value) => patchTransform({ position: { ...transform.position, x: value } })}
              />
              <NumberField
                label="Y"
                value={transform.position.y}
                onChange={(value) => patchTransform({ position: { ...transform.position, y: value } })}
              />
              <NumberField
                label={t("avatar.widthScale")}
                step={0.05}
                value={transform.scale.x}
                onChange={(value) => patchTransform({ scale: { ...transform.scale, x: value } })}
              />
              <NumberField
                label={t("avatar.heightScale")}
                step={0.05}
                value={transform.scale.y}
                onChange={(value) => patchTransform({ scale: { ...transform.scale, y: value } })}
              />
              <NumberField
                label={t("avatar.rotation")}
                value={transform.rotation}
                onChange={(value) => patchTransform({ rotation: value })}
              />
              <NumberField
                label={t("avatar.opacity")}
                min={0}
                max={1}
                step={0.05}
                value={transform.opacity}
                onChange={(value) => patchTransform({ opacity: value })}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const NumberField: React.FC<{
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}> = ({ label, value, min, max, step = 1, onChange }) => (
  <label className="text-xs text-fg-muted">
    {label}
    <input
      type="number"
      value={Number(value.toFixed(3))}
      min={min}
      max={max}
      step={step}
      onChange={(event) => onChange(numberOrZero(event.target.value))}
      className="mt-1 w-full rounded border border-border bg-bg px-2 py-1 text-fg"
    />
  </label>
);

export default AvatarConfigInspector;
