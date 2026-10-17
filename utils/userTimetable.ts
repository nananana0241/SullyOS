import { DB } from './db';
import { addLocalDays, getLocalDateKey, parseLocalDateKey } from './localDate';

/**
 * 用户课表（日历 App 的「课表」页）。每周重复，时间自由填写（不套固定节次）。
 * 和 userCalendar 一样存在 assets 表的一条 JSON 里，跟随 ZIP 备份，不升 DB_VERSION。
 */

export interface TimetableClass {
    id: string;
    name: string;
    /** 0 = 周日 … 6 = 周六，与 Date.getDay() 一致 */
    weekday: number;
    /** HH:mm */
    start: string;
    /** HH:mm，可不填 */
    end?: string;
    location?: string;
    teacher?: string;
    note?: string;
    createdAt: number;
}

export const USER_TIMETABLE_ASSET_KEY = 'user_timetable_v1';
const TIMETABLE_CONTEXT_MAX = 30;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const optText = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

function normalizeClass(raw: any): TimetableClass | null {
    if (!raw || typeof raw !== 'object') return null;
    const name = optText(raw.name);
    if (!name || typeof raw.id !== 'string') return null;
    if (!Number.isInteger(raw.weekday) || raw.weekday < 0 || raw.weekday > 6) return null;
    if (typeof raw.start !== 'string' || !TIME_RE.test(raw.start)) return null;
    const item: TimetableClass = {
        id: raw.id,
        name,
        weekday: raw.weekday,
        start: raw.start,
        createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0,
    };
    if (typeof raw.end === 'string' && TIME_RE.test(raw.end)) item.end = raw.end;
    const location = optText(raw.location);
    const teacher = optText(raw.teacher);
    const note = optText(raw.note);
    if (location) item.location = location;
    if (teacher) item.teacher = teacher;
    if (note) item.note = note;
    return item;
}

export function parseUserTimetable(json: string | null | undefined): TimetableClass[] {
    if (!json) return [];
    try {
        const raw = JSON.parse(json);
        if (!Array.isArray(raw)) return [];
        return raw.map(normalizeClass).filter((c): c is TimetableClass => !!c);
    } catch {
        return [];
    }
}

/** 周一排在最前（课表习惯），同一天按开始时间。 */
export function sortTimetable(classes: TimetableClass[]): TimetableClass[] {
    const order = (d: number) => (d + 6) % 7;
    return [...classes].sort((a, b) =>
        order(a.weekday) - order(b.weekday)
        || a.start.localeCompare(b.start)
        || a.createdAt - b.createdAt);
}

export function classesOnDate(classes: TimetableClass[], dateKey: string): TimetableClass[] {
    const d = parseLocalDateKey(dateKey);
    if (!d) return [];
    return sortTimetable(classes.filter(c => c.weekday === d.getDay()));
}

export async function loadUserTimetable(): Promise<TimetableClass[]> {
    try {
        return sortTimetable(parseUserTimetable(await DB.getAsset(USER_TIMETABLE_ASSET_KEY)));
    } catch {
        return [];
    }
}

export async function saveUserTimetable(classes: TimetableClass[]): Promise<void> {
    await DB.saveAsset(USER_TIMETABLE_ASSET_KEY, JSON.stringify(sortTimetable(classes)));
}

export function formatClassTime(c: TimetableClass): string {
    return c.end ? `${c.start}-${c.end}` : c.start;
}

function classLine(c: TimetableClass): string {
    const extra = [c.location && `地点：${c.location}`, c.teacher && `老师：${c.teacher}`, c.note && `备注：${c.note}`]
        .filter(Boolean).join('，');
    return `${formatClassTime(c)} ${c.name}${extra ? `（${extra}）` : ''}`;
}

/**
 * 渲染成提示词。
 * includeRelative=true：只给今天、明天两天的课（最相关、最省 token）。
 * includeRelative=false（云端预打包）：「今天」可能过期，改给整周课表，按星期写。
 */
export function renderUserTimetableContext(
    classes: TimetableClass[],
    todayKey: string,
    userName: string,
    includeRelative = true,
): string {
    if (!classes.length) return '';
    const head = `- ${userName} 的课表（每周重复，时间按${userName}本地时间）：\n`;
    const tail = `  （你知道${userName}的上课安排。可以在合适的时候自然地提到，比如快上课了、刚下课、课多的日子；不要编造课表里没有的课。）\n\n`;

    if (!includeRelative) {
        const lines = sortTimetable(classes).slice(0, TIMETABLE_CONTEXT_MAX)
            .map(c => `  - ${WEEKDAY_NAMES[c.weekday]} ${classLine(c)}`);
        return head + lines.join('\n') + '\n' + tail;
    }

    const days: Array<[string, string]> = [['今天', todayKey], ['明天', addLocalDays(todayKey, 1)]];
    const blocks = days.map(([label, key]) => {
        const d = parseLocalDateKey(key);
        if (!d) return '';
        const list = classesOnDate(classes, key);
        const title = `  - ${label}（${WEEKDAY_NAMES[d.getDay()]}）：`;
        return list.length
            ? `${title}\n${list.map(c => `    - ${classLine(c)}`).join('\n')}`
            : `${title}没有课`;
    }).filter(Boolean);
    return head + blocks.join('\n') + '\n' + tail;
}

/** ContextBuilder 用：读库 + 渲染。读失败返回空串，绝不阻断请求。 */
export async function getUserTimetableContext(userName: string, includeRelative = true, now: Date = new Date()): Promise<string> {
    return renderUserTimetableContext(await loadUserTimetable(), getLocalDateKey(now), userName, includeRelative);
}
