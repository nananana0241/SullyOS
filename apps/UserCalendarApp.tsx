import React, { useEffect, useMemo, useState } from 'react';
import { CaretLeft, CaretRight, Plus, Trash, Clock, ArrowCounterClockwise, MapPin, GraduationCap } from '@phosphor-icons/react';
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
import {
    loadUserTimetable,
    saveUserTimetable,
    sortTimetable,
    classesOnDate,
    formatClassTime,
    WEEKDAY_NAMES,
    type TimetableClass,
} from '../utils/userTimetable';

/**
 * 日历 — 用户自己的日程本 + 每周课表。
 * 数据见 utils/userCalendar.ts、utils/userTimetable.ts；都会由 ContextBuilder 注入给角色。
 */

type ClassDraft = {
    id?: string; name: string; weekday: number; start: string; end: string;
    location: string; teacher: string; note: string;
};

const emptyClassDraft = (weekday: number): ClassDraft => ({
    name: '', weekday, start: '08:00', end: '', location: '', teacher: '', note: '',
});

/** 课表页按周一 → 周日分组 */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

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
    const [tab, setTab] = useState<'calendar' | 'timetable'>('calendar');
    const [classes, setClasses] = useState<TimetableClass[]>([]);
    const [classDraft, setClassDraft] = useState<ClassDraft | null>(null);

    useEffect(() => {
        Promise.all([loadUserCalendar(), loadUserTimetable()]).then(([list, tt]) => {
            setEvents(list);
            setClasses(tt);
            setLoaded(true);
        });
    }, []);

    const persistClasses = async (next: TimetableClass[]) => {
        const sorted = sortTimetable(next);
        setClasses(sorted);
        try {
            await saveUserTimetable(sorted);
        } catch {
            addToast('保存失败，可能是存储空间不足', 'error');
        }
    };

    const openClassEdit = (c: TimetableClass) => setClassDraft({
        id: c.id, name: c.name, weekday: c.weekday, start: c.start, end: c.end || '',
        location: c.location || '', teacher: c.teacher || '', note: c.note || '',
    });

    const submitClass = async () => {
        if (!classDraft) return;
        const name = classDraft.name.trim();
        if (!name) { addToast('写一下课程名吧', 'info'); return; }
        const start = classDraft.start.slice(0, 5);
        const end = classDraft.end.slice(0, 5);
        if (!start) { addToast('填一下开始时间', 'info'); return; }
        if (end && end <= start) { addToast('结束时间要晚于开始时间', 'info'); return; }
        const existing = classDraft.id ? classes.find(c => c.id === classDraft.id) : undefined;
        const item: TimetableClass = {
            id: classDraft.id || `cls_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name,
            weekday: classDraft.weekday,
            start,
            createdAt: existing?.createdAt ?? Date.now(),
            ...(end ? { end } : {}),
            ...(classDraft.location.trim() ? { location: classDraft.location.trim() } : {}),
            ...(classDraft.teacher.trim() ? { teacher: classDraft.teacher.trim() } : {}),
            ...(classDraft.note.trim() ? { note: classDraft.note.trim() } : {}),
        };
        await persistClasses([...classes.filter(c => c.id !== item.id), item]);
        setClassDraft(null);
        addToast(existing ? '已更新' : '已加入课表', 'success');
    };

    const removeClass = async () => {
        if (!classDraft?.id) return;
        await persistClasses(classes.filter(c => c.id !== classDraft.id));
        setClassDraft(null);
        addToast('已删除', 'info');
    };

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
    const dayClasses = useMemo(() => classesOnDate(classes, selected), [classes, selected]);
    const classWeekdays = useMemo(() => new Set(classes.map(c => c.weekday)), [classes]);

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
                    <div role="tablist" className="flex gap-1 p-1 rounded-full bg-white/70 border border-white shadow-sm">
                        {([['calendar', '日历'], ['timetable', '课表']] as const).map(([id, label]) => (
                            <button
                                key={id}
                                role="tab"
                                aria-selected={tab === id}
                                onClick={() => setTab(id)}
                                className={`px-4 py-1 rounded-full text-sm font-bold transition-colors ${tab === id ? 'bg-sky-500 text-white shadow-sm' : 'text-slate-400'}`}
                            >{label}</button>
                        ))}
                    </div>
                    <button
                        onClick={() => tab === 'calendar'
                            ? setDraft(emptyDraft(selected))
                            : setClassDraft(emptyClassDraft(parseLocalDateKey(selected)?.getDay() ?? 1))}
                        aria-label={tab === 'calendar' ? '添加日程' : '添加课程'}
                        className="p-2 -mr-2 rounded-full active:scale-90 transition-transform hover:bg-black/5"
                    >
                        <Plus className="w-6 h-6 text-sky-500" weight="bold" />
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar px-4 space-y-4" style={{ paddingBottom: 'calc(var(--safe-bottom, 0px) + 1.5rem)' }}>
                {tab === 'calendar' && <>
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
                                        {inMonth && classWeekdays.has(parseLocalDateKey(key)?.getDay() ?? -1) && (
                                            <span className="w-1 h-1 rounded-full bg-indigo-300" />
                                        )}
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

                    {loaded && dayEvents.length === 0 && dayClasses.length === 0 && (
                        <button
                            onClick={() => setDraft(emptyDraft(selected))}
                            className="w-full py-8 border-2 border-dashed border-slate-200 rounded-2xl text-sm text-slate-400 active:scale-[0.98] transition-transform"
                        >
                            这天还没有安排，点这里添加
                        </button>
                    )}

                    <div className="space-y-2">
                        {dayClasses.map(c => (
                            <button
                                key={c.id}
                                onClick={() => openClassEdit(c)}
                                className="w-full text-left bg-indigo-50/80 backdrop-blur-xl rounded-2xl border border-white shadow-sm px-4 py-3 flex gap-3 active:scale-[0.98] transition-transform"
                            >
                                <div className="w-1 self-stretch rounded-full bg-indigo-400 shrink-0" />
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5 font-bold text-sm text-slate-700 break-words">
                                        <GraduationCap className="w-4 h-4 text-indigo-400 shrink-0" />{c.name}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-400 mt-0.5">
                                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatClassTime(c)}</span>
                                        {c.location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{c.location}</span>}
                                    </div>
                                </div>
                            </button>
                        ))}
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
                </>}

                {tab === 'timetable' && <>
                    {loaded && classes.length === 0 && (
                        <button
                            onClick={() => setClassDraft(emptyClassDraft(1))}
                            className="w-full py-10 border-2 border-dashed border-slate-200 rounded-2xl text-sm text-slate-400 active:scale-[0.98] transition-transform"
                        >
                            课表还是空的，点这里添加第一节课
                        </button>
                    )}

                    {WEEK_ORDER.map(wd => {
                        const list = classes.filter(c => c.weekday === wd);
                        if (!list.length) return null;
                        const isToday = parseLocalDateKey(today)?.getDay() === wd;
                        return (
                            <div key={wd}>
                                <div className="flex items-center justify-between px-1 mb-2">
                                    <h3 className={`text-sm font-bold ${isToday ? 'text-sky-500' : ''}`}>
                                        {WEEKDAY_NAMES[wd]}{isToday && <span className="ml-1.5 text-[10px] bg-sky-50 px-1.5 py-0.5 rounded-full">今天</span>}
                                    </h3>
                                    <button onClick={() => setClassDraft(emptyClassDraft(wd))} aria-label={`给${WEEKDAY_NAMES[wd]}添加课程`} className="p-1 rounded-full active:scale-90 hover:bg-black/5">
                                        <Plus className="w-4 h-4 text-slate-400" weight="bold" />
                                    </button>
                                </div>
                                <div className="space-y-2">
                                    {list.map(c => (
                                        <button
                                            key={c.id}
                                            onClick={() => openClassEdit(c)}
                                            className="w-full text-left bg-white/80 backdrop-blur-xl rounded-2xl border border-white shadow-sm px-4 py-3 flex gap-3 active:scale-[0.98] transition-transform"
                                        >
                                            <div className="w-14 shrink-0 text-xs font-bold text-indigo-500 leading-tight pt-0.5">
                                                <div>{c.start}</div>
                                                {c.end && <div className="text-slate-300 font-normal">{c.end}</div>}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="font-bold text-sm text-slate-700 break-words">{c.name}</div>
                                                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-400 mt-0.5">
                                                    {c.location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{c.location}</span>}
                                                    {c.teacher && <span>{c.teacher}</span>}
                                                </div>
                                                {c.note && <div className="text-xs text-slate-500 mt-1 whitespace-pre-wrap break-words">{c.note}</div>}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        );
                    })}

                    <p className="text-[11px] leading-relaxed text-slate-400 px-1">
                        课表每周重复，时间和地点都可以自由填写。角色聊天时会看到你今天和明天的课，日历里点某一天也能看到那天的课。
                    </p>
                </>}
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

            <Modal
                isOpen={!!classDraft}
                title={classDraft?.id ? '编辑课程' : '添加课程'}
                onClose={() => setClassDraft(null)}
                footer={classDraft && (
                    <>
                        {classDraft.id && (
                            <button onClick={removeClass} aria-label="删除课程" className="px-4 py-3 bg-rose-50 text-rose-500 rounded-2xl active:scale-95 transition-transform">
                                <Trash className="w-5 h-5" />
                            </button>
                        )}
                        <button onClick={() => setClassDraft(null)} className="flex-1 py-3 bg-slate-100 text-slate-500 font-bold rounded-2xl active:scale-95 transition-transform">取消</button>
                        <button onClick={submitClass} className="flex-1 py-3 bg-indigo-500 text-white font-bold rounded-2xl shadow-lg shadow-indigo-200 active:scale-95 transition-transform">保存</button>
                    </>
                )}
            >
                {classDraft && (
                    <div className="space-y-3">
                        <label className="block">
                            <span className="text-[11px] text-slate-500 font-medium mb-1 block">课程名</span>
                            <input
                                value={classDraft.name}
                                onChange={ev => setClassDraft({ ...classDraft, name: ev.target.value })}
                                placeholder="比如：高等数学"
                                maxLength={60}
                                autoFocus
                                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-sm outline-none focus:border-indigo-300"
                            />
                        </label>
                        <div>
                            <span className="text-[11px] text-slate-500 font-medium mb-1 block">星期几</span>
                            <div className="grid grid-cols-7 gap-1">
                                {WEEK_ORDER.map(wd => (
                                    <button
                                        key={wd}
                                        type="button"
                                        aria-pressed={classDraft.weekday === wd}
                                        onClick={() => setClassDraft({ ...classDraft, weekday: wd })}
                                        className={`py-2 rounded-lg text-xs font-bold transition-colors ${classDraft.weekday === wd ? 'bg-indigo-500 text-white' : 'bg-slate-50 text-slate-500'}`}
                                    >{WEEKDAY_NAMES[wd].slice(1)}</button>
                                ))}
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <label className="block">
                                <span className="text-[11px] text-slate-500 font-medium mb-1 block">开始</span>
                                <input
                                    type="time"
                                    value={classDraft.start}
                                    onChange={ev => setClassDraft({ ...classDraft, start: ev.target.value })}
                                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-sm outline-none focus:border-indigo-300"
                                />
                            </label>
                            <label className="block">
                                <span className="text-[11px] text-slate-500 font-medium mb-1 block">结束（可不填）</span>
                                <input
                                    type="time"
                                    value={classDraft.end}
                                    onChange={ev => setClassDraft({ ...classDraft, end: ev.target.value })}
                                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-sm outline-none focus:border-indigo-300"
                                />
                            </label>
                        </div>
                        <label className="block">
                            <span className="text-[11px] text-slate-500 font-medium mb-1 block">地点</span>
                            <input
                                value={classDraft.location}
                                onChange={ev => setClassDraft({ ...classDraft, location: ev.target.value })}
                                placeholder="比如：教三 201 / 线上"
                                maxLength={60}
                                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-sm outline-none focus:border-indigo-300"
                            />
                        </label>
                        <label className="block">
                            <span className="text-[11px] text-slate-500 font-medium mb-1 block">老师（可选）</span>
                            <input
                                value={classDraft.teacher}
                                onChange={ev => setClassDraft({ ...classDraft, teacher: ev.target.value })}
                                maxLength={30}
                                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-sm outline-none focus:border-indigo-300"
                            />
                        </label>
                        <label className="block">
                            <span className="text-[11px] text-slate-500 font-medium mb-1 block">备注（可选，角色也能看到）</span>
                            <textarea
                                value={classDraft.note}
                                onChange={ev => setClassDraft({ ...classDraft, note: ev.target.value })}
                                rows={2}
                                maxLength={200}
                                placeholder="单双周、要交作业…"
                                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-sm outline-none focus:border-indigo-300 resize-none"
                            />
                        </label>
                    </div>
                )}
            </Modal>
        </div>
    );
};

export default UserCalendarApp;
