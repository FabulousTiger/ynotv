import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { StoredChannel } from '../db';
import { quickProbeChannel, type ProbeChannelResult } from '../services/stream-probe';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { useToastStore } from '../stores/toastStore';
import {
  rankResults,
  effectiveVideoBitrate,
  resolutionClass,
  resolutionLabel,
  fpsClass,
  bitrateClass,
  estimateRemainingSeconds,
  formatDuration,
  isNoSignal,
} from '../services/probeRank';
import { ageMinutes, cacheKey, isFresh, mergeEffectiveResults } from '../services/probeCache';
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
  const [hidden, setHidden] = useState(false);
  const [exportMsg, setExportMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const runIdRef = useRef(0);
  const resultsRef = useRef<Record<string, ProbeChannelResult>>({});
  const cacheEntries = useProbeCacheStore((s) => s.entries);
  const recordProbe = useProbeCacheStore((s) => s.record);
  const clearProbeCache = useProbeCacheStore((s) => s.clearCache);

  // Fresh state whenever the dialog opens or closes; also abandons any run
  useEffect(() => {
    runIdRef.current += 1;
    resultsRef.current = {};
    setResults({});
    setProbingIds({});
    setCurrentName('');
    setStartedAt(null);
    setEndedAt(null);
    setRunning(false);
    setHidden(false);
    setExportMsg(null);
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
      resultsRef.current = { ...resultsRef.current, [channel.stream_id]: result };
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
    resultsRef.current = {};
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
        const merged = mergeEffectiveResults(
          channels,
          resultsRef.current,
          useProbeCacheStore.getState().entries,
          Date.now()
        );
        const best = rankResults(Object.values(merged)).ranked[0];
        useToastStore.getState().addToast(
          best
            ? t('rankToastDone', { count: channels.length, name: best.name })
            : t('rankToastDoneNone', { count: channels.length }),
          'success'
        );
      }
    }
  }, [running, channels, probeOne, t]);

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

  const handleExportLog = useCallback(async () => {
    const json = JSON.stringify(useProbeCacheStore.getState().log, null, 2);
    try {
      const path = await save({
        defaultPath: 'H:\\Downloads\\ynotv-probe-log.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (!path) return;
      await writeTextFile(path, json);
      setExportMsg({ text: t('rankExportSaved', { path }) });
    } catch (err) {
      setExportMsg({ text: t('rankExportFailed', { error: err instanceof Error ? err.message : String(err) }), error: true });
    }
  }, [t]);

  const handleCopyLog = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(useProbeCacheStore.getState().log, null, 2));
      setExportMsg({ text: t('rankCopied') });
    } catch (err) {
      setExportMsg({ text: t('rankExportFailed', { error: err instanceof Error ? err.message : String(err) }), error: true });
    }
  }, [t]);

  const handleStop = useCallback(() => {
    runIdRef.current += 1;
    setRunning(false);
    setProbingIds({});
    setEndedAt(Date.now());
  }, []);

  // While probing, the corner X only hides the window; idle, it closes
  const handleClose = useCallback(() => {
    if (running) {
      setHidden(true);
      return;
    }
    runIdRef.current += 1;
    onClose();
  }, [running, onClose]);

  const channelById = useMemo(() => {
    const map = new Map<string, StoredChannel>();
    for (const channel of channels) map.set(channel.stream_id, channel);
    return map;
  }, [channels]);

  // This session's results win; otherwise a fresh cached result is shown
  const effective = useMemo(() => {
    return mergeEffectiveResults(channels, results, cacheEntries, Date.now());
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

  if (hidden) {
    const best = groups.ranked[0]?.name;
    const chipText = running
      ? best
        ? t('rankChipRunningBest', { current: Math.min(doneCount + 1, total), total, name: best })
        : t('rankChipRunning', { current: Math.min(doneCount + 1, total), total })
      : best
        ? t('rankChipDoneBest', { done: doneCount, total, name: best })
        : t('rankChipDone', { done: doneCount, total });
    return (
      <div className={`spr-chip-bar${running ? ' spr-chip-bar-running' : ''}`}>
        <button type="button" className="spr-chip-open" onClick={() => setHidden(false)} title={t('rankChipOpen')}>
          {running && <span className="spr-spinner" aria-hidden="true" />}
          <span>{chipText}</span>
        </button>
        {!running && (
          <button type="button" className="spr-chip-dismiss" onClick={handleClose} aria-label={t('close')}>
            ✕
          </button>
        )}
      </div>
    );
  }

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
          <button
            type="button"
            className="spr-close"
            onClick={handleClose}
            aria-label={running ? t('rankHide') : t('close')}
            title={running ? t('rankHide') : t('close')}
          >
            ✕
          </button>
        </div>

        <div className="spr-toolbar">
          {running ? (
            <button type="button" className="spr-btn spr-btn-stop" onClick={handleStop}>
              {t('rankStopProbing')}
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
          <button type="button" className="spr-btn" onClick={() => void handleExportLog()}>
            {t('rankExportLog')}
          </button>
          <button type="button" className="spr-btn" onClick={() => void handleCopyLog()}>
            {t('rankCopyLog')}
          </button>
        </div>
        {running && <div className="spr-bg-hint">{t('rankBackgroundHint')}</div>}
        {exportMsg && <div className={`spr-export-msg${exportMsg.error ? ' spr-export-error' : ''}`}>{exportMsg.text}</div>}

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
