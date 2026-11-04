import type { ImageGenApiConfig, NovelAiImageConfig, NovelAiVibeRef } from '../types';
import { safeFetchJson } from './safeApi';
import { putImageBlobDeduped, dataUrlToBlob } from './blobRef';

/**
 * NovelAI 官方生图（`POST /ai/generate-image`）。
 *
 * 跟 imageStudio 里那套 OpenAI 兼容中转是两条完全不同的协议：NAI 的参数在
 * `parameters` 子对象里，模型名是 `nai-diffusion-4-5-full` 这种，分角色提示词走
 * `v4_prompt.caption.char_captions`，返回默认是 zip（要求 `Accept: application/json`
 * 才是 base64 数组）。
 *
 * 官方端点的 CORS 是 `access-control-allow-origin: *`，浏览器能直连，不需要中转。
 *
 * 参数表以 https://image.novelai.net/docs/index.html 的 swagger 为准，本地留了一份
 * 需要的字段；界面上的中文名与这里导出的常量表一一对应。
 */

export const NOVELAI_OFFICIAL_BASE = 'https://image.novelai.net';

/** 官方支持的模型。用「拉取模型」拉不到 NAI 的图模型（它没有 /models），这里是内置表。 */
export const NOVELAI_MODELS: Array<{ id: string; label: string; hint: string }> = [
    { id: 'nai-diffusion-4-5-full', label: 'V4.5 Full — 完整版', hint: '全量训练集，成年内容要选这个' },
    { id: 'nai-diffusion-4-5-curated', label: 'V4.5 Curated — 精选版', hint: '训练集更干净，Quality Tags 会自动加 rating:general' },
    { id: 'nai-diffusion-4-full', label: 'V4 Full — 完整版', hint: '全量训练集' },
    { id: 'nai-diffusion-4-curated', label: 'V4 Curated — 精选版', hint: '训练集更干净，Quality Tags 会自动加 rating:general' },
    { id: 'nai-diffusion-3', label: 'V3 — 动漫', hint: '老模型' },
    { id: 'nai-diffusion-3-furry', label: 'V3 Furry — 兽人', hint: '老模型' },
];

/** 内容是 Curated（精选版）吗——它的 Quality Tags 会追加 rating:general。 */
export const isCuratedNovelAiModel = (modelId: string): boolean => /curated/i.test(modelId || '');

/** 采样器。k_euler_ancestral 是官方默认。 */
export const NOVELAI_SAMPLERS: Array<{ id: string; label: string }> = [
    { id: 'k_euler_ancestral', label: 'Euler Ancestral' },
    { id: 'k_euler', label: 'Euler' },
    { id: 'k_dpmpp_2s_ancestral', label: 'DPM++ 2S Ancestral' },
    { id: 'k_dpmpp_2m', label: 'DPM++ 2M' },
    { id: 'k_dpmpp_2m_sde', label: 'DPM++ 2M SDE' },
    { id: 'k_dpmpp_sde', label: 'DPM++ SDE' },
    { id: 'k_dpmpp_3m_sde', label: 'DPM++ 3M SDE' },
    { id: 'ddim', label: 'DDIM' },
];

export const NOVELAI_NOISE_SCHEDULES: Array<{ id: string; label: string }> = [
    { id: 'karras', label: 'Karras' },
    { id: 'native', label: 'Native' },
    { id: 'exponential', label: 'Exponential' },
    { id: 'polyexponential', label: 'Polyexponential' },
];

/** 负面提示词预设。0 最狠，2 不加负面词。 */
export const NOVELAI_UC_PRESETS: Array<{ id: number; label: string; hint?: string }> = [
    { id: 0, label: 'Preset 0 — Heavy（最狠）' },
    { id: 1, label: 'Preset 1 — Light（轻）' },
    { id: 2, label: 'Preset 2 — None（不加负面词）', hint: '不想被压内容时选这个' },
    { id: 3, label: 'Preset 3 — Furry（兽人向）' },
];

