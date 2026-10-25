import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n, { translateNativeError } from '../i18n';
import { useDownloadStore, type DownloadItem } from '../stores/downloadStore';
import { matchesSearch } from '../utils/searchNormalization';
import type { DvrRecording } from '../db';
import {
  estimateEtaSeconds,
  formatBytes,
  formatEta,
  formatSpeed,
  groupDownloads,
  MAX_DOWNLOAD_RETRIES,
  summarizeQueue,
} from '../services/downloadStats';
import './DownloadsView.css';

interface DownloadsViewProps {
  onPlay?: (recording: DvrRecording) => void;
}

function splitTitle(title: string): { name: string; episode: string } {
  const m = title.match(/^(.*?) - (S\d+E\d+)(?: - (.*))?$/);
  return m ? { name: m[1], episode: m[2] + (m[3] ? ` · ${m[3]}` : '') } : { name: title, episode: '' };
}

const PauseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="4" width="4" height="16" />
    <rect x="14" y="4" width="4" height="16" />
  </svg>
);
const PlayIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);
const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);
const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

function statusLabel(item: DownloadItem): string {
  switch (item.status) {
    case 'downloading':
      return item.statusText
        ? item.statusText.toLowerCase().includes('subtitle')
          ? 'Extracting subtitles'
          : 'Post-processing'
        : 'Downloading';
    case 'queued':
      return 'Queued';
    case 'paused':
      return 'Paused';
    case 'completed':
      return 'Done';
    case 'failed':
      return 'Failed';
    default:
      return 'Canceled';
  }
}

