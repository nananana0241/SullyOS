import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { MagnifyingGlass, X } from '@phosphor-icons/react';
import type { Message } from '../../types';
import { chatMessageIncludesKeyword, searchableChatMessageText } from '../../utils/chatMessageSearch';
import { isVisibleChatMessage } from '../../utils/chatMessageVisibility';

/**
 * 聊天记录原话搜索 —— 加号面板「搜索」入口。
 *
 * 跟聊天设置里「AI 原文读取范围」弹窗里那个搜索框是两件事：那个搜索框是给管理
 * 上下文裁剪/记忆水位线用的，模糊匹配（字符顺序命中即可）；这里是用户专门来
 * 找"原话"的入口，按精确字符串匹配，只搜当前这个角色的聊天记录。
 *
 * 复用 handleJumpToMessageInChat 做跳转：点一条结果，关掉搜索，定位到那条消息。
 */

const PAGE_SIZE = 30;

const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
});

interface ChatSearchPortalProps {
    messages: Message[];
    charName: string;
    hideSystemLogs: boolean;
    onClose: () => void;
    onJumpToMessage: (messageId: number) => void;
}

const ChatSearchPortal: React.FC<ChatSearchPortalProps> = ({ messages, charName, hideSystemLogs, onClose, onJumpToMessage }) => {
    const [query, setQuery] = useState('');
    const [page, setPage] = useState(0);

    const trimmedQuery = query.trim();

    // 跟聊天气泡流看到的一致：不把隐藏的系统日志/撤回占位之类的塞进搜索结果里，
    // 搜出来点进去却发现那条根本不展示，用户会觉得"跳转坏了"。
    const searchableMessages = useMemo(
        () => messages.filter(m => isVisibleChatMessage(m, hideSystemLogs) && !m.metadata?.recalled),
        [messages, hideSystemLogs],
    );

    const results = useMemo(() => {
        if (!trimmedQuery) return [];
        return searchableMessages
            .filter(m => chatMessageIncludesKeyword(m, trimmedQuery))
            .slice()
            .reverse(); // 最新的排前面，跟"原文读取范围"列表一致
    }, [searchableMessages, trimmedQuery]);

    useEffect(() => setPage(0), [trimmedQuery]);

    const pageCount = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
    const visibleResults = results.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

    const renderHighlighted = (content: string, q: string): React.ReactNode => {
        const text = searchableChatMessageText({ type: 'text', content });
        if (!q || !text) return content;
        const lowerText = content.toLocaleLowerCase();
        const lowerQuery = q.toLocaleLowerCase();
        const idx = lowerText.indexOf(lowerQuery);
        if (idx < 0) return content;
        return (
            <>
                {content.slice(0, idx)}
                <mark className="bg-amber-200 text-slate-900 rounded px-0.5">{content.slice(idx, idx + q.length)}</mark>
                {content.slice(idx + q.length)}
            </>
        );
    };

    const portal = (
        <div className="chat-search-root">
            <style>{`
                .chat-search-root { position: fixed; inset: 0; z-index: 1650; overflow: hidden; color: #172033; background: #f4f1eb; font-family: ui-sans-serif, system-ui, -apple-system, "PingFang SC", sans-serif; animation: chatSearchEnter .18s ease-out both; }
                .chat-search-shell { height: 100%; max-width: 760px; margin: 0 auto; display: flex; flex-direction: column; }
                .chat-search-list { scrollbar-width: none; }
                .chat-search-list::-webkit-scrollbar { display: none; }
                .chat-search-row { animation: chatSearchRowEnter .16s ease both; }
                @keyframes chatSearchEnter { from { opacity: 0; } to { opacity: 1; } }
                @keyframes chatSearchRowEnter { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
                @media (prefers-reduced-motion: reduce) { .chat-search-root, .chat-search-row { animation: none !important; } }
            `}</style>
            <div className="chat-search-shell px-4 sm:px-7">
                <header className="shrink-0 pt-[max(16px,env(safe-area-inset-top))] pb-3 border-b border-slate-900/10">
                    <div className="flex items-center justify-between gap-4 h-12">
                        <button type="button" onClick={onClose} className="w-10 h-10 -ml-1 grid place-items-center rounded-full text-slate-600 active:bg-black/5" aria-label="关闭搜索">
                            <X size={21} weight="bold" />
                        </button>
                        <div className="min-w-0 text-center">
                            <h1 className="text-[17px] font-bold tracking-[.12em]">搜索聊天记录</h1>
                            <p className="mt-0.5 text-[10px] text-slate-500">与{charName}的对话</p>
                        </div>
                        <div className="w-10 h-10 -mr-1" />
                    </div>
                    <div className="mt-2">
                        <div className="relative">
                            <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                            <input
                                autoFocus
                                type="search"
                                value={query}
                                onChange={event => setQuery(event.target.value)}
                                placeholder="搜索你或角色说过的原话"
                                className="w-full h-10 rounded-xl border border-slate-900/10 bg-white/80 pl-9 pr-10 text-[12px] text-slate-800 outline-none placeholder:text-slate-400 focus:border-violet-300 focus:bg-white"
                                aria-label="搜索聊天记录中的原话"
                            />
                            {query && (
                                <button type="button" onClick={() => setQuery('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 grid place-items-center rounded-full text-slate-400 active:bg-black/5" aria-label="清空搜索">
                                    <X size={14} weight="bold" />
                                </button>
                            )}
                        </div>
                        {trimmedQuery && (
                            <p className="mt-1.5 px-1 text-[10px] text-slate-500">
                                找到 <b className="text-violet-700">{results.length}</b> 条匹配
                            </p>
                        )}
                    </div>
                </header>

                <main className="chat-search-list flex-1 overflow-y-auto py-2">
                    {!trimmedQuery && (
                        <div className="text-xs text-slate-400 text-center py-10">输入关键词，精确匹配原文</div>
                    )}
                    {trimmedQuery && results.length === 0 && (
                        <div className="text-xs text-slate-400 text-center py-10">没有找到匹配的消息</div>
                    )}
                    {visibleResults.map(m => (
                        <button
                            key={m.id}
                            type="button"
                            onClick={() => onJumpToMessage(m.id)}
                            className="chat-search-row w-full text-left py-3 border-b border-slate-900/10 active:bg-black/5 transition-colors"
                        >
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] font-bold text-slate-600">{m.role === 'user' ? '我' : charName}</span>
                                <time className="text-[10px] text-slate-400 whitespace-nowrap">{timeFormatter.format(new Date(m.timestamp))}</time>
                            </div>
                            <p className="mt-1 text-[13px] text-slate-700 whitespace-pre-wrap break-words line-clamp-3">
                                {renderHighlighted(m.content || '', trimmedQuery)}
                            </p>
                        </button>
                    ))}
                    {results.length > PAGE_SIZE && (
                        <div className="flex items-center justify-between px-1 py-3">
                            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className={`px-3 py-1 text-xs rounded-lg ${page === 0 ? 'text-slate-300' : 'text-violet-700'}`}>上一页</button>
                            <span className="text-xs text-slate-400">{page + 1} / {pageCount}</span>
                            <button onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1} className={`px-3 py-1 text-xs rounded-lg ${page >= pageCount - 1 ? 'text-slate-300' : 'text-violet-700'}`}>下一页</button>
                        </div>
                    )}
                </main>
            </div>
        </div>
    );

    return createPortal(portal, document.body);
};

export default ChatSearchPortal;
