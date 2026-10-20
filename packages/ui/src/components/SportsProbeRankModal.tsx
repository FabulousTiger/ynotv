import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { StoredChannel } from '../db';
import { quickProbeChannel, type ProbeChannelResult } from '../services/stream-probe';
import { rankResults, classifyTier, effectiveVideoBitrate, type RankTier } from '../services/probeRank';
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

function describeStream(r: ProbeChannelResult): string {
  const parts: string[] = [];
  if (r.height) parts.push(`${r.height}p`);
  if (r.fps) parts.push(`${Math.round(r.fps)}fps`);
  const bitrate = effectiveVideoBitrate(r);
  if (bitrate) parts.push(bitrate >= 1000 ? `${(bitrate / 1000).toFixed(1)} Mbps` : `${Math.round(bitrate)} kbps`);
  if (r.video_codec) parts.push(r.video_codec);
  return parts.join(' · ');
}

export function SportsProbeRankModal({ isOpen, query, channels, onClose, onPlayChannel }: SportsProbeRankModalProps) {
  const { t } = useTranslation('probe');
  const [results, setResults] = useState<Record<string, ProbeChannelResult>>({});
  const [running, setRunning] = useState(false);
  const [hideLow, setHideLow] = useState(false);
  const [hideDead, setHideDead] = useState(false);
  const runIdRef = useRef(0);

  // Fresh state whenever the dialog opens or closes; also abandons any run
  useEffect(() => {
    runIdRef.current += 1;
    setResults({});
    setRunning(false);
  }, [isOpen]);

  const handleStart = useCallback(async () => {
    if (running || channels.length === 0) return;
    runIdRef.current += 1;
    const runId = runIdRef.current;
    setResults({});
    setRunning(true);

    // One queue per source: a source is probed strictly one stream at a time,
    // different sources run side by side.
    const bySource = new Map<string, StoredChannel[]>();
    for (const channel of channels) {
      const list = bySource.get(channel.source_id) ?? [];
      list.push(channel);
      bySource.set(channel.source_id, list);
    }

    const runQueue = async (queue: StoredChannel[]) => {
      for (const channel of queue) {
        if (runIdRef.current !== runId) return;
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
        if (runIdRef.current !== runId) return;
        setResults((prev) => ({ ...prev, [channel.stream_id]: result }));
      }
    };

    try {
      await Promise.all(Array.from(bySource.values()).map(runQueue));
    } finally {
      if (runIdRef.current === runId) setRunning(false);
    }
  }, [running, channels]);

  const handleStop = useCallback(() => {
    runIdRef.current += 1;
    setRunning(false);
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

  const groups = useMemo(
    () => rankResults(channels.map((channel) => results[channel.stream_id] ?? pendingStub(channel))),
    [channels, results]
  );

  const doneCount = Object.keys(results).length;

  const tierLabel = (tier: RankTier): string => {
    if (tier === 'direct') return t('rankTierDirect');
    if (tier === 'restream') return t('rankTierRestream');
    return t('rankTierUnknown');
  };

  const renderRow = (r: ProbeChannelResult) => {
    const channel = channelById.get(r.stream_id);
    const showTier = r.status === 'alive';
    const tier = classifyTier(r);
    return (
      <div className="spr-row" key={r.stream_id}>
        <div className="spr-row-main">
          <div className="spr-row-name">{r.name}</div>
          <div className="spr-row-info">{r.status === 'alive' ? describeStream(r) : r.error_reason || r.status}</div>
        </div>
        {showTier && (
          <span className={`spr-tier spr-tier-${tier}`} title={t('rankTierHint')}>
            {tierLabel(tier)}
          </span>
        )}
        {channel && (
          <button type="button" className="spr-play" onClick={() => onPlayChannel(channel)}>
            {t('rankPlay')}
          </button>
        )}
      </div>
    );
  };

  const renderSection = (title: string, list: ProbeChannelResult[]) => {
    if (list.length === 0) return null;
    return (
      <div className="spr-section" key={title}>
        <div className="spr-section-title">
          {title} ({list.length})
        </div>
        {list.map(renderRow)}
      </div>
    );
  };

  if (!isOpen) return null;

  const nothingVisible =
    groups.ranked.length === 0 &&
    groups.pending.length === 0 &&
    (hideLow || groups.low.length === 0) &&
    (hideDead || groups.dead.length === 0);

  return (
    <div className="spr-overlay" onClick={handleClose}>
      <div className="spr-modal" onClick={(e) => e.stopPropagation()}>
        <div className="spr-header">
          <div>
            <div className="spr-title">{t('rankTitle', { query })}</div>
            <div className="spr-subtitle">{t('rankSubtitle', { count: channels.length })}</div>
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
            <button type="button" className="spr-btn spr-btn-primary" onClick={handleStart} disabled={channels.length === 0}>
              {t('rankStart')}
            </button>
          )}
          <span className="spr-progress">
            {running
              ? t('rankProgress', { done: doneCount, total: channels.length })
              : doneCount > 0
                ? t('rankDone', { done: doneCount, total: channels.length })
                : ''}
          </span>
          <label className="spr-toggle">
            <input type="checkbox" checked={hideLow} onChange={(e) => setHideLow(e.target.checked)} />
            {t('rankHideLow')}
          </label>
          <label className="spr-toggle">
            <input type="checkbox" checked={hideDead} onChange={(e) => setHideDead(e.target.checked)} />
            {t('rankHideDead')}
          </label>
        </div>

        <div className="spr-body">
          {renderSection(t('rankSectionRanked'), groups.ranked)}
          {renderSection(t('rankSectionPending'), groups.pending)}
          {!hideLow && renderSection(t('rankSectionLow'), groups.low)}
          {!hideDead && renderSection(t('rankSectionDead'), groups.dead)}
          {nothingVisible && <div className="spr-empty">{t('rankEmpty')}</div>}
        </div>
      </div>
    </div>
  );
}