export function DownloadsView({ onPlay }: DownloadsViewProps) {
  useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [historyOpen, setHistoryOpen] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  const downloads = useDownloadStore((s) => s.downloads) || [];
  const cancelDownload = useDownloadStore((s) => s.cancelDownload);
  const pauseDownload = useDownloadStore((s) => s.pauseDownload);
  const resumeDownload = useDownloadStore((s) => s.resumeDownload);
  const removeDownload = useDownloadStore((s) => s.removeDownload);
  const clearCompleted = useDownloadStore((s) => s.clearCompleted);
  const clearQueue = useDownloadStore((s) => s.clearQueue);

  const hasActive = downloads.some((d) => d.status === 'downloading');
  useEffect(() => {
    if (!hasActive) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasActive]);

  const filtered = useMemo(
    () =>
      searchQuery
        ? downloads.filter((d) => matchesSearch(d.title, searchQuery) || matchesSearch(d.savePath, searchQuery))
        : downloads,
    [downloads, searchQuery]
  );
  const { active, queue, paused, history } = useMemo(() => groupDownloads(filtered), [filtered]);
  const summary = useMemo(() => summarizeQueue(downloads, now), [downloads, now]);

  const playItem = (item: DownloadItem) =>
    onPlay?.({
      file_path: item.savePath,
      program_title: item.title,
      channel_name: 'Media Download',
      status: 'completed',
      filename: '',
      auto_delete_policy: 'keep_forever',
      created_at: Math.floor(item.addedAt / 1000),
      actual_start: Math.floor(item.addedAt / 1000),
      scheduled_start: Math.floor(item.addedAt / 1000),
      scheduled_end: Math.floor(item.addedAt / 1000),
    });

  const renderRow = (item: DownloadItem, index?: number) => {
    const { name, episode } = splitTitle(item.title);
    const watched =
      item.status === 'completed' && item.watchProgressSeconds && item.durationSecs
        ? Math.min(100, Math.round((item.watchProgressSeconds / item.durationSecs) * 100))
        : null;
    return (
      <div key={item.id} className={`dl-row ${item.status}`}>
        {index !== undefined && <span className="dl-row-index">{index}</span>}
        <div className="dl-row-main">
          <div className="dl-row-title" title={item.title}>
            {name}
            {episode && <span className="dl-row-episode"> · {episode}</span>}
          </div>
          <div className="dl-row-path" title={item.savePath}>
            {item.savePath}
          </div>
          {item.status === 'queued' && item.retryCount ? (
            <div className="dl-row-error">
              Retrying after: {translateNativeError(item.lastError || '')}
            </div>
          ) : null}
          {item.status === 'failed' && item.error && (
            <div className="dl-row-error">
              {i18n.t('common:errorPrefix')}: {translateNativeError(item.error)}
            </div>
          )}
        </div>
        <span className={`dl-badge ${item.status}`}>
          {watched !== null && watched > 0
            ? `Done · watched ${watched}%`
            : item.status === 'queued' && item.retryCount
            ? `Retry ${item.retryCount}/${MAX_DOWNLOAD_RETRIES}`
            : statusLabel(item)}
        </span>
        <div className="dl-row-actions">
          {item.status === 'queued' && (
            <button className="dvr-btn-icon" onClick={() => pauseDownload(item.id)} title={i18n.t('dvr:pauseDownload')}>
              <PauseIcon />
            </button>
          )}
          {item.status === 'paused' && (
            <button className="dvr-btn-icon play" onClick={() => resumeDownload(item.id)} title={i18n.t('dvr:resumeDownload')}>
              <PlayIcon />
            </button>
          )}
          {item.status === 'completed' && onPlay && (
            <button className="dvr-btn-icon play" onClick={() => playItem(item)} title={i18n.t('dvr:playDownloaded')}>
              <PlayIcon />
            </button>
          )}
          {(item.status === 'queued' || item.status === 'paused') && (
            <button className="dvr-btn-icon danger" onClick={() => cancelDownload(item.id)} title={i18n.t('dvr:cancelDownload')}>
              <CloseIcon />
            </button>
          )}
          {(item.status === 'completed' || item.status === 'failed' || item.status === 'canceled') && (
            <button className="dvr-btn-icon danger" onClick={() => removeDownload(item.id)} title={i18n.t('dvr:removeFromList')}>
              <TrashIcon />
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderHero = (item: DownloadItem) => {
    const { name, episode } = splitTitle(item.title);
    const eta = estimateEtaSeconds(item, now);
    const processing = !!item.statusText;
    const pct = Math.min(100, Math.max(0, item.progress));
    return (
      <div key={item.id} className="dl-hero">
        {item.poster && (
          <img
            className="dl-hero-poster"
            src={item.poster}
            alt=""
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        )}
        <div className="dl-hero-body">
          <div className="dl-hero-top">
            <div className="dl-hero-heading">
              <h3 className="dl-hero-title" title={item.title}>{name}</h3>
              {episode && <div className="dl-hero-episode">{episode}</div>}
            </div>
            <span className={`dl-badge ${processing ? 'processing' : 'downloading'}`}>{statusLabel(item)}</span>
            <div className="dl-row-actions">
              <button
                className="dvr-btn-icon"
                disabled={processing}
                onClick={() => pauseDownload(item.id)}
                title={processing ? i18n.t('dvr:cannotPausePostProcessing') : i18n.t('dvr:pauseDownload')}
              >
                <PauseIcon />
              </button>
              <button className="dvr-btn-icon danger" onClick={() => cancelDownload(item.id)} title={i18n.t('dvr:cancelDownload')}>
                <CloseIcon />
              </button>
            </div>
          </div>

          <div className="dl-progress">
            <div className={`dl-progress-fill ${processing ? 'processing' : ''}`} style={{ width: `${processing ? 100 : pct}%` }} />
          </div>

          <div className="dl-stats">
            {processing ? (
              <span className="dl-stat dl-stat-wide">{item.statusText}</span>
            ) : (
              <>
                <span className="dl-stat"><b>{Math.round(pct)}%</b></span>
                <span className="dl-stat">
                  {formatBytes(item.bytesWritten)}
                  {item.totalBytes ? ` / ${formatBytes(item.totalBytes)}` : ''}
                </span>
                <span className="dl-stat">{formatSpeed(item.speedBytes)}</span>
                <span className="dl-stat">{eta !== null ? `${formatEta(eta)} left` : 'Estimating…'}</span>
              </>
            )}
          </div>
          <div className="dl-hero-path" title={item.savePath}>{item.savePath}</div>
        </div>
      </div>
    );
  };

  const hasFinished = downloads.some((d) => d.status !== 'downloading' && d.status !== 'queued' && d.status !== 'paused');
  const nothingToShow = filtered.length === 0;

  return (
    <div className="dl-view">
      <div className="dl-toolbar">
        <div className="dl-summary">
          {summary.remaining > 0 ? (
            <>
              <span className="dl-summary-main">
                {summary.doneInBatch + Math.min(summary.remaining, 1)} of {summary.doneInBatch + summary.remaining}
              </span>
              <span className="dl-summary-sub">
                {summary.remaining} left
                {summary.etaSeconds !== null ? ` · ${formatEta(summary.etaSeconds)} for all` : ''}
              </span>
              <div className="dl-progress dl-progress-thin">
                <div className="dl-progress-fill" style={{ width: `${summary.percent}%` }} />
              </div>
            </>
          ) : (
            <span className="dl-summary-sub">
              {downloads.length === 0 ? 'No downloads' : `Nothing downloading · ${history.length} in history`}
            </span>
          )}
        </div>

        <input
          type="text"
          className="dl-search dvr-downloads-search-input"
          placeholder={i18n.t('dvr:searchDownloads')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />

        {downloads.some((d) => d.status === 'queued' || d.status === 'paused' || d.status === 'downloading') && (
          <button
            className="dvr-btn-clear"
            onClick={() => {
              if (confirm('Cancel the active download and clear all queued/paused items?')) clearQueue();
            }}
          >
            Clear queue
          </button>
        )}

        {hasFinished && (
          <button className="dvr-btn-clear" onClick={clearCompleted}>
            Clear history
          </button>
        )}
      </div>

      {downloads.length === 0 ? (
        <div className="dvr-empty-state">
          <h3>{i18n.t('dvr:noDownloads')}</h3>
          <p>{i18n.t('dvr:noDownloadsHint')}</p>
        </div>
      ) : nothingToShow ? (
        <div className="dvr-empty-state">
          <h3>{i18n.t('dvr:noMatchingDownloads')}</h3>
          <p>{i18n.t('dvr:noMatchingDownloadsHint')}</p>
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <section className="dl-section">
              <h4 className="dl-section-title">Now downloading</h4>
              {active.map(renderHero)}
            </section>
          )}

          {queue.length > 0 && (
            <section className="dl-section">
              <h4 className="dl-section-title">Up next <span className="dl-count">{queue.length}</span></h4>
              <div className="dl-list">{queue.map((d, i) => renderRow(d, i + 1))}</div>
            </section>
          )}

          {paused.length > 0 && (
            <section className="dl-section">
              <h4 className="dl-section-title">Paused <span className="dl-count">{paused.length}</span></h4>
              <div className="dl-list">{paused.map((d) => renderRow(d))}</div>
            </section>
          )}

          {history.length > 0 && (
            <section className="dl-section">
              <h4 className="dl-section-title dl-section-toggle" onClick={() => setHistoryOpen((v) => !v)}>
                {historyOpen ? '▾' : '▸'} History <span className="dl-count">{history.length}</span>
              </h4>
              {historyOpen && <div className="dl-list">{history.map((d) => renderRow(d))}</div>}
            </section>
          )}
        </>
      )}
    </div>
  );
}
