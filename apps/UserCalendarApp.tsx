import React, { useEffect, useMemo, useState } from 'react';
import { CaretLeft, CaretRight, Plus, Trash, Clock, ArrowCounterClockwise } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import Modal from '../components/os/Modal';
import { useLocalDateKey } from '../hooks/useLocalDateKey';
import { getCalendarDayDifference, getLocalDateKey, parseLocalDateKey } from '../utils/localDate';
import {
    loadUserCalendar,
    saveUserCalendar,
    sortCalendarEvents,
    CALENDAR_CONTEXT_FUTURE_DAYS,
    type UserCalendarEvent,
} from '../utils/userCalendar';

/**
 * 日历 — 用户自己的日程本。
 * 数据见 utils/userCalendar.ts；最近几天的安排会由 ContextBuilder 注入给角色。
 */

const WEEK_HEADERS = ['日', '一', '二', '三', '四', '五', '六'];

type Draft = { id?: string; title: string; date: string; time: string; allDay: boolean; note: string };

const emptyDraft = (date: string): Draft => ({ title: '', date, time: '09:00', allDay: true, note: '' });

/** 当月 6×7 网格（含前后月补位），每格是一个 YYYY-MM-DD。 */
function buildMonthGrid(year: number, month: number): string[] {
    const first = new Date(year, month, 1);
    const start = new Date(year, month, 1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => getLocalDateKey(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)));
}

function describeDay(key: string, today: string): string {
    const diff = getCalendarDayDifference(today, key);
    if (diff === 0) return '今天';
    if (diff === 1) return '明天';
    if (diff === -1) return '昨天';
    const d = parseLocalDateKey(key);
    return d ? `${d.getMonth() + 1}月${d.getDate()}日 周${WEEK_HEADERS[d.getDay()]}` : key;
}

