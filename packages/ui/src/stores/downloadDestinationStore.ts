import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  DEFAULT_DESTINATION,
  isDownloadDestination,
  type DownloadContentType,
  type DownloadDestination,
} from '../services/downloadNaming';

interface DownloadDestinationState {
  /** Last destination chosen per content type. */
  last: Partial<Record<DownloadContentType, DownloadDestination>>;
  setLast: (type: DownloadContentType, destination: DownloadDestination) => void;
}

export const useDownloadDestinationStore = create<DownloadDestinationState>()(
  persist(
    (set) => ({
      last: {},
      setLast: (type, destination) => set((state) => ({ last: { ...state.last, [type]: destination } })),
    }),
    { name: 'ynotv-download-destination' }
  )
);

/** Remembered destination for a content type, or its default. */
export function getLastDestination(type: DownloadContentType): DownloadDestination {
  const stored = useDownloadDestinationStore.getState().last[type];
  return isDownloadDestination(stored) ? stored : DEFAULT_DESTINATION[type];
}
