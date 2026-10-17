import { describe, expect, it } from 'vitest';
import {
    classesOnDate,
    parseUserTimetable,
    renderUserTimetableContext,
    sortTimetable,
    type TimetableClass,
} from './userTimetable';

const cls = (id: string, weekday: number, start: string, extra: Partial<TimetableClass> = {}): TimetableClass => ({
    id, name: `课${id}`, weekday, start, createdAt: 1, ...extra,
});

describe('userTimetable', () => {
    it('drops malformed rows and keeps free-form times', () => {
        const parsed = parseUserTimetable(JSON.stringify([
            cls('ok', 1, '08:05', { end: '09:40', location: '  教三 201 ' }),
            { id: 'noname', name: '', weekday: 1, start: '08:00' },
            { id: 'badday', name: 'x', weekday: 7, start: '08:00' },
            { id: 'badtime', name: 'x', weekday: 2, start: '8:00' },
            cls('badend', 3, '19:00', { end: '99:99' }),
        ]));
        expect(parsed.map(c => c.id)).toEqual(['ok', 'badend']);
        expect(parsed[0]).toMatchObject({ start: '08:05', end: '09:40', location: '教三 201' });
        expect(parsed[1].end).toBeUndefined();
        expect(parseUserTimetable('{')).toEqual([]);
    });

    it('sorts Monday first and Sunday last', () => {
        const sorted = sortTimetable([cls('sun', 0, '09:00'), cls('mon2', 1, '14:00'), cls('mon1', 1, '08:00'), cls('sat', 6, '10:00')]);
        expect(sorted.map(c => c.id)).toEqual(['mon1', 'mon2', 'sat', 'sun']);
    });

    it('matches classes by weekday of a date', () => {
        // 2026-10-19 is a Monday
        expect(classesOnDate([cls('a', 1, '08:00'), cls('b', 2, '08:00')], '2026-10-19').map(c => c.id)).toEqual(['a']);
    });

    it('renders today and tomorrow with location', () => {
        const classes = [
            cls('1', 1, '08:00', { end: '09:40', name: '高数', location: '教三 201', teacher: '王老师' }),
        ];
        // 2026-10-18 is Sunday → today none, tomorrow (Mon) 高数
        const text = renderUserTimetableContext(classes, '2026-10-18', '小明');
        expect(text).toContain('今天（周日）：没有课');
        expect(text).toContain('明天（周一）：');
        expect(text).toContain('08:00-09:40 高数（地点：教三 201，老师：王老师）');
    });

    it('renders the full week without relative labels for pre-packed prompts', () => {
        const text = renderUserTimetableContext([cls('1', 3, '19:00', { name: '吉他' })], '2026-10-18', '小明', false);
        expect(text).toContain('周三 19:00 吉他');
        expect(text).not.toContain('今天');
    });

    it('renders nothing for an empty timetable', () => {
        expect(renderUserTimetableContext([], '2026-10-18', '小明')).toBe('');
    });
});
