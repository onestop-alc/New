import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { th } from 'date-fns/locale';
import { AlertTriangle, Activity } from 'lucide-react';
import {
  casualtyLabel,
  casualtyState,
  casualtyTotals,
  fetchStories,
  storyConfidence,
  type Story
} from '../lib/api.js';

export default function Feed() {
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchStories()
      .then(data => {
        setStories(data);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 text-red-600 p-4 rounded-2xl border border-red-100 flex items-center gap-3 shadow-sm">
        <Activity className="h-5 w-5" />
        <p className="text-sm font-semibold">{error}</p>
      </div>
    );
  }

  if (stories.length === 0) {
    return (
      <div className="text-center py-20 bg-white rounded-3xl border border-slate-200 shadow-sm flex flex-col items-center justify-center">
        <AlertTriangle className="h-12 w-12 text-slate-300 mb-4" />
        <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-2">ยังไม่มีข้อมูลข่าว</h3>
        <p className="text-xs text-slate-500 font-medium">ระบบกำลังรวบรวมข่าวสาร กรุณากลับมาดูใหม่ภายหลัง</p>
      </div>
    );
  }

  // Split stories into featured (first) and others
  const featuredStory = stories[0];
  const recentStories = stories.slice(1);

  // Helper to determine icon/color based on keywords
  const getIconData = (title: string) => {
    if (title.includes('รถเก๋ง') || title.includes('เก๋ง')) return { icon: '🚗', color: 'bg-blue-100' };
    if (title.includes('จยย') || title.includes('จักรยานยนต์') || title.includes('มอเตอร์ไซค์')) return { icon: '🛵', color: 'bg-orange-100' };
    if (title.includes('ด่าน') || title.includes('รวบ') || title.includes('จับ')) return { icon: '🚔', color: 'bg-emerald-100' };
    return { icon: '🚨', color: 'bg-slate-100' };
  };

  // source_count has a default but no NOT NULL — Array(NaN) would blank the page.
  const featuredSourceCount = featuredStory?.source_count ?? 1;

  // Excludes stories with no reported figure and period roundups — see
  // casualtyTotals(). Imputing zero for "not reported" is what made the old
  // headline number an undercount that read like a fact.
  const totals = casualtyTotals(stories);
  const topProvince: Record<string, number> = {};
  for (const story of stories) {
    const province = story.provinces?.[0];
    if (province) topProvince[province] = (topProvince[province] || 0) + 1;
  }
  const [highestRiskArea = 'ไม่ระบุ', highestRiskCount = 0] =
    Object.entries(topProvince).sort((a, b) => b[1] - a[1])[0] ?? [];
  // Was hard-coded to 75%, which meant nothing. Share of the stories on screen
  // that name this province.
  const highestRiskShare = stories.length
    ? Math.round((highestRiskCount / stories.length) * 100)
    : 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      {/* Main Featured Story */}
      {featuredStory && (
        <section className="lg:col-span-8 bg-white rounded-3xl border border-slate-200 shadow-sm p-6 flex flex-col relative overflow-hidden">
          <div className="absolute top-0 right-0 p-6">
            {storyConfidence(featuredStory) === 'high' ? (
              <span className="bg-red-50 text-red-600 text-[10px] font-bold px-2 py-1 rounded border border-red-100">HIGH CONFIDENCE</span>
            ) : (
              <span className="bg-amber-50 text-amber-700 text-[10px] font-bold px-2 py-1 rounded border border-amber-100">MEDIUM CONFIDENCE</span>
            )}
          </div>
          <div className="mb-4">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">LATEST STORY: #{featuredStory.id.toString().padStart(5, '0')}</span>
            <Link to={`/story/${featuredStory.id}`}>
              <h2 className="text-2xl sm:text-3xl font-extrabold mt-2 leading-tight text-slate-800 hover:text-blue-700 transition-colors">
                {featuredStory.display_title}
              </h2>
            </Link>
          </div>
          <div className="flex flex-wrap gap-4 mb-6">
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-400 font-bold uppercase">จังหวัด</span>
              <span className="text-sm font-semibold">{featuredStory.provinces?.[0] || 'ไม่ระบุ'}</span>
            </div>
            <div className="h-8 w-px bg-slate-200 hidden sm:block"></div>
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-400 font-bold uppercase">ความสูญเสีย</span>
              <span
                className={`text-sm font-semibold ${
                  casualtyState(featuredStory) === 'unknown' ? 'text-slate-500' : 'text-red-600'
                }`}
              >
                เสียชีวิต {casualtyLabel(featuredStory.deaths)} | บาดเจ็บ {casualtyLabel(featuredStory.injuries)}
              </span>
            </div>
            <div className="h-8 w-px bg-slate-200 hidden sm:block"></div>
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-400 font-bold uppercase">เวลาเกิดเหตุ</span>
              <span className="text-sm font-semibold">
                {formatDistanceToNow(new Date(featuredStory.first_published), { addSuffix: true, locale: th })}
              </span>
            </div>
          </div>
          
          <div className="mt-auto flex items-center justify-between">
             <div className="flex -space-x-2">
              {[...Array(Math.min(featuredSourceCount, 4))].map((_, i) => (
                 <div key={i} className="w-8 h-8 rounded-full bg-slate-200 border-2 border-white flex items-center justify-center text-[10px] text-slate-600 font-bold shadow-sm">
                   <Activity className="h-3 w-3" />
                 </div>
              ))}
              {featuredSourceCount > 4 && (
                <div className="w-8 h-8 rounded-full bg-slate-100 border-2 border-white flex items-center justify-center text-[10px] text-slate-500 font-bold">
                  +{featuredSourceCount - 4}
                </div>
              )}
            </div>
            <span className="text-xs text-slate-400 font-medium italic">รายงานโดย {featuredSourceCount} สำนักข่าว</span>
          </div>
        </section>
      )}

      {/* Statistics Widget */}
      <section className="lg:col-span-4 bg-slate-900 rounded-3xl p-6 text-white flex flex-col justify-between shadow-sm">
        <div>
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">ภาพรวม (จาก {stories.length} ข่าวล่าสุด)</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-4xl font-black text-red-500">{totals.deaths}</div>
              <div className="text-[10px] font-bold text-slate-400 uppercase">เสียชีวิตรวม</div>
            </div>
            <div>
              <div className="text-4xl font-black text-orange-400">{totals.injuries}</div>
              <div className="text-[10px] font-bold text-slate-400 uppercase">บาดเจ็บรวม</div>
            </div>
          </div>
          <p className="text-[10px] text-slate-500 font-medium mt-3 leading-relaxed">
            นับจาก {totals.counted} ข่าวที่ระบุจำนวน
            {totals.unknown > 0 && <> · อีก {totals.unknown} ข่าวไม่ระบุ</>}
            {totals.aggregate > 0 && <> · ไม่รวม {totals.aggregate} ข่าวสรุปสถิติ</>}
          </p>
        </div>
        <div className="pt-4 mt-6 border-t border-slate-800">
           <div className="flex justify-between text-xs mb-1">
             <span className="text-slate-400">พื้นที่เฝ้าระวังสูงสุด</span>
             <span className="text-emerald-400 font-bold">
               {highestRiskArea}
               {highestRiskCount > 0 && (
                 <span className="text-slate-500 font-medium"> · {highestRiskShare}%</span>
               )}
             </span>
           </div>
           <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
             <div
               className="bg-emerald-500 h-1.5 rounded-full transition-all"
               style={{ width: `${highestRiskShare}%` }}
             ></div>
           </div>
        </div>
      </section>

      {/* Recent Feed */}
      <section className="lg:col-span-12 bg-white rounded-3xl border border-slate-200 shadow-sm p-6 overflow-hidden flex flex-col mt-2">
        <div className="flex justify-between items-center mb-4 pb-4 border-b border-slate-100">
          <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">ข่าวอื่นๆ ในระบบ</h3>
          <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded-md">{recentStories.length} รายการ</span>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {recentStories.map((story) => {
             const { icon, color } = getIconData(story.display_title);
             return (
              <Link 
                key={story.id} 
                to={`/story/${story.id}`}
                className="flex items-center gap-4 p-3 hover:bg-slate-50 rounded-2xl border border-transparent hover:border-slate-100 transition-all group"
              >
                <div className={`w-12 h-12 ${color} rounded-xl flex items-center justify-center text-xl shrink-0 group-hover:scale-105 transition-transform`}>
                  {icon}
                </div>
                <div className="flex-grow min-w-0">
                  <h4 className="text-sm font-bold text-slate-800 truncate">{story.display_title}</h4>
                  <p className="text-[10px] text-slate-500 font-medium flex gap-2 mt-1 truncate">
                    <span>{formatDistanceToNow(new Date(story.first_published), { addSuffix: true, locale: th })}</span>
                    <span>•</span>
                    {/* Four-way, not three: an unread story used to render the
                        green "no casualties" badge, i.e. the site asserted a
                        fact it did not have. */}
                    {casualtyState(story) === 'fatal' ? (
                      <span className="text-red-500">เสียชีวิต {story.deaths}</span>
                    ) : casualtyState(story) === 'injury' ? (
                      <span className="text-orange-500">บาดเจ็บ {story.injuries}</span>
                    ) : casualtyState(story) === 'none' ? (
                      <span className="text-emerald-500">ไม่มีผู้บาดเจ็บ/เสียชีวิต</span>
                    ) : (
                      <span className="text-slate-400">ยังไม่ระบุจำนวน</span>
                    )}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-[10px] font-bold bg-slate-100 px-2 py-1 rounded text-slate-600">{story.source_count} สำนัก</span>
                </div>
              </Link>
             );
          })}
        </div>
      </section>
    </div>
  );
}
