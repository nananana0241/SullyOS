import { DB } from './db';
import { addLocalDays, getCalendarDayDifference, getLocalDateKey, parseLocalDateKey } from './localDate';

/**
 * 用户自己的日历（「日历」App）。
 * 和角色作息（dailySchedule）无关：这里存的是用户现实生活里的安排，
 * 由 ContextBuilder 注入到「互动对象 (User)」段，让角色知道用户最近要干什么。
 *
 * 存在 assets 表的一条 JSON 里，不新开 IndexedDB 表：免升 DB_VERSION，
 * 也自动跟着「备份与恢复」走（assets 整表导出/导入）。
 * 日期一律按用户设备的本地日期（不是角色时区），见 docs/character-timezone.md。
 */

export interface UserCalendarEvent {
    id: string;
    title: string;
    /** YYYY-MM-DD，用户本地日期 */
    date: string;
    /** HH:mm，不填 = 全天 */
    time?: string;
    note?: string;
    createdAt: number;
}

export const USER_CALENDAR_ASSET_KEY = 'user_calendar_events_v1';

/** 注入窗口：昨天（方便角色问「昨天的面试怎么样」）到往后 7 天。 */
export const CALENDAR_CONTEXT_PAST_DAYS = 1;
export const CALENDAR_CONTEXT_FUTURE_DAYS = 7;
const CALENDAR_CONTEXT_MAX_EVENTS = 20;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function normalizeEvent(raw: any): UserCalendarEvent | null {
    if (!raw || typeof raw !== 'object') return null;
    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    if (!title || typeof raw.id !== 'string' || typeof raw.date !== 'string' || !parseLocalDateKey(raw.date)) return null;
    const event: UserCalendarEvent = {
        id: raw.id,
        title,
        date: raw.date,
        createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0,
    };
    if (typeof raw.time === 'string' && TIME_RE.test(raw.time)) event.time = raw.time;
    if (typeof raw.note === 'string' && raw.note.trim()) event.note = raw.note.trim();
    return event;
}

/** 解析存储内容；坏数据逐条丢弃，不让一条脏记录拖垮整个日历。 */
export function parseUserCalendar(json: string | null | undefined): UserCalendarEvent[] {
    if (!json) return [];
    try {
        const raw = JSON.parse(json);
        if (!Array.isArray(raw)) return [];
        return raw.map(normalizeEvent).filter((e): e is UserCalendarEvent => !!e);
    } catch {
        return [];
    }
}

/** 按日期、时间排序；全天日程排在当天最前。 */
export function sortCalendarEvents(events: UserCalendarEvent[]): UserCalendarEvent[] {
    return [...events].sort((a, b) =>
        a.date.localeCompare(b.date)
        || (a.time || '').localeCompare(b.time || '')
        || a.createdAt - b.createdAt);
}

export async function loadUserCalendar(): Promise<UserCalendarEvent[]> {
    try {
        return sortCalendarEvents(parseUserCalendar(await DB.getAsset(USER_CALENDAR_ASSET_KEY)));
    } catch {
        return [];
    }
}

export async function saveUserCalendar(events: UserCalendarEvent[]): Promise<void> {
    await DB.saveAsset(USER_CALENDAR_ASSET_KEY, JSON.stringify(sortCalendarEvents(events)));
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function relativeDayLabel(diff: number): string {
    if (diff === -1) return '昨天';
    if (diff === 0) return '今天';
    if (diff === 1) return '明天';
    if (diff === 2) return '后天';
    return `${diff}天后`;
}

/** 选出注入窗口内的日程（纯函数，便于测试）。 */
export function selectContextEvents(events: UserCalendarEvent[], todayKey: string): UserCalendarEvent[] {
    const from = addLocalDays(todayKey, -CALENDAR_CONTEXT_PAST_DAYS);
    const to = addLocalDays(todayKey, CALENDAR_CONTEXT_FUTURE_DAYS);
    if (!from || !to) return [];
    return sortCalendarEvents(events.filter(e => e.date >= from && e.date <= to)).slice(0, CALENDAR_CONTEXT_MAX_EVENTS);
}

/**
 * 渲染成提示词。
 * includeRelative=false 时只写绝对日期：云端 fire-pack 会提前打包，「明天」到执行时可能已过期。
 */
export function renderUserCalendarContext(
    events: UserCalendarEvent[],
    todayKey: string,
    userName: string,
    includeRelative = true,
): string {
    const picked = selectContextEvents(events, todayKey);
    if (!picked.length) return '';
    const lines = picked.map(e => {
        const d = parseLocalDateKey(e.date);
        const weekday = d ? WEEKDAYS[d.getDay()] : '';
        const diff = getCalendarDayDifference(todayKey, e.date);
        const rel = includeRelative && diff !== null ? `${relativeDayLabel(diff)} ` : '';
        const when = `${rel}${e.date} ${weekday} ${e.time || '全天'}`.replace(/\s+/g, ' ').trim();
        const note = e.note ? `（备注：${e.note}）` : '';
        return `  - ${when}：${e.title}${note}`;
    });
    return `- ${userName} 日历里最近的安排（${userName}自己记的，日期按${userName}本地时间）：\n${lines.join('\n')}\n`
        + `  （你知道这些安排。可以在合适的时候自然地关心、提醒或事后问问结果，不要每句话都提，也不要编造日历里没有的安排。）\n\n`;
}

/** ContextBuilder 用：读库 + 渲染。读失败返回空串，绝不阻断请求。 */
export async function getUserCalendarContext(userName: string, includeRelative = true, now: Date = new Date()): Promise<string> {
    const events = await loadUserCalendar();
    return renderUserCalendarContext(events, getLocalDateKey(now), userName, includeRelative);
}
