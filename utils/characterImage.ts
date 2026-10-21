import { DB } from './db';
import { putImageBlobDeduped, isImageValue } from './blobRef';

/**
 * 角色发图（生图 / 找网图）。
 *
 * 模型在正文里写 `[[IMAGE: 图片地址]]`，聊天后处理把这一行换成一条真正的图片消息
 * （type: 'image'），显示在气泡流里。跟 `[[SEND_EMOJI:]]` 是同一类"模型写标签、客户端执行"的做法：
 * 不依赖 function calling，任何中转都能用。
 *
 * 两个来源：
 *   - 生图：模型写 `[[DRAW: 画面描述]]`，由 utils/imageStudio 调用户配置的生图中转画出来。
 *   - 找图：模型写 `[[IMAGE: https://...]]`（通常是 MCP 搜索工具返回的图链）。
 *
 * 存进本机时走 blobRef 去重，和用户自己发的图共用一份 Blob 存储、共用相册。
 */

/** `[[IMAGE: url]]` —— 全角冒号一并容（中文输入法下的高频变体）。 */
export const IMAGE_TAG_RE = /\[\[IMAGE[:：]\s*([\s\S]*?)\]\]/gi;
/** `[[DRAW: 描述]]` */
export const DRAW_TAG_RE = /\[\[DRAW[:：]\s*([\s\S]*?)\]\]/gi;

const IMAGE_URL_RE = /^https?:\/\/[^\s<>"']+$/i;
const MAX_DRAW_PROMPT = 800;
const DOWNLOAD_TIMEOUT_MS = 45_000;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

export type ExtractedImagePart =
    | { type: 'text'; content: string }
    | { type: 'image'; content: string }
    | { type: 'draw'; content: string };

const normalizeUrl = (raw: string): string | null => {
    let value = raw.trim();
    // 模型偶尔把链接包进 markdown：[图](https://...)。必须先于去括号处理，
    // 否则结尾的 `)` 会被当成多余括号剥掉，markdown 形态就再也认不出来了。
    const md = value.match(/\]\((https?:\/\/[^\s)]+)\)/i) || value.match(/^\((https?:\/\/[^\s)]+)\)$/i);
    if (md) value = md[1];
    value = value.replace(/^[<（(]|[>）)]$/g, '').trim();
    if (!IMAGE_URL_RE.test(value)) return null;
    try {
        const u = new URL(value);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
        return u.toString();
    } catch {
        return null;
    }
};

/**
 * 把正文按 `[[IMAGE:]]` / `[[DRAW:]]` 切成有序的段落，保持模型写的先后顺序。
 * 与 `ChatParser.splitResponse` 同样的契约：文字段和图片段交替，空段丢掉。
 */
export function splitImageTags(content: string): ExtractedImagePart[] {
    const re = /\[\[(IMAGE|DRAW)[:：]\s*([\s\S]*?)\]\]/gi;
    const parts: ExtractedImagePart[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = re.exec(content)) !== null) {
        const before = content.slice(lastIndex, match.index).trim();
        if (before) parts.push({ type: 'text', content: before });

        const kind = match[1].toUpperCase();
        const value = match[2].trim();
        if (kind === 'DRAW') {
            if (value) parts.push({ type: 'draw', content: value.slice(0, MAX_DRAW_PROMPT) });
        } else {
            const url = normalizeUrl(value);
            // 链接不合法就当没说：不落一条坏图消息，也不把原始标签漏给用户（由 sanitize 负责剥）。
            if (url) parts.push({ type: 'image', content: url });
        }
        lastIndex = match.index + match[0].length;
    }

    const after = content.slice(lastIndex).trim();
    if (after) parts.push({ type: 'text', content: after });
    return parts;
}

/** 这段文本里有没有待执行的图片标签（决定要不要走图片分支）。 */
export const hasImageTags = (content: string): boolean =>
    new RegExp(`${IMAGE_TAG_RE.source}|${DRAW_TAG_RE.source}`, 'i').test(content);

/** 只剩图片标签、没有正文时，不当成一条空文字气泡。 */
export const stripImageTags = (content: string): string =>
    content
        .replace(/\[\[IMAGE[:：][\s\S]*?\]\]/gi, '')
        .replace(/\[\[DRAW[:：][\s\S]*?\]\]/gi, '')
        .trim();

export type DownloadResult = { ref: string } | { error: string };

/**
 * 下载一张网络图片并落成本机令牌。
 *
 * 失败一律返回 { error }（不抛），调用方据此落一条降级文字气泡——静默丢图的后果是
 * 用户只看到一次"发了张图"的上下文，气泡却不见了。
 */
export async function downloadImageToRef(
    url: string,
    fetchImpl: typeof fetch = fetch,
): Promise<DownloadResult> {
    let lastError = '下载失败';
    // 有些图床会先回一段跳转/防盗链页，follow 一次即可，不无限重试。
    for (let attempt = 0; attempt < 2; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
        try {
            const res = await fetchImpl(url, {
                signal: controller.signal,
                // 不带 referer，避免部分图床按来源拦截
                redirect: 'follow',
            });
            if (!res.ok) {
                lastError = `图片下载失败：HTTP ${res.status}`;
                continue;
            }
            const type = (res.headers.get('content-type') || '').toLowerCase();
            if (type && !type.startsWith('image/')) {
                lastError = '对方返回的不是图片';
                continue;
            }
            const blob = await res.blob();
            if (!blob.size) {
                lastError = '图片是空的';
                continue;
            }
            if (blob.size > MAX_IMAGE_BYTES) {
                lastError = '图片太大（超过 12MB）';
                continue;
            }
            const { token } = await putImageBlobDeduped(blob);
            return { ref: token };
        } catch (e: any) {
            lastError = e?.name === 'AbortError' ? '下载超时' : (e?.message || '下载失败');
        } finally {
            clearTimeout(timer);
        }
    }
    return { error: lastError };
}

/** 已经是本机令牌 / data URL 时不用下载（MCP 偶尔直接回 base64）。 */
export async function ensureLocalImageRef(value: string): Promise<string | null> {
    if (isImageValue(value) && !/^https?:\/\//i.test(value)) return value;
    if (/^https?:\/\//i.test(value)) {
        const result = await downloadImageToRef(value);
        return 'ref' in result ? result.ref : null;
    }
    return null;
}

/** 图片消息落库后同步进相册（跟用户自己发图的处理一致）。 */
export async function saveAssistantImageToGallery(
    charId: string,
    ref: string,
    sourceMessageId: number,
    localDateKey: string,
    chatContext?: string[],
): Promise<void> {
    try {
        await DB.saveGalleryImage({
            id: `img-${Date.now()}-${Math.random()}`,
            charId,
            url: ref,
            timestamp: Date.now(),
            sourceMessageId,
            savedDate: localDateKey,
            chatContext,
        });
    } catch (e) {
        // 相册是附带记录，失败不能影响已经落库的图片消息
        console.warn('[image] 角色图片存相册失败', e);
    }
}
