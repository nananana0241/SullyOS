import { describe, expect, it } from 'vitest';
import type { ImageGenApiConfig } from '../types';
import {
    DEFAULT_NOVELAI_CONFIG,
    NOVELAI_OFFICIAL_BASE,
    buildNovelAiRequest,
    createNovelAiVibeRef,
    isCuratedNovelAiModel,
    isNovelAiConfigReady,
    normalizeNovelAiConfig,
} from './novelaiImage';

const makeConfig = (overrides: Partial<ImageGenApiConfig> = {}, novelai = {}): ImageGenApiConfig => ({
    enabled: true,
    baseUrl: '',
    apiKey: 'pst-token',
    model: 'nai-diffusion-4-5-full',
    provider: 'novelai',
    ...overrides,
    novelai: normalizeNovelAiConfig({ ...DEFAULT_NOVELAI_CONFIG, ...novelai }),
});

describe('novelaiImage / config normalization', () => {
    // 老的 apiConfig 里没有 novelai 字段；界面和请求体都要能拿到完整一套默认值。
    it('fills defaults for a missing config', () => {
        const normalized = normalizeNovelAiConfig(undefined);
        expect(normalized.steps).toBe(28);
        expect(normalized.scale).toBe(5);
        expect(normalized.sampler).toBe('k_euler_ancestral');
        expect(normalized.vibeRefs).toEqual([]);
    });

    // 手输的数字可能越界（比如步数填 999），越界就钳回合法区间，别让接口 400。
    it('clamps out-of-range numbers', () => {
        const normalized = normalizeNovelAiConfig({ steps: 999, scale: -3, ucPreset: 9, cfgRescale: 5 });
        expect(normalized.steps).toBe(50);
        expect(normalized.scale).toBe(1);
        expect(normalized.ucPreset).toBe(3);
        expect(normalized.cfgRescale).toBe(1);
    });

    // 未知的 rolePromptMode / connection 落回安全默认，而不是把字符串透传到请求体。
    it('falls back to safe enums', () => {
        const normalized = normalizeNovelAiConfig({ connection: 'oops' as any, rolePromptMode: 'x' as any });
        expect(normalized.connection).toBe('official');
        expect(normalized.rolePromptMode).toBe('auto');
    });

    // 官方直连不需要填 URL——这正是「直接填 NovelAI 配置填不进去」的原因之一。
    it('treats official connection as ready without a URL', () => {
        expect(isNovelAiConfigReady(makeConfig())).toBe(true);
        expect(isNovelAiConfigReady(makeConfig({ apiKey: '' }))).toBe(false);
    });
});

