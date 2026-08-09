import { useEffect, useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { th } from 'date-fns/locale';
import { fetchLastRun, type LastRun } from '../lib/api.js';

/** Ingestion runs every 30 minutes, so a gap past 45 minutes is already late. */
const FRESH_LIMIT_MS = 45 * 60 * 1000;
const STALE_LIMIT_MS = 3 * 60 * 60 * 1000;

const REFETCH_INTERVAL_MS = 5 * 60 * 1000;
const TICK_INTERVAL_MS = 60 * 1000;

type Freshness = 'fresh' | 'late' | 'stale';

function freshnessOf(finishedAt: Date, now: number): Freshness {
  const age = now - finishedAt.getTime();
  if (age <= FRESH_LIMIT_MS) return 'fresh';
  if (age <= STALE_LIMIT_MS) return 'late';
  return 'stale';
}

const DOT_COLOR: Record<Freshness, string> = {
  fresh: 'bg-emerald-500',
  late: 'bg-amber-500',
  stale: 'bg-red-500'
};

const COMPACT_STYLE: Record<Freshness, string> = {
  fresh: 'bg-emerald-600 text-white',
  late: 'bg-amber-500 text-white',
  stale: 'bg-red-600 text-white'
};

export default function LastUpdated({ variant = 'full' }: { variant?: 'compact' | 'full' }) {
  const [run, setRun] = useState<LastRun | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  // Re-render on a timer so the relative label keeps moving on an open tab.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let active = true;

    const load = () => {
      fetchLastRun()
        .then(result => {
          if (!active) return;
          setRun(result);
          setLoaded(true);
          setFailed(false);
          setNow(Date.now());
        })
        .catch(() => {
          if (!active) return;
          setLoaded(true);
          setFailed(true);
        });
    };

    load();
    const refetch = setInterval(load, REFETCH_INTERVAL_MS);
    const tick = setInterval(() => setNow(Date.now()), TICK_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(refetch);
      clearInterval(tick);
    };
  }, []);

  // Placeholder states keep the same footprint so the header does not jump.
  if (!run) {
    const message = !loaded
      ? 'กำลังตรวจสอบ…'
      : failed
        ? 'ไม่ทราบเวลาอัปเดต'
        : 'ยังไม่มีข้อมูลการอัปเดต';

    return variant === 'compact' ? (
      <div className="px-4 py-2 rounded-lg text-xs font-bold shadow-md flex items-center gap-1.5 ml-2 bg-slate-200 text-slate-500">
        <span className="w-2 h-2 rounded-full bg-slate-400"></span>
        <span className="normal-case">{message}</span>
      </div>
    ) : (
      <span className="flex items-center gap-1.5 normal-case text-slate-400">
        <span className="w-2 h-2 rounded-full bg-slate-300"></span>
        {message}
      </span>
    );
  }

  const freshness = freshnessOf(run.finishedAt, now);
  const relative = formatDistanceToNow(run.finishedAt, { addSuffix: true, locale: th });
  const absolute = format(run.finishedAt, 'd MMM yyyy HH:mm น.', { locale: th });

  if (variant === 'compact') {
    return (
      <div
        className={`px-4 py-2 rounded-lg text-xs font-bold shadow-md flex items-center gap-1.5 ml-2 ${COMPACT_STYLE[freshness]}`}
        title={`ข้อมูลล่าสุด ${absolute}`}
      >
        <span className="w-2 h-2 rounded-full bg-white/90 animate-pulse"></span>
        <span className="normal-case">อัปเดต {relative}</span>
      </div>
    );
  }

  return (
    <span className="flex items-center gap-1.5 normal-case">
      <span className={`w-2 h-2 rounded-full ${DOT_COLOR[freshness]}`}></span>
      <span className="text-slate-500">ข้อมูลล่าสุด {absolute}</span>
      <span className="text-slate-400">({relative})</span>
      {freshness === 'stale' && (
        <span className="text-red-500 font-bold">· ระบบอาจหยุดอัปเดต</span>
      )}
    </span>
  );
}
