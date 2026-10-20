import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { StoredChannel } from '../db';
import { quickProbeChannel, type ProbeChannelResult } from '../services/stream-probe';
import {
  rankResults,
  classifyTier,
  effectiveVideoBitrate,
  resolutionClass,
  resolutionLabel,
  fpsClass,
  bitrateClass,
  estimateRemainingSeconds,
  formatDuration,
  isNoSignal,
  type RankTier,
} from '../services/probeRank';
import { ageMinutes, cacheKey, isFresh } from '../services/probeCache';
import { useProbeCacheStore } from '../stores/probeCacheStore';
import './SportsProbeRankModal.css';

export interface SportsProbeRankModalProps {
  isOpen: boolean;
  query: string;
  channels: StoredChannel[];
  onClose: () => void;
  onPlayChannel: (channel: StoredChannel) => void;
}

function pendingStub(channel: StoredChannel): ProbeChannelResult {
  return {
    stream_id: channel.stream_id,
    source_id: channel.source_id,
    name: channel.name,
    url: '',
    status: 'pending',
  };
}

function formatBitrate(kbps: number): string {
  return kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mbps` : `${Math.round(kbps)} kbps`;
}

type SectionKind = 'ranked' | 'dead' | 'pending';

export function SportsProbeRankModal({ isOpen, query, channels, onClose, onPlayChannel }: SportsProbeRankModalProps) {
  const { t } = useTranslation('probe');
  const [results, setResults] = useState<Record<string, ProbeChannelResult>>({});
  const [running, setRunning] = useState(false);
  const [hideDead, setHideDead] = useState(false);
  const [probingIds, setProbingIds] = useState<Record<string, true>>({});
  const [currentName, setCurrentName] = useState('');
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [endedAt, setEndedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const runIdRef = useRef(0);
  const cacheEntries = useProbeCacheStore((s) => s.entries);
  const recordProbe = useProbeCacheStore((s) => s.record);
  const clearProbeCache = useProbeCacheStore((s) => s.clearCache);

  // Fresh state whenever the dialog opens or closes; also abandons any run
  useEffect(() => {
    runIdRef.current += 1;
    setResults({});
    setProbingIds({});
    setCurrentName('');
    setStartedAt(null);
    setEndedAt(null);
    setRunning(false);
  }, [isOpen]);

  // Live clock for elapsed time and ETA while a run is active
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  // Probe one channel, store the result in the cache and show it
  const probeOne = useCallback(
    async (channel: StoredChannel, runId: number) => {
      setProbingIds((prev) => ({ ...prev, [channel.stream_id]: true }));
      setCurrentName(channel.name);
      let result: ProbeChannelResult;
      try {
        result = await quickProbeChannel(channel);
      } catch (err) {
        result = {
          ...pendingStub(channel),
          status: 'dead',
          error_reason: err instanceof Error ? err.message : String(err),
        };
      }
      recordProbe(result, channel.source_name);
      if (runIdRef.current !== runId) return;
      setResults((prev) => ({ ...prev, [channel.stream_id]: result }));
      setProbingIds((prev) => {
        const next = { ...prev };
        delete next[channel.stream_id];
        return next;
      });
    },
    [recordProbe]
  );

  const handleStart = useCallback(async () => {
    if (running || channels.length === 0) return;
    runIdRef.current += 1;
    const runId = runIdRef.current;
    const begun = Date.now();
    setResults({});
    setProbingIds({});
    setCurrentName('');
    setStartedAt(begun);
    setNow(begun);
    setEndedAt(null);
    setRunning(true);

    // One queue per source: a source is probed strictly one stream at a time,
    // different sources run side by side. Fresh cached results are not probed.
    const cached = useProbeCacheStore.getState().entries;
    const bySource = new Map<string, StoredChannel[]>();
    for (const channel of channels) {
      const entry = cached[cacheKey(channel.source_id, channel.stream_id)];
      if (entry && isFresh(entry, begun)) continue;
      const list = bySource.get(channel.source_id) ?? [];
      list.push(channel);
      bySource.set(channel.source_id, list);
    }

    const runQueue = async (queue: StoredChannel[]) => {
      for (const channel of queue) {
        if (runIdRef.current !== runId) return;
        await probeOne(channel, runId);
      }
    };

    try {
      await Promise.all(Array.from(bySource.values()).map(runQueue));
    } finally {
      if (runIdRef.current === runId) {
        setRunning(false);
        setProbingIds({});
        setEndedAt(Date.now());
      }
    }
  }, [running, channels, probeOne]);

  const handleReprobe = useCallback(
    (channel: StoredChannel) => {
      void probeOne(channel, runIdRef.current);
    },
    [probeOne]
  );

  const handleClearCache = useCallback(() => {
    clearProbeCache();
    setResults({});
  }, [clearProbeCache]);

  const handleExportLog = useCallback(() => {
    const log = useProbeCacheStore.getState().log;
    const blob = new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = 'ynotv-probe-log.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 300);
  }, []);

  const handleStop = useCallback(() => {
    runIdRef.current += 1;
    setRunning(false);
    setProbingIds({});
    setEndedAt(Date.now());
  }, []);

  const handleClose = useCallback(() => {
    runIdRef.current += 1;
    setRunning(false);
    onClose();
  }, [onClose]);

  const channelById = useMemo(() => {
    const map = new Map<string, StoredChannel>();
    for (const channel of channels) map.set(channel.stream_id, channel);
    return map;
  }, [channels]);

  // This session's results win; otherwise a fresh cached result is shown
  const effective = useMemo(() => {
    const at = Date.now();
    const map: Record<string, ProbeChannelResult> = {};
    for (const channel of channels) {
      const done = results[channel.stream_id];
      if (done) {
        map[channel.stream_id] = done;
        continue;
      }
      const entry = cacheEntries[cacheKey(channel.source_id, channel.stream_id)];
      if (entry && isFresh(entry, at)) map[channel.stream_id] = { ...entry.result, name: channel.name };
    }
    return map;
  }, [channels, results, cacheEntries]);

  // Recomputed on every completed probe, so ranked results re-sort live
  const groups = useMemo(
    () =>
      rankResults(
        channels.map((channel): ProbeChannelResult => {
          const stub = pendingStub(channel);
          if (probingIds[channel.stream_id]) return { ...stub, status: 'probing' };
          return effective[channel.stream_id] ?? stub;
        })
      ),
    [channels, effective, probingIds]
  );

  // Channels being probed right now go first in the not-probed list
  const pendingSorted = useMemo(
    () => [...groups.pending].sort((a, b) => Number(b.status === 'probing') - Number(a.status === 'probing')),
    [groups.pending]
  );

  const doneCount = Object.keys(effective).length;
  const total = channels.length;
  const elapsedSec = startedAt === null ? 0 : ((endedAt ?? now) - startedAt) / 1000;
  const etaSec = running ? estimateRemainingSeconds(elapsedSec, doneCount, total) : null;
  const percent = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  const tierLabel = (tier: RankTier): string => {
    if (tier === 'direct') return t('rankTierDirect');
    if (tier === 'restream') return t('rankTierRestream');
    return t('rankTierUnknown');
  };

  const cachedAtLabel = (r: ProbeChannelResult): string => {
    if (r.status === 'pending' || r.status === 'probing') return '';
    const entry = cacheEntries[cacheKey(r.source_id, r.stream_id)];
    if (!entry) return '';
    const minutes = ageMinutes(entry.at, Date.now());
    return minutes < 1 ? t('rankAgeJustNow') : t('rankAgeMinutes', { minutes });
  };

  const renderRow = (r: ProbeChannelResult) => {
    const channel = channelById.get(r.stream_id);
    const noSignal = isNoSignal(r);
    const alive = r.status === 'alive' && !noSignal;
    const probing = r.status === 'probing';
    const tier = classifyTier(r);
    const bitrate = effectiveVideoBitrate(r);
    return (
      <div className={`spr-row${probing ? ' spr-row-probing' : ''}`} key={r.stream_id}>
        {probing && <span className="spr-spinner" aria-hidden="true" />}
        <div className="spr-row-main">
          <div className="spr-row-name">{r.name}</div>
          <div className="spr-row-info">
            {alive ? (
              <>
                {r.height ? (
                  <span className={`spr-chip spr-res spr-res-${resolutionClass(r.height)}`}>{resolutionLabel(r.height)}</span>
                ) : null}
                {r.fps ? (
                  <span className={`spr-chip spr-scale spr-scale-${fpsClass(r.fps)}`}>{Math.round(r.fps)} fps</span>
                ) : null}
                {bitrate ? (
                  <span className={`spr-chip spr-scale spr-scale-${bitrateClass(bitrate)}`} title={t('rankBadgeBitrate')}>
                    {formatBitrate(bitrate)}
                  </span>
                ) : null}
                {r.video_codec ? <span className="spr-chip spr-codec">{r.video_codec}</span> : null}
              </>
            ) : probing ? (
              t('rankProbingRow')
            ) : noSignal ? (
              t('rankNoSignal')
            ) : (
              r.error_reason || r.status
            )}
          </div>
        </div>
        {alive && (
          <span className={`spr-tier spr-tier-${tier}`} title={t('rankTierHint')}>
            {tierLabel(tier)}
          </span>
        )}
        {cachedAtLabel(r) && <span className="spr-age">{cachedAtLabel(r)}</span>}
        {channel && !probing && (
          <button type="button" className="spr-btn" onClick={() => handleReprobe(channel)}>
            {t('rankReprobe')}
          </button>
        )}
        {channel && (
          <button type="button" className="spr-play" onClick={() => onPlayChannel(channel)}>
            {t('rankPlay')}
          </button>
        )}
      </div>
    );
  };

  const renderSection = (kind: SectionKind, title: string, list: ProbeChannelResult[]) => {
    if (list.length === 0) return null;
    return (
      <div className={`spr-section spr-section-${kind}`} key={kind}>
        <div className="spr-section-title">
          <span>{title}</span>
          <span className="spr-count">{list.length}</span>
        </div>
        {list.map(renderRow)}
      </div>
    );
  };

  if (!isOpen) return null;

  const nothingVisible =
    groups.ranked.length === 0 &&
    groups.pending.length === 0 &&
    (hideDead || groups.dead.length === 0);

  return (
    <div className="spr-overlay" onClick={handleClose}>
      <div className="spr-modal" onClick={(e) => e.stopPropagation()}>
        <div className="spr-header">
          <div>
            <div className="spr-title">{t('rankTitle', { query })}</div>
            <div className="spr-subtitle">{t('rankSubtitle', { count: total })}</div>
          </div>
          <button type="button" className="spr-close" onClick={handleClose} aria-label={t('close')}>
            ✕
          </button>
        </div>

        <div className="spr-toolbar">
          {running ? (
            <button type="button" className="spr-btn" onClick={handleStop}>
              {t('rankStop')}
            </button>
          ) : (
            <button type="button" className="spr-btn spr-btn-primary" onClick={handleStart} disabled={total === 0}>
              {t('rankStart')}
            </button>
          )}
          <label className="spr-toggle">
            <input type="checkbox" checked={hideDead} onChange={(e) => setHideDead(e.target.checked)} />
            {t('rankHideDead')}
          </label>
          <button type="button" className="spr-btn" onClick={handleClearCache}>
            {t('rankClearCache')}
          </button>
          <button type="button" className="spr-btn" onClick={handleExportLog}>
            {t('rankExportLog')}
          </button>
        </div>

        {(running || doneCount > 0) && (
          <div className="spr-progress-block">
            <div className="spr-bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={doneCount}>
              <div className={`spr-bar-fill${running ? ' spr-bar-active' : ''}`} style={{ width: `${percent}%` }} />
            </div>
            <div className="spr-progress-text">
              <span className="spr-progress-main">
                {running
                  ? t('rankProgressNow', { current: Math.min(doneCount + 1, total), total, name: currentName })
                  : t('rankDone', { done: doneCount, total })}
              </span>
              <span className="spr-progress-time">
                {t('rankElapsed', { time: formatDuration(elapsedSec) })}
                {etaSec !== null && ` · ${t('rankEta', { time: formatDuration(etaSec) })}`}
              </span>
            </div>
          </div>
        )}

        <div className="spr-body">
          {renderSection('ranked', t('rankSectionRanked'), groups.ranked)}
          {!hideDead && renderSection('dead', t('rankSectionDead'), groups.dead)}
          {renderSection('pending', t('rankSectionPending'), pendingSorted)}
          {nothingVisible && <div className="spr-empty">{t('rankEmpty')}</div>}
        </div>
      </div>
    </div>
  );
}