describe('novelaiImage / request body', () => {
    it('posts to the official endpoint when no custom base is set', () => {
        const { url, body } = buildNovelAiRequest('1girl, smiling', makeConfig());
        expect(url).toBe(`${NOVELAI_OFFICIAL_BASE}/ai/generate-image`);
        expect(body.action).toBe('generate');
        expect(body.model).toBe('nai-diffusion-4-5-full');
    });

    it('maps the generation settings onto parameters', () => {
        const { body } = buildNovelAiRequest('1girl', makeConfig({}, { steps: 30, scale: 6, sampler: 'k_dpmpp_2m', ucPreset: 2 }));
        const parameters = body.parameters as Record<string, unknown>;
        expect(parameters.steps).toBe(30);
        expect(parameters.scale).toBe(6);
        expect(parameters.sampler).toBe('k_dpmpp_2m');
        expect(parameters.ucPreset).toBe(2);
        expect(parameters.width).toBe(1024);
        expect(parameters.height).toBe(1024);
    });

    // 分角色：角色外观必须进 char_captions，不能混进 base_caption，否则 NAI 会把
    // 两个人物的特征揉到一起（截图里说的"角色外观会整段丢失"的反面）。
    it('sends character appearance as char_captions in separate mode', () => {
        const config = makeConfig({}, { rolePromptMode: 'separate' });
        const { body } = buildNovelAiRequest('1girl, sitting by the window', config, {
            appearance: '1girl, silver hair, red eyes',
        });
        const parameters = body.parameters as any;
        expect(parameters.v4_prompt.caption.char_captions).toHaveLength(1);
        expect(parameters.v4_prompt.caption.char_captions[0].char_caption).toContain('silver hair');
        expect(parameters.v4_prompt.caption.base_caption).not.toContain('silver hair');
        expect(parameters.v4_prompt.use_coords).toBe(true);
    });

    // 合并模式（ComfyUI 等端点不认 v4_prompt）：外观回到主提示词，且不再发 v4_prompt。
    it('merges appearance into the main prompt in merged mode', () => {
        const config = makeConfig({}, { rolePromptMode: 'merged' });
        const { body } = buildNovelAiRequest('1girl, sitting', config, { appearance: 'silver hair, red eyes' });
        const parameters = body.parameters as any;
        expect(parameters.v4_prompt).toBeUndefined();
        expect(String(body.input)).toContain('silver hair');
        expect(String(body.input)).toContain('1girl, sitting');
    });

    // auto 模式：官方端点用分角色，自定义端点自动合并——这就是截图里那三个选项的意义。
    it('auto mode follows the connection type', () => {
        const official = buildNovelAiRequest('1girl', makeConfig({}, { rolePromptMode: 'auto' }), { appearance: 'red eyes' });
        expect((official.body.parameters as any).v4_prompt).toBeDefined();

        const custom = buildNovelAiRequest('1girl', makeConfig({ baseUrl: 'https://nai-proxy.example.com' }, {
            rolePromptMode: 'auto',
            connection: 'custom',
        }), { appearance: 'red eyes' });
        expect((custom.body.parameters as any).v4_prompt).toBeUndefined();
        expect(custom.url).toBe('https://nai-proxy.example.com/ai/generate-image');
    });

    // 画风参考：多个参考用复数数组，强度与信息提取一一对应。
    it('attaches vibe references when enabled', () => {
        const ref = createNovelAiVibeRef({ name: 'a.png', data: 'AAAA', strength: 0.4, informationExtracted: 0.8 });
        const { body } = buildNovelAiRequest('1girl', makeConfig({}, { vibeEnabled: true, vibeRefs: [ref] }));
        const parameters = body.parameters as any;
        expect(parameters.reference_image_multiple).toEqual(['AAAA']);
        expect(parameters.reference_strength_multiple).toEqual([0.4]);
        expect(parameters.reference_information_extracted_multiple).toEqual([0.8]);
    });

    it('drops vibe references when the switch is off', () => {
        const ref = createNovelAiVibeRef({ name: 'a.png', data: 'AAAA' });
        const { body } = buildNovelAiRequest('1girl', makeConfig({}, { vibeEnabled: false, vibeRefs: [ref] }));
        expect((body.parameters as any).reference_image_multiple).toBeUndefined();
    });

    // 显式尺寸（竖图话题）要盖过设定里的默认尺寸。
    it('lets an explicit aspect ratio win over the preset size', () => {
        const { body } = buildNovelAiRequest('1girl', makeConfig(), { size: '832x1216' });
        const parameters = body.parameters as any;
        expect(parameters.width).toBe(832);
        expect(parameters.height).toBe(1216);
    });

    // -1 是"随机"，但请求体里必须是具体数字，否则官方会把 -1 当固定种子。
    it('resolves a random seed before sending', () => {
        const { body } = buildNovelAiRequest('1girl', makeConfig({}, { seed: -1 }));
        const seed = (body.parameters as any).seed;
        expect(typeof seed).toBe('number');
        expect(seed).toBeGreaterThanOrEqual(0);
    });

    // 固定种子必须原样透传，否则"复现同一张图"这个功能就是假的。
    it('keeps a fixed seed', () => {
        const { body } = buildNovelAiRequest('1girl', makeConfig({}, { seed: 123456 }));
        expect((body.parameters as any).seed).toBe(123456);
    });
});

describe('novelaiImage / rating tag', () => {
    // 官方文档：V4.5 Curated 的 Quality Tags 会在提示词末尾追加 rating:general。
    // 用户选了 Curated 又想要成年内容时，唯一的办法是关掉 Quality Tags。
    // 这条断言的是"我们确实把 rating 写进了正面提示词"，而不是悄悄丢掉。
    it('appends the chosen rating to the positive prompt', () => {
        const { body } = buildNovelAiRequest('1girl, portrait', makeConfig({}, { rating: 'rating:explicit' }));
        expect(String(body.input)).toContain('rating:explicit');
    });

    // 空串 = 不加，别往提示词里塞一个空的 rating。
    it('adds nothing when rating is empty', () => {
        const { body } = buildNovelAiRequest('1girl', makeConfig({}, { rating: '' }));
        expect(String(body.input)).not.toContain('rating:');
    });

    // 手输/历史配置里可能混进别的字符串，只放行白名单里的四个评级。
    it('rejects unknown rating values', () => {
        const normalized = normalizeNovelAiConfig({ rating: 'nonsense' });
        expect(normalized.rating).toBe('');
    });

    // Curated 和 Full 的差别是用户踩过的最大的坑，模型名判定必须准。
    it('detects curated models', () => {
        expect(isCuratedNovelAiModel('nai-diffusion-4-5-curated')).toBe(true);
        expect(isCuratedNovelAiModel('nai-diffusion-4-5-full')).toBe(false);
    });
});
