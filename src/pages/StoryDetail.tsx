import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';
import { ArrowLeft, ExternalLink, MapPin, Skull, FileText, Activity, Clock } from 'lucide-react';
import {
  casualtyLabel,
  casualtyState,
  fetchStory,
  type StoryWithArticles
} from '../lib/api.js';

const SOURCE_LABELS: Record<string, string> = {
  regex: 'คำสำคัญ',
  llm: 'AI',
  manual: 'บรรณาธิการ'
};

export default function StoryDetail() {
  const { id } = useParams();
  const [story, setStory] = useState<StoryWithArticles | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetchStory(id)
      .then(data => {
        setStory(data);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, [id]);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-600"></div>
      </div>
    );
  }

  if (error || !story) {
    return (
      <div className="bg-red-50 text-red-600 p-4 rounded-2xl border border-red-100 flex items-center gap-3 shadow-sm">
        <Activity className="h-5 w-5" />
        <p className="text-sm font-semibold">{error || 'Story not found'}</p>
      </div>
    );
  }

  // The snippet lives on the article the figure was read from, so find the
  // first member article carrying one.
  const sourceKind = story.deaths_source ?? story.injuries_source ?? null;
  const snippet = story.articles?.find(a => a.casualty_snippet?.trim())?.casualty_snippet;
  const evidence = sourceKind || snippet
    ? { label: SOURCE_LABELS[sourceKind ?? ''] ?? 'คำสำคัญ', snippet: snippet ?? '' }
    : null;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Link to="/" className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:text-slate-900 transition-colors bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
        <ArrowLeft className="h-3 w-3" />
        กลับไปหน้าฟีด
      </Link>

      <section className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 sm:p-8 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-6 hidden sm:block">
           <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">STORY ID: #{story.id.toString().padStart(5, '0')}</span>
        </div>
        
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 leading-tight mb-6">
          {story.display_title}
        </h1>

        <div className="flex flex-wrap gap-4 mb-8">
           <div className="flex flex-col">
              <span className="text-[10px] text-slate-400 font-bold uppercase">เวลาเกิดเหตุแรกสุด</span>
              <span className="text-sm font-semibold flex items-center gap-1">
                <Clock className="h-4 w-4 text-slate-400" />
                {format(new Date(story.first_published), 'd MMMM yyyy HH:mm', { locale: th })}
              </span>
           </div>
           <div className="h-8 w-px bg-slate-200 hidden sm:block"></div>
           {story.provinces && story.provinces.length > 0 && (
              <>
                <div className="flex flex-col">
                  <span className="text-[10px] text-slate-400 font-bold uppercase">พื้นที่</span>
                  <span className="text-sm font-semibold flex items-center gap-1">
                    <MapPin className="h-4 w-4 text-slate-400" />
                    {story.provinces.join(', ')}
                  </span>
                </div>
                <div className="h-8 w-px bg-slate-200 hidden sm:block"></div>
              </>
           )}
           <div className="flex flex-col">
              <span className="text-[10px] text-slate-400 font-bold uppercase">ความสูญเสีย</span>
              <span
                className={`text-sm font-semibold flex items-center gap-1 ${
                  casualtyState(story) === 'unknown' ? 'text-slate-500' : 'text-red-600'
                }`}
              >
                 <Skull className="h-4 w-4" />
                 เสียชีวิต {casualtyLabel(story.deaths)} | บาดเจ็บ {casualtyLabel(story.injuries)}
              </span>
              {/* Provenance: makes a wrong figure reportable instead of
                  mysterious, and shows the span it was read from. */}
              {evidence && (
                <span className="text-[10px] text-slate-400 font-medium mt-1" title={evidence.snippet}>
                  ตัวเลขจาก: {evidence.label}
                  {evidence.snippet && <> · “{evidence.snippet}”</>}
                </span>
              )}
           </div>
        </div>

        <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 mb-8">
           <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">บทสรุปรวม ({story.articles?.length || 0} สำนักข่าว)</h3>
           <p className="text-sm text-slate-600 leading-relaxed">
             {/* Simple synthesized summary from first article for aesthetic */}
             {story.articles?.find(article => article.summary?.trim())?.summary
               || 'ไม่มีรายละเอียดสรุปเพิ่มเติมสำหรับเหตุการณ์นี้'}
           </p>
        </div>

        <div>
          <div className="flex items-center justify-between mb-4">
             <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
               <FileText className="h-4 w-4 text-slate-400" />
               แหล่งข่าวที่รายงาน
             </h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {story.articles?.map(article => (
              <a 
                key={article.id} 
                href={article.url} 
                target="_blank" 
                rel="noopener noreferrer"
                className="group flex flex-col justify-between p-5 rounded-2xl border border-slate-200 bg-white hover:border-blue-300 hover:shadow-md transition-all h-full"
              >
                <div>
                  <div className="flex justify-between items-start gap-4 mb-2">
                    <span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-2 py-1 rounded">
                      {article.source}
                    </span>
                    <ExternalLink className="h-4 w-4 text-slate-300 group-hover:text-blue-600 shrink-0 transition-colors" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-800 group-hover:text-blue-700 transition-colors leading-snug mb-2 line-clamp-3">
                    {article.title}
                  </h3>
                  <p className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed">
                    {article.summary}
                  </p>
                </div>
                <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between text-[10px] font-bold text-slate-400">
                  <span>{format(new Date(article.published), 'dd/MM/yyyy HH:mm')}</span>
                  {article.confidence === 'high' ? (
                     <span className="text-red-500 bg-red-50 px-2 py-0.5 rounded border border-red-100 uppercase">High Match</span>
                  ) : (
                     <span className="text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-100 uppercase">Medium Match</span>
                  )}
                </div>
              </a>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
