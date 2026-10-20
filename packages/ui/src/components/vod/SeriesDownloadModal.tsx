import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { buildSeriesFolderPreview, type DownloadDestination } from '../../services/downloadNaming';
import { getLastDestination, useDownloadDestinationStore } from '../../stores/downloadDestinationStore';
import { DownloadDestinationSelect } from './DownloadDestinationSelect';
import './SeriesDownloadModal.css';

export interface SeriesDownloadModalProps {
  isOpen: boolean;
  mode: 'single_season' | 'all_seasons';
  seriesTitle: string;
  seriesYear?: string | null;
  selectedSeason?: number;
  totalEpisodesCount: number;
  totalSeasonsCount?: number;
  baseDownloadPath?: string;
  onConfirm: (organizeByFolder: boolean, destination: DownloadDestination) => void;
  onCancel: () => void;
}

export function SeriesDownloadModal({
  isOpen,
  mode,
  seriesTitle,
  seriesYear,
  selectedSeason = 1,
  totalEpisodesCount,
  totalSeasonsCount = 1,
  baseDownloadPath,
  onConfirm,
  onCancel,
}: SeriesDownloadModalProps) {
  const { t } = useTranslation('vod');
  const [organizeByFolder, setOrganizeByFolder] = useState(true);
  const [destination, setDestination] = useState<DownloadDestination>(() => getLastDestination('series'));

  // Reset default state when opened
  useEffect(() => {
    if (isOpen) {
      setOrganizeByFolder(true);
      setDestination(getLastDestination('series'));
    }
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onCancel]);

  const handleConfirm = useCallback(() => {
    useDownloadDestinationStore.getState().setLast('series', destination);
    onConfirm(organizeByFolder, destination);
  }, [onConfirm, organizeByFolder, destination]);

  if (!isOpen) return null;

  const seasonLabel = mode === 'single_season'
    ? `Season ${String(selectedSeason).padStart(2, '0')}`
    : `Season [01..${String(totalSeasonsCount).padStart(2, '0')}]`;
  const previewPath = buildSeriesFolderPreview(
    baseDownloadPath ?? '',
    destination,
    seriesTitle,
    seriesYear,
    seasonLabel,
    organizeByFolder
  );

  const modalTitle = mode === 'single_season'
    ? t('downloadSeasonModalTitle', { season: selectedSeason })
    : t('downloadAllModalTitle');

  const summaryText = mode === 'single_season'
    ? t('singleSeasonSummary', { season: selectedSeason, count: totalEpisodesCount })
    : t('allSeasonsSummary', { seasonCount: totalSeasonsCount, count: totalEpisodesCount });

  const organizeSubtitle = mode === 'single_season'
    ? t('organizeBySeasonSubSingle', { title: seriesTitle, season: selectedSeason })
    : t('organizeBySeasonSubAll', { title: seriesTitle });

  return createPortal(
    <div className="series-download-modal-overlay" onClick={onCancel}>
      <div className="series-download-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        {/* Header */}
        <div className="series-download-modal__header">
          <h3 className="series-download-modal__title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m4-5 5 5 5-5m-5 5V3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {modalTitle}
          </h3>
          <button className="series-download-modal__close" onClick={onCancel} title={t('common:close', 'Close')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" strokeLinecap="round" />
              <line x1="6" y1="6" x2="18" y2="18" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="series-download-modal__body">
          {/* Summary */}
          <div className="series-download-modal__summary">
            <span className="series-download-modal__series-name" title={seriesTitle}>
              {seriesTitle}
            </span>
            <span className="series-download-modal__badge">
              {summaryText}
            </span>
          </div>

          <DownloadDestinationSelect value={destination} onChange={setDestination} />

          <div className="series-download-modal__options-label">
            {t('folderOrganization')}
          </div>

          {/* Option 1: Organize by folder */}
          <div
            className={`series-download-modal__option-card ${organizeByFolder ? 'active' : ''}`}
            onClick={() => setOrganizeByFolder(true)}
          >
            <div className="series-download-modal__radio-outer">
              <div className="series-download-modal__radio-inner" />
            </div>
            <div className="series-download-modal__option-text">
              <div className="series-download-modal__option-title">
                {t('organizeBySeasonOpt')}
              </div>
              <div className="series-download-modal__option-desc">
                {organizeSubtitle}
              </div>
            </div>
          </div>

          {/* Option 2: Save to root */}
          <div
            className={`series-download-modal__option-card ${!organizeByFolder ? 'active' : ''}`}
            onClick={() => setOrganizeByFolder(false)}
          >
            <div className="series-download-modal__radio-outer">
              <div className="series-download-modal__radio-inner" />
            </div>
            <div className="series-download-modal__option-text">
              <div className="series-download-modal__option-title">
                {t('saveToRootOpt')}
              </div>
              <div className="series-download-modal__option-desc">
                {t('saveToRootSub')}
              </div>
            </div>
          </div>

          {/* Destination Preview */}
          <div className="series-download-modal__preview">
            <div className="series-download-modal__preview-label">
              {t('pathPreview')}
            </div>
            <div className="series-download-modal__preview-path">
              {previewPath}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="series-download-modal__footer">
          <button className="series-download-modal__btn-cancel" onClick={onCancel} type="button">
            {t('common:cancel', 'Cancel')}
          </button>
          <button className="series-download-modal__btn-confirm" onClick={handleConfirm} type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m4-5 5 5 5-5m-5 5V3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {t('startDownload')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