const UserCalendarApp: React.FC = () => {
    const { closeApp, addToast } = useOS();
    const today = useLocalDateKey();
    const [events, setEvents] = useState<UserCalendarEvent[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [selected, setSelected] = useState(today);
    const [cursor, setCursor] = useState(() => {
        const d = parseLocalDateKey(today) || new Date();
        return { year: d.getFullYear(), month: d.getMonth() };
    });
    const [draft, setDraft] = useState<Draft | null>(null);

    useEffect(() => {
        loadUserCalendar().then(list => { setEvents(list); setLoaded(true); });
    }, []);

    const byDate = useMemo(() => {
        const map = new Map<string, UserCalendarEvent[]>();
        for (const e of events) {
            const list = map.get(e.date) || [];
            list.push(e);
            map.set(e.date, list);
        }
        return map;
    }, [events]);

    const grid = useMemo(() => buildMonthGrid(cursor.year, cursor.month), [cursor]);
    const monthPrefix = `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}`;
    const dayEvents = byDate.get(selected) || [];

    // 会被角色看到的范围：今天起往后几天
    const upcomingCount = useMemo(() => events.filter(e => {
        const diff = getCalendarDayDifference(today, e.date);
        return diff !== null && diff >= 0 && diff <= CALENDAR_CONTEXT_FUTURE_DAYS;
    }).length, [events, today]);

    const shiftMonth = (delta: number) => setCursor(c => {
        const d = new Date(c.year, c.month + delta, 1);
        return { year: d.getFullYear(), month: d.getMonth() };
    });

    const goToday = () => {
        const d = parseLocalDateKey(today) || new Date();
        setCursor({ year: d.getFullYear(), month: d.getMonth() });
        setSelected(today);
    };

    const pickDay = (key: string) => {
        setSelected(key);
        if (!key.startsWith(monthPrefix)) {
            const d = parseLocalDateKey(key);
            if (d) setCursor({ year: d.getFullYear(), month: d.getMonth() });
        }
    };

    const persist = async (next: UserCalendarEvent[]) => {
        const sorted = sortCalendarEvents(next);
        setEvents(sorted);
        try {
            await saveUserCalendar(sorted);
        } catch {
            addToast('保存失败，可能是存储空间不足', 'error');
        }
    };

    const openEdit = (e: UserCalendarEvent) => setDraft({
        id: e.id, title: e.title, date: e.date, time: e.time || '09:00', allDay: !e.time, note: e.note || '',
    });

    const submitDraft = async () => {
        if (!draft) return;
        const title = draft.title.trim();
        if (!title) { addToast('写一下要做什么吧', 'info'); return; }
        if (!parseLocalDateKey(draft.date)) { addToast('日期不对', 'info'); return; }
        const existing = draft.id ? events.find(e => e.id === draft.id) : undefined;
        const event: UserCalendarEvent = {
            id: draft.id || `cal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            title,
            date: draft.date,
            createdAt: existing?.createdAt ?? Date.now(),
            ...(draft.allDay || !draft.time ? {} : { time: draft.time.slice(0, 5) }),
            ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
        };
        await persist([...events.filter(e => e.id !== event.id), event]);
        pickDay(event.date);
        setDraft(null);
        addToast(existing ? '已更新' : '已加入日历', 'success');
    };

    const removeDraft = async () => {
        if (!draft?.id) return;
        await persist(events.filter(e => e.id !== draft.id));
        setDraft(null);
        addToast('已删除', 'info');
    };

    return (
        <div className="h-full w-full flex flex-col bg-gradient-to-b from-sky-50 via-white to-indigo-50 text-slate-700 relative overflow-hidden">
            {/* Header */}
            <div className="shrink-0 px-4 pb-3" style={{ paddingTop: 'calc(var(--safe-top, 0px) + 0.75rem)' }}>
                <div className="flex items-center justify-between h-12">
                    <button onClick={closeApp} aria-label="返回" className="p-2 -ml-2 rounded-full active:scale-90 transition-transform hover:bg-black/5">
                        <CaretLeft className="w-6 h-6 text-sky-500" weight="bold" />
                    </button>
                    <div className="text-base font-bold tracking-wide">日历</div>
                    <button
                        onClick={() => setDraft(emptyDraft(selected))}
                        aria-label="添加日程"
                        className="p-2 -mr-2 rounded-full active:scale-90 transition-transform hover:bg-black/5"
                    >
                        <Plus className="w-6 h-6 text-sky-500" weight="bold" />
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar px-4 space-y-4" style={{ paddingBottom: 'calc(var(--safe-bottom, 0px) + 1.5rem)' }}>
                {/* Month card */}
                <div className="bg-white/80 backdrop-blur-xl rounded-3xl shadow-sm border border-white p-4">
                    <div className="flex items-center justify-between mb-3">
                        <button onClick={() => shiftMonth(-1)} aria-label="上个月" className="p-1.5 rounded-full active:scale-90 hover:bg-slate-100">
                            <CaretLeft className="w-5 h-5 text-slate-400" />
                        </button>
                        <div className="flex items-center gap-2">
                            <span className="text-lg font-bold">{cursor.year}年{cursor.month + 1}月</span>
                            {(selected !== today || !today.startsWith(monthPrefix)) && (
                                <button onClick={goToday} className="flex items-center gap-1 text-[11px] font-bold text-sky-500 bg-sky-50 px-2 py-0.5 rounded-full active:scale-95">
                                    <ArrowCounterClockwise className="w-3 h-3" weight="bold" />今天
                                </button>
                            )}
                        </div>
                        <button onClick={() => shiftMonth(1)} aria-label="下个月" className="p-1.5 rounded-full active:scale-90 hover:bg-slate-100">
                            <CaretRight className="w-5 h-5 text-slate-400" />
                        </button>
                    </div>

                    <div className="grid grid-cols-7 text-center text-[11px] font-bold text-slate-400 mb-1">
                        {WEEK_HEADERS.map((w, i) => (
                            <div key={w} className={i === 0 || i === 6 ? 'text-rose-300' : ''}>{w}</div>
                        ))}
                    </div>

                    <div className="grid grid-cols-7 gap-y-1">
                        {grid.map(key => {
                            const inMonth = key.startsWith(monthPrefix);
                            const isToday = key === today;
                            const isSelected = key === selected;
                            const count = byDate.get(key)?.length || 0;
                            const day = Number(key.slice(8));
                            return (
                                <button
                                    key={key}
                                    onClick={() => pickDay(key)}
                                    aria-label={`${key}${count ? `，${count} 个日程` : ''}`}
                                    aria-pressed={isSelected}
                                    className="flex flex-col items-center justify-center h-11 active:scale-90 transition-transform"
                                >
                                    <span className={`w-8 h-8 flex items-center justify-center rounded-full text-sm transition-colors ${
                                        isSelected ? 'bg-sky-500 text-white font-bold shadow-md shadow-sky-200'
                                            : isToday ? 'text-sky-500 font-bold ring-1 ring-sky-300'
                                                : inMonth ? 'text-slate-700' : 'text-slate-300'
                                    }`}>{day}</span>
                                    <span className="h-1.5 flex gap-0.5 mt-0.5">
                                        {Array.from({ length: Math.min(count, 3) }, (_, i) => (
                                            <span key={i} className={`w-1 h-1 rounded-full ${inMonth ? 'bg-sky-400' : 'bg-slate-300'}`} />
                                        ))}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Selected day */}
                <div>
                    <div className="flex items-baseline justify-between px-1 mb-2">
                        <h3 className="text-sm font-bold">{describeDay(selected, today)}</h3>
                        <span className="text-[11px] text-slate-400">{selected}</span>
                    </div>

                    {loaded && dayEvents.length === 0 && (
                        <button
                            onClick={() => setDraft(emptyDraft(selected))}
                            className="w-full py-8 border-2 border-dashed border-slate-200 rounded-2xl text-sm text-slate-400 active:scale-[0.98] transition-transform"
                        >
                            这天还没有安排，点这里添加
                        </button>
                    )}

                    <div className="space-y-2">
                        {dayEvents.map(e => (
                            <button
                                key={e.id}
                                onClick={() => openEdit(e)}
                                className="w-full text-left bg-white/80 backdrop-blur-xl rounded-2xl border border-white shadow-sm px-4 py-3 flex gap-3 active:scale-[0.98] transition-transform"
                            >
                                <div className="w-1 self-stretch rounded-full bg-sky-400 shrink-0" />
                                <div className="min-w-0 flex-1">
                                    <div className="font-bold text-sm text-slate-700 break-words">{e.title}</div>
                                    <div className="flex items-center gap-1 text-[11px] text-slate-400 mt-0.5">
                                        <Clock className="w-3 h-3" />{e.time || '全天'}
                                    </div>
                                    {e.note && <div className="text-xs text-slate-500 mt-1 whitespace-pre-wrap break-words">{e.note}</div>}
                                </div>
                            </button>
                        ))}
                    </div>
                </div>

                <p className="text-[11px] leading-relaxed text-slate-400 px-1">
                    角色聊天时会看到你昨天到未来 {CALENDAR_CONTEXT_FUTURE_DAYS} 天的安排
                    {upcomingCount ? `（现在有 ${upcomingCount} 条）` : ''}。
                    需要角色开着「时间感知」。数据只存在这台设备上，会跟着「设置 → 备份与恢复」一起备份。
                </p>
            </div>

            <Modal
                isOpen={!!draft}
                title={draft?.id ? '编辑日程' : '新建日程'}
                onClose={() => setDraft(null)}
                footer={draft && (
                    <>
                        {draft.id && (
                            <button onClick={removeDraft} aria-label="删除日程" className="px-4 py-3 bg-rose-50 text-rose-500 rounded-2xl active:scale-95 transition-transform">
                                <Trash className="w-5 h-5" />
                            </button>
                        )}
                        <button onClick={() => setDraft(null)} className="flex-1 py-3 bg-slate-100 text-slate-500 font-bold rounded-2xl active:scale-95 transition-transform">取消</button>
                        <button onClick={submitDraft} className="flex-1 py-3 bg-sky-500 text-white font-bold rounded-2xl shadow-lg shadow-sky-200 active:scale-95 transition-transform">保存</button>
                    </>
                )}
            >
                {draft && (
                    <div className="space-y-3">
                        <label className="block">
                            <span className="text-[11px] text-slate-500 font-medium mb-1 block">要做什么</span>
                            <input
                                value={draft.title}
                                onChange={ev => setDraft({ ...draft, title: ev.target.value })}
                                placeholder="比如：下午面试"
                                maxLength={80}
                                autoFocus
                                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-sm outline-none focus:border-sky-300"
                            />
                        </label>
                        <label className="block">
                            <span className="text-[11px] text-slate-500 font-medium mb-1 block">日期</span>
                            <input
                                type="date"
                                value={draft.date}
                                onChange={ev => setDraft({ ...draft, date: ev.target.value })}
                                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-sm outline-none focus:border-sky-300"
                            />
                        </label>
                        <div>
                            <div className="flex items-center justify-between mb-1">
                                <span className="text-[11px] text-slate-500 font-medium">时间</span>
                                <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
                                    <input type="checkbox" checked={draft.allDay} onChange={ev => setDraft({ ...draft, allDay: ev.target.checked })} className="accent-sky-500" />
                                    全天
                                </label>
                            </div>
                            {!draft.allDay && (
                                <input
                                    type="time"
                                    aria-label="时间"
                                    value={draft.time}
                                    onChange={ev => setDraft({ ...draft, time: ev.target.value })}
                                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-sm outline-none focus:border-sky-300"
                                />
                            )}
                        </div>
                        <label className="block">
                            <span className="text-[11px] text-slate-500 font-medium mb-1 block">备注（可选，角色也能看到）</span>
                            <textarea
                                value={draft.note}
                                onChange={ev => setDraft({ ...draft, note: ev.target.value })}
                                rows={3}
                                maxLength={300}
                                placeholder="地点、要带的东西、心情…"
                                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-sm outline-none focus:border-sky-300 resize-none"
                            />
                        </label>
                    </div>
                )}
            </Modal>
        </div>
    );
};

export default UserCalendarApp;
