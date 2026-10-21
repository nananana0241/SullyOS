import type { ImageGenApiConfig } from '../types';
import { isImageGenReady } from './imageStudio';
import { getEnabledMcpServers } from './mcpClient';

/**
 * 「角色可以发图」的提示词块。
 *
 * 做法跟 `[[SEND_EMOJI:]]` 一样：模型在正文里写标签，客户端替你落成真正的图片消息。
 * 不用 function calling —— 中转支不支持 tools 都能用。
 *
 * 两种标签：
 *   - `[[IMAGE: https://...]]` 贴一张已有的网图（通常来自 MCP 搜索工具返回的图链）
 *   - `[[DRAW: 画面描述]]`     让生图中转画一张（只有配置了生图才给这个能力）
 */

const IMAGE_RULES = `- 图片只能通过标签让系统发出去，**不要**把图片地址当普通文字写在句子里，也不要写 markdown 图片语法。
- 一次最多发 2 张。图发出去之后再配一两句自己的话，别光发图不吭声。
- 只有真的合适的时候才发（对方想看、话题聊到、你自己想分享），不要每轮都发。
- 找不到合适的图或画不出来就照常聊天，别硬凑一张不相关的图。`;

export function buildCharacterImageBlock(
    userName: string,
    options: {
        enabled?: boolean;
        imageGen?: ImageGenApiConfig;
        charId?: string;
    } = {},
): string {
    if (options.enabled === false) return '';
    const canDraw = isImageGenReady(options.imageGen);
    const hasSearch = getEnabledMcpServers(options.charId).some(server =>
        (server.tools || []).some(tool => /search|browse|web/i.test(tool.name)));
    if (!canDraw && !hasSearch) return '';

    const lines: string[] = [];
    lines.push('');
    lines.push('---');
    lines.push(`[你可以发图 —— 给 ${userName} 看真实的画面]`);
    lines.push('');
    lines.push('**怎么发**：在正文里单独写一行标签，系统会把它变成一条真正的图片消息；标签前后的文字照常是气泡。');
    lines.push('');
    if (canDraw) {
        lines.push('1. 画一张新的：');
        lines.push('   `[[DRAW: 画面的具体描述]]`');
        lines.push('   - 描述要具体：主体、动作、场景、光线、氛围、画风。可以带上你此刻的心情。');
        lines.push('   - 画图要等十几秒到一分钟，别连着画好几张。');
        if (hasSearch) lines.push('');
    }
    if (hasSearch) {
        lines.push(`${canDraw ? '2' : '1'}. 找一张现成的网图（用你手上的搜索工具先搜，把结果里的图片地址填进来）：`);
        lines.push('   `[[IMAGE: https://图片地址]]`');
        lines.push('   - 地址必须是 http/https 开头、指向一张真实图片。搜索结果的网页链接不是图片地址。');
        lines.push('   - 搜索工具如果有 `include_images` 之类的选项，打开它才会返回图片地址。');
    }
    lines.push('');
    lines.push('**纪律**：');
    lines.push(IMAGE_RULES);
    lines.push('---');
    lines.push('');
    return lines.join('\n');
}

/** 尾部小提醒，跟 MCP_TAIL_REMINDER 一个位置，防长对话把纪律冲掉。 */
export const IMAGE_TAIL_REMINDER = '[发图 ON · 图片只写成 [[DRAW: 描述]] 或 [[IMAGE: https://...]] 单独一行; 别把地址写进句子; 一次最多 2 张]';
