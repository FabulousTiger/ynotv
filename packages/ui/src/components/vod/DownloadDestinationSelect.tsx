import { useTranslation } from 'react-i18next';
import {
  DOWNLOAD_DESTINATIONS,
  isDownloadDestination,
  type DownloadDestination,
} from '../../services/downloadNaming';

export interface DownloadDestinationSelectProps {
  value: DownloadDestination;
  onChange: (destination: DownloadDestination) => void;
}

export function DownloadDestinationSelect({ value, onChange }: DownloadDestinationSelectProps) {
  const { t } = useTranslation('vod');
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
      <span>{t('downloadDestination')}</span>
      <select
        value={value}
        onChange={(e) => {
          if (isDownloadDestination(e.target.value)) onChange(e.target.value);
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {DOWNLOAD_DESTINATIONS.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
    </label>
  );
}
