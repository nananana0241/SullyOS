import { describe, expect, it, vi, beforeEach } from 'vitest';
import { hasImageTags, splitImageTags, stripImageTags, downloadImageToRef } from './characterImage';
import { ChatParser } from './chatParser';
import { sanitizeForBubble } from './sanitize';

describe('characterImage / sanitize survival', () => {
    // 回归：曾经把 [[IMAGE:]] / [[DRAW:]] 加进 stripBusinessTagsForBubble，结果标签在
    // applyAssistantPostProcessing 解析之前就被洗掉了——角色写了标签，气泡里什么都没发生。
    // 气泡清洗必须放行这两个标签，只有通知路径（终态、没有下游）才剥。
    it('keeps image tags through bubble sanitize', () => {
        const raw = '好看吗\n[[DRAW: 一只猫]]\n[[IMAGE: https://example.com/a.jpg]]';
        const sanitized = sanitizeForBubble(raw, { keepCitations: true });
        expect(sanitized).toContain('[[DRAW: 一只猫]]');
        expect(sanitized).toContain('[[IMAGE: https://example.com/a.jpg]]');
    });

    it('still splits them out after the chat parser sees them', () => {
        const raw = '好看吗\n[[DRAW: 一只猫]]';
        const cleaned = ChatParser.sanitize(raw, { keepCitations: true });
        const parts = splitImageTags(cleaned);
        expect(parts.some(p => p.type === 'draw' && p.content === '一只猫')).toBe(true);
    });
});

describe('characterImage / splitImageTags', () => {
    it('splits text and image tags in model order', () => {
        const parts = splitImageTags(
            '给你看\n[[IMAGE: https://example.com/a.jpg]]\n很好看吧',
        );
        expect(parts).toEqual([
            { type: 'text', content: '给你看' },
            { type: 'image', content: 'https://example.com/a.jpg' },
            { type: 'text', content: '很好看吧' },
        ]);
    });

    it('keeps draw tags and accepts full-width colons', () => {
        const parts = splitImageTags('[[DRAW：一只猫]]');
        expect(parts).toEqual([{ type: 'draw', content: '一只猫' }]);
    });

    it('drops non-http image values without leaking text', () => {
        expect(splitImageTags('[[IMAGE: blobref:b_123]]')).toEqual([]);
        expect(splitImageTags('[[IMAGE: javascript:alert(1)]]')).toEqual([]);
        expect(splitImageTags('[[IMAGE: 看这个]]')).toEqual([]);
    });

    it('unwraps markdown-wrapped urls', () => {
        const parts = splitImageTags('[[IMAGE: [图](https://example.com/b.png)]]');
        expect(parts).toEqual([{ type: 'image', content: 'https://example.com/b.png' }]);
    });

    it('caps absurdly long draw prompts', () => {
        const parts = splitImageTags(`[[DRAW: ${'a'.repeat(5000)}]]`);
        expect(parts[0].type).toBe('draw');
        expect((parts[0] as any).content.length).toBe(800);
    });

    it('reports and strips tags', () => {
        expect(hasImageTags('[[IMAGE: https://a.b/c.png]]')).toBe(true);
        expect(hasImageTags('普通聊天')).toBe(false);
        expect(stripImageTags('好看[[IMAGE: https://a.b/c.png]]吗')).toBe('好看吗');
    });
});

describe('characterImage / downloadImageToRef', () => {
    beforeEach(() => { vi.restoreAllMocks(); });

    it('returns an error instead of throwing when the format is wrong', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(new Response('<html>blocked</html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
        }));
        const result = await downloadImageToRef('https://example.com/x.jpg', fetchImpl as any);
        expect('error' in result).toBe(true);
    });

    it('returns an error on HTTP failure', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 404 }));
        const result = await downloadImageToRef('https://example.com/missing.jpg', fetchImpl as any);
        expect('error' in result && result.error).toContain('404');
    });

    it('rejects oversized images', async () => {
        const big = new Uint8Array(13 * 1024 * 1024);
        const fetchImpl = vi.fn().mockImplementation(async () => new Response(big, {
            status: 200,
            headers: { 'content-type': 'image/jpeg' },
        }));
        const result = await downloadImageToRef('https://example.com/big.jpg', fetchImpl as any);
        expect('error' in result && result.error).toContain('太大');
    });
});
