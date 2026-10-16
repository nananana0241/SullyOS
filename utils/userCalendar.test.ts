import { describe, expect, it } from 'vitest';
import {
    parseUserCalendar,
    renderUserCalendarContext,
    selectContextEvents,
    sortCalendarEvents,
    type UserCalendarEvent,
} from './userCalendar';

const ev = (id: string, date: string, extra: Partial<UserCalendarEvent> = {}): UserCalendarEvent => ({
    id, date, title: `事件${id}`, createdAt: 1, ...extra,
});

describe('userCalendar', () => {
    it('drops malformed rows instead of failing the whole calendar', () => {
        const json = JSON.stringify([
            ev('a', '2026-10-17', { time: '09:30' }),
            { id: 'b', title: '', date: '2026-10-17' },
            { id: 'c', title: '坏日期', date: '2026-13-40' },
            { id: 'd', title: '坏时间', date: '2026-10-18', time: '25:00' },
        ]);
        const parsed = parseUserCalendar(json);
        expect(parsed.map(e => e.id)).toEqual(['a', 'd']);
        expect(parsed[1].time).toBeUndefined();
        expect(parseUserCalendar('not json')).toEqual([]);
        expect(parseUserCalendar(null)).toEqual([]);
    });

    it('sorts all-day events before timed ones on the same day', () => {
        const sorted = sortCalendarEvents([
            ev('late', '2026-10-17', { time: '20:00' }),
            ev('next', '2026-10-18'),
            ev('allday', '2026-10-17'),
            ev('early', '2026-10-17', { time: '08:00' }),
        ]);
        expect(sorted.map(e => e.id)).toEqual(['allday', 'early', 'late', 'next']);
    });

    it('selects yesterday through 7 days ahead, across month boundaries', () => {
        const picked = selectContextEvents([
            ev('old', '2026-10-29'),
            ev('yesterday', '2026-10-30'),
            ev('today', '2026-10-31'),
            ev('week', '2026-11-07'),
            ev('far', '2026-11-08'),
        ], '2026-10-31');
        expect(picked.map(e => e.id)).toEqual(['yesterday', 'today', 'week']);
    });

    it('renders relative labels only when requested', () => {
        const events = [ev('1', '2026-10-18', { title: '面试', time: '14:00', note: '带简历' })];
        const live = renderUserCalendarContext(events, '2026-10-17', '小明');
        expect(live).toContain('明天 2026-10-18 周日 14:00：面试（备注：带简历）');
        expect(live).toContain('小明 日历里最近的安排');

        const packed = renderUserCalendarContext(events, '2026-10-17', '小明', false);
        expect(packed).toContain('2026-10-18 周日 14:00：面试');
        expect(packed).not.toContain('明天');
    });

    it('renders nothing when the window is empty', () => {
        expect(renderUserCalendarContext([ev('x', '2027-01-01')], '2026-10-17', '小明')).toBe('');
    });
});