/**
 * 评级标签。V4/V4.5 用 danbooru 那套 rating，写进正面提示词才有效。
 *
 * 注意：Curated 模型的 Quality Tags 会自己在末尾追加 `rating:general`
 * （官方文档 Add Quality Tags 一节），所以选了 Curated 又开着 Quality Tags 时，
 * 这里给的 rating 会被前者的 general 顶掉——要出成年内容必须用 Full 模型。
 */
export const NOVELAI_RATINGS: Array<{ id: string; label: string; hint: string }> = [
    { id: '', label: '不加评级（默认）', hint: '模型自己判断' },
    { id: 'rating:general', label: '全年龄 (rating:general)', hint: '明确压制' },
    { id: 'rating:sensitive', label: '轻度 (rating:sensitive)', hint: '擦边' },
    { id: 'rating:questionable', label: '受限 (rating:questionable)', hint: '部分裸露' },
    { id: 'rating:explicit', label: '成人 (rating:explicit)', hint: '需要 Full 模型 + 负面向预设' },
];

/** 常用尺寸。NAI 要求边长是 64 的倍数。 */
export const NOVELAI_SIZES: Array<{ value: string; label: string }> = [
    { value: '832x1216', label: '竖图 832×1216（官方推荐）' },
    { value: '1216x832', label: '横图 1216×832（官方推荐）' },
    { value: '1024x1024', label: '方形 1024×1024' },
    { value: '832x1248', label: '竖图 832×1248' },
    { value: '1248x832', label: '横图 1248×832' },
    { value: '1472x1472', label: '大方形 1472×1472' },
];

export const DEFAULT_NOVELAI_CONFIG: NovelAiImageConfig = {
    connection: 'official',
    rolePromptMode: 'auto',
    width: 1024,
    height: 1024,
    steps: 28,
    scale: 5,
    sampler: 'k_euler_ancestral',
    noiseSchedule: 'karras',
    seed: -1,
    ucPreset: 0,
    cfgRescale: 0,
    ucStrength: 1,
    qualityTags: true,
    varietyBoost: false,
    dynamicThresholding: false,
    sm: false,
    smDyn: false,
    // 品质词交给 qualityToggle（官方开关）加，这里留空避免同一批 tag 被加两遍——
    // NAI 里重复 tag 会叠加权重，很容易把画面推过头。
    positivePreset: '',
    negativePreset: 'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, jpeg artifacts, signature, watermark, username, blurry',
    rating: '',
    vibeEnabled: false,
    vibeRefs: [],
};

/** 生图比对话慢很多，给足时间；超时就报错让角色如实说，不要吊着。 */
const NOVELAI_TIMEOUT_MS = 180_000;
const VIBE_ENCODE_TIMEOUT_MS = 60_000;

/** 合并老配置里可能缺的字段，保证界面和请求体都有值。 */
export function normalizeNovelAiConfig(partial?: Partial<NovelAiImageConfig> | null): NovelAiImageConfig {
    const merged: NovelAiImageConfig = { ...DEFAULT_NOVELAI_CONFIG, ...(partial || {}) };
    merged.width = clampInt(merged.width, 64, 2048, DEFAULT_NOVELAI_CONFIG.width);
    merged.height = clampInt(merged.height, 64, 2048, DEFAULT_NOVELAI_CONFIG.height);
    merged.steps = clampInt(merged.steps, 1, 50, DEFAULT_NOVELAI_CONFIG.steps);
    merged.scale = clampNum(merged.scale, 1, 10, DEFAULT_NOVELAI_CONFIG.scale);
    merged.seed = Number.isFinite(merged.seed) ? Math.trunc(merged.seed) : -1;
    merged.ucPreset = clampInt(merged.ucPreset, 0, 3, 0);
    merged.cfgRescale = clampNum(merged.cfgRescale, 0, 1, 0);
    merged.ucStrength = clampNum(merged.ucStrength, 0, 1, 1);
    merged.vibeRefs = Array.isArray(merged.vibeRefs) ? merged.vibeRefs : [];
    // 只认白名单里的评级，别让手输的乱七八糟字符串直接进提示词。
    merged.rating = NOVELAI_RATINGS.some(r => r.id === merged.rating) ? (merged.rating || '') : '';
    merged.connection = merged.connection === 'custom' ? 'custom' : 'official';
    merged.rolePromptMode = merged.rolePromptMode === 'separate' || merged.rolePromptMode === 'merged'
        ? merged.rolePromptMode
        : 'auto';
    return merged;
}

