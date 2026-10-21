import type { APIConfig, ImageGenApiConfig } from '../types';
import { safeFetchJson } from './safeApi';
import { putImageBlobDeduped, dataUrlToBlob } from './blobRef';

/**
 * 生图中转（OpenAI 兼容 `POST /images/generations`）。
 *
 * 跟识图配置（APIConfig.visionApi）并列：都单独填 URL / Key / 模型，因为中转站常见
 * "对话一个 Key、生图另一个 Key"。留空则不启用，角色也就不会写 [[DRAW:]]。
 */

export const isImageGenReady = (config?: ImageGenApiConfig | null): config is ImageGenApiConfig =>
    config?.enabled === true
    && !!config.baseUrl?.trim()
    && !!config.apiKey?.trim()
    && !!config.model?.trim();

/** 生图通常比对话慢很多，给足时间；超时就报错让角色如实说，不要吊着。 */
const IMAGE_GEN_TIMEOUT_MS = 180_000;

export type DrawResult = { ref: string } | { error: string };

const SIZE_FOR_ASPECT: Record<string, string> = {
    '1:1': '1024x1024',
    '3:4': '1024x1536',
    '2:3': '1024x1536',
    '4:3': '1536x1024',
    '3:2': '1536x1024',
    '9:16': '1024x1536',
    '16:9': '1536x1024',
};

/**
 * 调生图接口并落成本机图片令牌。
 *
 * 中转站返回形态不统一，这里按出现频率依次认：
 *   1. `data[0].b64_json`（OpenAI 标准）
 *   2. `data[0].url`（多数中转的默认形态）
 *   3. 顶层 `url` / `image_url` / `images[0]`
 */
export async function generateImage(
    prompt: string,
    config: ImageGenApiConfig,
    options?: { size?: string; fetchImpl?: typeof fetch; signal?: AbortSignal },
): Promise<DrawResult> {
    if (!isImageGenReady(config)) return { error: '生图 API 没配置完整' };
    const cleanPrompt = (prompt || '').trim().slice(0, 2000);
    if (!cleanPrompt) return { error: '缺少画面描述' };

    const baseUrl = config.baseUrl.trim().replace(/\/+$/, '');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IMAGE_GEN_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    options?.signal?.addEventListener('abort', onAbort);

    try {
        const size = options?.size
            ? (SIZE_FOR_ASPECT[options.size] || options.size)
            : (config.size || undefined);
        // 画风后缀由用户在设置里固定，角色只写画面内容，不重复写风格。
        const style = (config.stylePrompt || '').trim();
        const finalPrompt = style ? `${cleanPrompt}\n\n画风要求：${style}` : cleanPrompt;
        const body: Record<string, unknown> = {
            model: config.model.trim(),
            prompt: finalPrompt,
            n: 1,
            // 要求 base64：URL 形式的图很多中转几小时就失效，存到本机才是真存住
            response_format: 'b64_json',
        };
        if (size) body.size = size;

        let data: any;
        try {
            data = await safeFetchJson(`${baseUrl}/images/generations`, {
                method: 'POST',
                signal: controller.signal,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.apiKey.trim()}`,
                },
                body: JSON.stringify(body),
            }, 1, IMAGE_GEN_TIMEOUT_MS, { appName: '消息', purpose: '生图' });
        } catch (e: any) {
            // 有的中转不接受 response_format，去掉再试一次（只重试这一次）
            const message = String(e?.message || '');
            if (!/response_format|unknown|invalid|unsupported|400/i.test(message)) throw e;
            delete body.response_format;
            data = await safeFetchJson(`${baseUrl}/images/generations`, {
                method: 'POST',
                signal: controller.signal,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.apiKey.trim()}`,
                },
                body: JSON.stringify(body),
            }, 1, IMAGE_GEN_TIMEOUT_MS, { appName: '消息', purpose: '生图' });
        }

        const first = data?.data?.[0] || data?.images?.[0] || data;
        const b64 = first?.b64_json || first?.b64 || data?.b64_json;
        if (typeof b64 === 'string' && b64) {
            const dataUrl = b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`;
            const { token } = await putImageBlobDeduped(dataUrlToBlob(dataUrl));
            return { ref: token };
        }
        const url = first?.url || first?.image_url || data?.url || data?.image_url;
        if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
            // 下载下来转成本机图片，别只存外链
            const result = await downloadToRef(url);
            return result;
        }
        return { error: '生图接口没有返回图片' };
    } catch (e: any) {
        const message = e?.name === 'AbortError' ? '生图超时' : (e?.message || '生图失败');
        return { error: message };
    } finally {
        clearTimeout(timer);
        options?.signal?.removeEventListener('abort', onAbort);
    }
}

async function downloadToRef(url: string): Promise<DrawResult> {
    try {
        const res = await fetch(url);
        if (!res.ok) return { error: `生图返回的图片下载失败：HTTP ${res.status}` };
        const blob = await res.blob();
        if (!blob.size) return { error: '生图返回的图片是空的' };
        const { token } = await putImageBlobDeduped(blob);
        return { ref: token };
    } catch (e: any) {
        return { error: e?.message || '生图返回的图片下载失败' };
    }
}

/** 从全局 API 配置里取生图配置（设置页写进 apiConfig.imageGen）。 */
export const imageGenConfigFromApiConfig = (apiConfig?: APIConfig | null): ImageGenApiConfig | undefined =>
    apiConfig?.imageGen;
