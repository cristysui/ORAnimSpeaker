import { create } from "zustand";

export type AvatarConfigSelection =
  | { source: "video"; id: string }
  | { source: "sequence"; id: string }
  | { source: "sequence-frame"; id: string; actionId: string };

interface AvatarSelectionState {
  selectedConfig: AvatarConfigSelection | null;
  selectConfig: (selection: AvatarConfigSelection | null) => void;
  clearConfigSelection: () => void;
}

export const useAvatarSelectionStore = create<AvatarSelectionState>((set) => ({
  selectedConfig: null,
  selectConfig: (selection) => set({ selectedConfig: selection }),
  clearConfigSelection: () => set({ selectedConfig: null }),
}));
