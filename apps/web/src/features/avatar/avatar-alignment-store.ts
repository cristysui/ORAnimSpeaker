import { create } from "zustand";

interface AvatarAlignmentState {
  referenceKey: string;
  showOnionSkin: boolean;
  referenceOpacity: number;
  alignMessage: string | null;
  setReferenceKey: (referenceKey: string) => void;
  setShowOnionSkin: (showOnionSkin: boolean) => void;
  setReferenceOpacity: (referenceOpacity: number) => void;
  setAlignMessage: (alignMessage: string | null) => void;
}

export const useAvatarAlignmentStore = create<AvatarAlignmentState>((set) => ({
  referenceKey: "",
  showOnionSkin: true,
  referenceOpacity: 0.42,
  alignMessage: null,
  setReferenceKey: (referenceKey) => set({ referenceKey }),
  setShowOnionSkin: (showOnionSkin) => set({ showOnionSkin }),
  setReferenceOpacity: (referenceOpacity) => set({ referenceOpacity }),
  setAlignMessage: (alignMessage) => set({ alignMessage }),
}));