const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.trunc(n)));
};

const clampNum = (value: unknown, min: number, max: number, fallback: number): number => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
};

/** NovelAI 的鉴权是 `Bearer <Persistent Token>`，不是 sk- 开头的对话 Key。 */
export const isNovelAiConfigReady = (config?: ImageGenApiConfig | null): boolean =>
    !!config
    && config.provider === 'novelai'
    && !!config.apiKey?.trim()
    && !!config.model?.trim();

/** 官方直连还是自定义中转（挂 NAI 格式的第三方站）。 */
export function novelAiBaseUrl(config: ImageGenApiConfig): string {
    const novelai = normalizeNovelAiConfig(config.novelai);
    if (novelai.connection === 'custom') {
        return (config.baseUrl || '').trim().replace(/\/+$/, '');
    }
    return NOVELAI_OFFICIAL_BASE;
}

export type NovelAiDrawOptions = {
    /** 角色外观（正脸/服装等），分角色模式会单独绑进 char_captions。 */
    appearance?: string;
    /** 画面里还有谁，比如用户。分角色模式下作为第二个 character caption。 */
    partnerAppearance?: string;
    size?: string;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
};

export type NovelAiDrawResult = { ref: string; seed?: number } | { error: string };

/**
 * 拼 `/ai/generate-image` 的请求体。
 *
 * 单独导出来是为了能测：参数映射错了在界面上完全看不出来，只能靠断言。
 */
