/**
 * packages/renderer/src/state/openProjectStore.ts
 * Open-state for the in-app "Open Project" dialog (slice 3). The dialog is rendered once
 * at the app root; any "Open Project" control toggles it via this store.
 */

import { create } from 'zustand';

export interface OpenProjectStore {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

export const useOpenProjectStore = create<OpenProjectStore>((set) => ({
  isOpen: false,
  open:  () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));