export function buildNovelAiRequest(
    prompt: string,
    config: ImageGenApiConfig,
    options: NovelAiDrawOptions = {},
): { url: string; body: Record<string, unknown> } {
    const novelai = normalizeNovelAiConfig(config.novelai);
    const base = novelAiBaseUrl(config);

    const cleanPrompt = (prompt || '').trim().slice(0, 1800);
    const appearance = (options.appearance || '').trim();
    const partner = (options.partnerAppearance || '').trim();
    const style = (config.stylePrompt || '').trim();
    const positivePreset = (novelai.positivePreset || '').trim();
    const negativePreset = (novelai.negativePreset || '').trim();
    // 评级标签放在最后：NAI 的 tag 越靠后权重越强，而且 Curated 模型的
    // Quality Tags 会在末尾追加 rating:general，我们这条必须排在它前面才不会被顶掉。
    const rating = (novelai.rating || '').trim();

    // 分角色：官方端点默认走 char_captions；自定义端点（ComfyUI 等）不认这套写法，
    // 角色外观会整段丢失，所以 auto 模式下非官方直接合并进主提示词。
    const separate = novelai.rolePromptMode === 'separate'
        || (novelai.rolePromptMode === 'auto' && novelai.connection === 'official');

    const promptParts = [positivePreset, cleanPrompt];
    if (!separate) {
        if (appearance) promptParts.push(appearance);
        if (partner) promptParts.push(partner);
        if (style) promptParts.push(style);
    }
    if (rating) promptParts.push(rating);
    const baseCaption = promptParts.filter(Boolean).join(', ').slice(0, 2000);

    const charCaptions: Array<{ char_caption: string; centers: Array<{ x: number; y: number }> }> = [];
    if (separate) {
        const spots = partner ? [0.35, 0.65] : [0.5];
        if (appearance) {
            charCaptions.push({
                char_caption: style ? `${appearance}, ${style}` : appearance,
                centers: [{ x: spots[0], y: 0.5 }],
            });
        }
        if (partner) {
            charCaptions.push({
                char_caption: partner,
                centers: [{ x: spots[1], y: 0.5 }],
            });
        }
    }

    // 尺寸：显式调用方给的 size 优先，其次设定里的 width/height。
    // 调用方可能给 "1:1" 这种比例（聊天里按话题选的构图），也可能给 "832x1216"。
    let width = novelai.width;
    let height = novelai.height;
    const explicitSize = (options.size || '').trim();
    const ratio = explicitSize.match(/^(\d+)\s*[:：]\s*(\d+)$/);
    const pixels = explicitSize.match(/^(\d+)\s*[x×]\s*(\d+)$/i);
    if (pixels) {
        width = clampInt(pixels[1], 64, 2048, width);
        height = clampInt(pixels[2], 64, 2048, height);
    } else if (ratio) {
        const mapped = sizeFromRatio(Number(ratio[1]), Number(ratio[2]));
        if (mapped) ({ width, height } = mapped);
    }

    const negativePrompt = (negativePreset || '').slice(0, 2000);

    const parameters: Record<string, unknown> = {
        width,
        height,
        scale: novelai.scale,
        sampler: novelai.sampler,
        noise_schedule: novelai.noiseSchedule,
        steps: novelai.steps,
        n_samples: 1,
        seed: novelai.seed >= 0 ? novelai.seed : Math.floor(Math.random() * 4_294_967_295),
        ucPreset: novelai.ucPreset,
        qualityToggle: novelai.qualityTags,
        cfg_rescale: novelai.cfgRescale,
        negative_prompt: negativePrompt,
        // V4 系列要这个版本号才会走新版采样路径；V3 忽略它。
        params_version: 3,
        dynamic_thresholding: novelai.dynamicThresholding,
        sm: novelai.sm,
        sm_dyn: novelai.smDyn,
    };

    // 负面词强度没有独立的 API 参数，只能折进提示词权重：1 = 原样，越小越弱。
    if (novelai.ucStrength < 1 && negativePrompt) {
        parameters.negative_prompt = scalePromptWeights(negativePrompt, novelai.ucStrength);
    }

    if (novelai.varietyBoost) {
        // 官方文档：skip_cfg_above_sigma 是 Variety Boost 的开关值。
        parameters.skip_cfg_above_sigma = 19;
    }

    if (charCaptions.length > 0) {
        parameters.v4_prompt = {
            caption: { base_caption: baseCaption, char_captions: charCaptions },
            use_coords: true,
            use_order: true,
        };
        parameters.v4_negative_prompt = {
            caption: { base_caption: negativePrompt, char_captions: [] },
            legacy_uc: false,
        };
    }

    // 画风参考（Vibe Transfer）。多个参考用复数数组，强度也一一对应。
    if (novelai.vibeEnabled && novelai.vibeRefs.length > 0) {
        const refs = novelai.vibeRefs.filter(ref => ref.data).slice(0, 4);
        if (refs.length > 0) {
            parameters.reference_image_multiple = refs.map(ref => ref.data);
            parameters.reference_strength_multiple = refs.map(ref => clampNum(ref.strength, 0, 1, 0.6));
            parameters.reference_information_extracted_multiple = refs.map(ref => clampNum(ref.informationExtracted, 0, 1, 1));
        }
    }

    return {
        url: `${base}/ai/generate-image`,
        body: {
            action: 'generate',
            input: baseCaption,
            model: config.model.trim(),
            parameters,
        },
    };
}

/** 负面词强度 < 1 时，把整段负面词包成加权形式 `(word:0.5)`。 */
function scalePromptWeights(prompt: string, strength: number): string {
    if (!prompt) return '';
    const w = Math.max(0.05, Math.min(1, strength)).toFixed(2);
    return `(${prompt}:${w})`;
}

/** 聊天里按话题选的构图比例 → NovelAI 的标准尺寸（边长须为 64 的倍数）。 */
function sizeFromRatio(w: number, h: number): { width: number; height: number } | null {
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
    const ratio = w / h;
    if (ratio > 1.15) return { width: 1216, height: 832 };
    if (ratio < 0.87) return { width: 832, height: 1216 };
    return { width: 1024, height: 1024 };
}

/**
 * 调 NovelAI 画一张图，落成本机图片令牌。
 *
 * 请求带 `Accept: application/json`，官方就返回 `{ images: [{ image: base64 }] }`，
 * 省掉解 zip 的一步；万一是中转不支持、仍然回了 zip，会落到错误分支并如实报出来。
 */
export async function generateNovelAiImage(
    prompt: string,
    config: ImageGenApiConfig,
    options: NovelAiDrawOptions = {},
): Promise<NovelAiDrawResult> {
    if (!isNovelAiConfigReady(config)) return { error: 'NovelAI 配置不完整（需要 Key 和模型）' };
    const novelaiConfig = normalizeNovelAiConfig(config.novelai);
    if (novelaiConfig.connection === 'custom' && !novelAiBaseUrl(config)) {
        return { error: '连线方式选了自定义，但没填地址' };
    }

    const { url, body } = buildNovelAiRequest(prompt, config, options);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NOVELAI_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort);

    try {
        const data = await safeFetchJson(url, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey.trim()}`,
                'Accept': 'application/json',
            },
            body: JSON.stringify(body),
        }, 0, NOVELAI_TIMEOUT_MS, { appName: '消息', purpose: '生图' });

        const first = Array.isArray(data?.images) ? data.images[0] : null;
        const b64 = first?.image || first?.b64_json || data?.image;
        if (typeof b64 === 'string' && b64) {
            const dataUrl = b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`;
            const { token } = await putImageBlobDeduped(dataUrlToBlob(dataUrl));
            const seed = typeof first?.seed === 'number' ? first.seed : undefined;
            return seed != null ? { ref: token, seed } : { ref: token };
        }
        return { error: 'NovelAI 没有返回图片' };
    } catch (e: any) {
        const message = e?.name === 'AbortError' ? '生图超时' : (e?.message || 'NovelAI 生图失败');
        return { error: humanizeNovelAiError(message) };
    } finally {
        clearTimeout(timer);
        options?.signal?.removeEventListener('abort', onAbort);
    }
}

/** 把接口的英文错误换成能看懂的话；认不出来的照原样带出去。 */
function humanizeNovelAiError(message: string): string {
    if (/401|unauthorized/i.test(message)) return 'Key 无效或已过期（填的是 Persistent Token 吗？）';
    if (/402|payment|anlas/i.test(message)) return '额度不足（Anlas 用完了）';
    if (/429|too many/i.test(message)) return '请求太频繁，被限流了';
    if (/400|bad request/i.test(message)) return '参数不被接受（可能是模型名或尺寸不对）';
    if (/403/i.test(message)) return '该账号没有这个模型的权限（可能需要更高订阅）';
    return message;
}

/**
 * 把一张参考图编码成 vibe（`.naiv4vibe` 里的同款内容）。
 *
 * 官方 `/ai/encode-vibe` 返回二进制，这里转成 base64 存进配置；之后每次生图直接用，
 * 不用重复编码（跟截图里"上传原图首次生图会先编码并缓存"一致）。
 */
export async function encodeNovelAiVibe(
    imageDataUrl: string,
    config: ImageGenApiConfig,
    options: { informationExtracted?: number; model?: string } = {},
): Promise<{ data: string } | { error: string }> {
    const base = novelAiBaseUrl(config);
    if (!base || !config.apiKey?.trim()) return { error: 'NovelAI 配置不完整' };
    const pureBase64 = imageDataUrl.includes(',') ? imageDataUrl.split(',')[1] : imageDataUrl;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VIBE_ENCODE_TIMEOUT_MS);
    try {
        const res = await fetch(`${base}/ai/encode-vibe`, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey.trim()}`,
            },
            body: JSON.stringify({
                image: pureBase64,
                model: options.model || config.model.trim(),
                information_extracted: clampNum(options.informationExtracted, 0, 1, 1),
            }),
        });
        if (!res.ok) return { error: `编码失败：HTTP ${res.status}` };
        const buffer = await res.arrayBuffer();
        if (!buffer.byteLength) return { error: '编码结果是空的' };
        return { data: arrayBufferToBase64(buffer) };
    } catch (e: any) {
        return { error: e?.name === 'AbortError' ? '编码超时' : (e?.message || '编码失败') };
    } finally {
        clearTimeout(timer);
    }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

/** 新建一条空 vibe 记录（界面上传图后由调用方填 data）。 */
export function createNovelAiVibeRef(partial: Partial<NovelAiVibeRef> & { name: string }): NovelAiVibeRef {
    return {
        id: partial.id || `vibe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: partial.name,
        data: partial.data || '',
        strength: clampNum(partial.strength, 0, 1, 0.6),
        informationExtracted: clampNum(partial.informationExtracted, 0, 1, 1),
    };
}
