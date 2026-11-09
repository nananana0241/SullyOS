import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ImageGenApiConfig, NovelAiImageConfig, NovelAiVibeRef } from '../../types';
import {
    DEFAULT_NOVELAI_CONFIG,
    NOVELAI_RATINGS,
    NOVELAI_SAMPLERS,
    NOVELAI_NOISE_SCHEDULES,
    NOVELAI_SIZES,
    NOVELAI_UC_PRESETS,
    createNovelAiVibeRef,
    encodeNovelAiVibe,
    normalizeNovelAiConfig,
} from '../../utils/novelaiImage';
import { generateImage } from '../../utils/imageStudio';

/**
 * NovelAI 的「生成设定」弹窗。
 *
 * 只改一份草稿，点「保存设置」才交回设置页；点「测试生图」用的是草稿里的值，
 * 所以可以边调边试，不用先保存。
 *
 * 字段顺序照着 NAI 网页版的参数区排：先尺寸/步数/相关性/采样器/种子，再负面词与
 * 几个开关，最后画风参考和预设词。
 */

interface Props {
    open: boolean;
    config: ImageGenApiConfig;
    value: NovelAiImageConfig;
    onChange: (next: NovelAiImageConfig) => void;
    onSave: (next: NovelAiImageConfig) => void;
    onClose: () => void;
    addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
    <div className="mb-4">
        <label className="text-[13px] font-medium text-slate-700 mb-1.5 block">{label}</label>
        {children}
        {hint && <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">{hint}</p>}
    </div>
);

const ToggleRow: React.FC<{
    label: string;
    hint?: string;
    checked: boolean;
    onChange: (v: boolean) => void;
}> = ({ label, hint, checked, onChange }) => (
    <div className="flex items-start justify-between gap-3 py-2.5">
        <div className="min-w-0">
            <p className="text-[13px] font-medium text-slate-700">{label}</p>
            {hint && <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">{hint}</p>}
        </div>
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            onClick={() => onChange(!checked)}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${checked ? 'bg-emerald-500' : 'bg-slate-200'}`}
        >
            <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
    </div>
);

const inputClass = 'w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-700 outline-none focus:bg-white focus:border-slate-300 transition-colors';

export const NovelAiSettingsModal: React.FC<Props> = ({ open, config, value, onChange, onSave, onClose, addToast }) => {
    const [draft, setDraft] = useState<NovelAiImageConfig>(() => normalizeNovelAiConfig(value));
    const [testing, setTesting] = useState(false);
    const [testMsg, setTestMsg] = useState('');
    const [encoding, setEncoding] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    // 「新增」画风参考时先选图，选完再编码；这里暂存刚读出来的 data URL。
    const pendingVibeImage = useRef<{ name: string; dataUrl: string } | null>(null);

    useEffect(() => {
        if (!open) return;
        setDraft(normalizeNovelAiConfig(value));
        setTestMsg('');
    }, [open, value]);

    const patch = (part: Partial<NovelAiImageConfig>) => setDraft(prev => ({ ...prev, ...part }));

    const sizeValue = `${draft.width}x${draft.height}`;
    const isPresetSize = NOVELAI_SIZES.some(s => s.value === sizeValue);

    const canTest = useMemo(
        () => !!config.apiKey?.trim() && !!config.model?.trim()
            && (draft.connection === 'official' || !!config.baseUrl?.trim()),
        [config.apiKey, config.model, config.baseUrl, draft.connection],
    );

    const handleSave = () => {
        const normalized = normalizeNovelAiConfig(draft);
        setDraft(normalized);
        // 把草稿交回去，而不是让外层读自己的旧 state——否则刚改的设定会丢。
        onSave(normalized);
        onClose();
    };

    const handleReset = () => {
        setDraft({ ...DEFAULT_NOVELAI_CONFIG, vibeRefs: [] });
        setTestMsg('');
        addToast('已恢复默认设定，记得点保存', 'info');
    };

    const handleTest = async () => {
        if (!canTest) {
            setTestMsg('❌ 先填好 API Key 和模型');
            return;
        }
        setTesting(true);
        setTestMsg('');
        try {
            const result = await generateImage('1girl, sitting by the window, watercolor', {
                ...config,
                enabled: true,
                provider: 'novelai',
                novelai: normalizeNovelAiConfig(draft),
            });
            setTestMsg('ref' in result ? '✅ 出图成功，设定可以用' : `❌ ${result.error}`);
        } catch (error: any) {
            setTestMsg(`❌ ${error?.message || '未知错误'}`);
        } finally {
            setTesting(false);
        }
    };

    const handlePickVibeImage = () => {
        const input = fileInputRef.current;
        if (!input) return;
        input.value = '';
        input.click();
    };

    const handleVibeFile = async (file: File) => {
        // .naiv4vibe 是编码好的二进制，直接转 base64 用，不再走一次接口。
        if (/\.naiv4vibe$/i.test(file.name) || /\.vibe$/i.test(file.name)) {
            const buffer = await file.arrayBuffer();
            let binary = '';
            const bytes = new Uint8Array(buffer);
            const chunk = 0x8000;
            for (let i = 0; i < bytes.length; i += chunk) {
                binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
            }
            const ref = createNovelAiVibeRef({ name: file.name.replace(/\.(naiv4vibe|vibe)$/i, ''), data: btoa(binary) });
            patch({ vibeEnabled: true, vibeRefs: [...draft.vibeRefs, ref] });
            addToast('已导入画风参考文件', 'success');
            return;
        }

        // 普通图片：走 /ai/encode-vibe 编码一次，之后直接复用。
        const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(new Error('读取图片失败'));
            reader.readAsDataURL(file);
        });
        if (!dataUrl) return;
        setEncoding(file.name);
        try {
            const encoded = await encodeNovelAiVibe(dataUrl, {
                ...config,
                provider: 'novelai',
                novelai: normalizeNovelAiConfig(draft),
            });
            if ('error' in encoded) {
                addToast(`画风参考编码失败：${encoded.error}`, 'error');
                return;
            }
            const ref = createNovelAiVibeRef({ name: file.name, data: encoded.data });
            patch({ vibeEnabled: true, vibeRefs: [...draft.vibeRefs, ref] });
            addToast('画风参考已编码并保存', 'success');
        } finally {
            setEncoding(null);
        }
    };

    const updateVibe = (id: string, part: Partial<NovelAiVibeRef>) => {
        patch({ vibeRefs: draft.vibeRefs.map(ref => (ref.id === id ? { ...ref, ...part } : ref)) });
    };

    const removeVibe = (id: string) => {
        patch({ vibeRefs: draft.vibeRefs.filter(ref => ref.id !== id) });
    };

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center">
            <div className="absolute inset-0 bg-black/45" onClick={onClose} />
            <div
                className="relative w-full max-w-md bg-white rounded-t-[2rem] sm:rounded-[2rem] shadow-2xl flex flex-col max-h-[88vh]"
                style={{ paddingBottom: 'var(--safe-bottom, 0px)' }}
            >
                <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0 border-b border-slate-100">
                    <h3 className="text-lg font-bold text-slate-800">NovelAI 生成设定</h3>
                    <button onClick={onClose} aria-label="关闭" className="p-1.5 -mr-1.5 rounded-full text-slate-400 active:bg-slate-100">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
                            <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
                        </svg>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto px-5 py-4 no-scrollbar">
                    <Field label="图像尺寸" hint={isPresetSize ? '建议使用官方支持的标准尺寸以获得最佳效果' : '非标准尺寸可能被官方拒绝；边长需为 64 的倍数'}>
                        <select
                            value={isPresetSize ? sizeValue : ''}
                            onChange={e => {
                                const [w, h] = e.target.value.split('x').map(Number);
                                if (w && h) patch({ width: w, height: h });
                            }}
                            className={inputClass + ' appearance-none'}
                        >
                            {!isPresetSize && <option value="">自定义 {sizeValue}</option>}
                            {NOVELAI_SIZES.map(s => (
                                <option key={s.value} value={s.value}>{s.label}</option>
                            ))}
                        </select>
                        <div className="flex items-center gap-2 mt-2">
                            <input
                                type="number"
                                value={draft.width}
                                onChange={e => patch({ width: Number(e.target.value) || 1024 })}
                                className={inputClass + ' text-center'}
                                aria-label="宽度"
                            />
                            <span className="text-slate-400 text-sm shrink-0">×</span>
                            <input
                                type="number"
                                value={draft.height}
                                onChange={e => patch({ height: Number(e.target.value) || 1024 })}
                                className={inputClass + ' text-center'}
                                aria-label="高度"
                            />
                        </div>
                    </Field>

                    <Field label="采样步数 (Steps)" hint="推荐值：28（值越高质量越好，但耗时越长）">
                        <input
                            type="number" min={1} max={50}
                            value={draft.steps}
                            onChange={e => patch({ steps: Number(e.target.value) || 28 })}
                            className={inputClass}
                        />
                    </Field>

                    <Field label="提示词相关性 (CFG Scale)" hint="推荐值：5（控制图像与提示词的相关程度）">
                        <input
                            type="number" min={1} max={10} step={0.5}
                            value={draft.scale}
                            onChange={e => patch({ scale: Number(e.target.value) || 5 })}
                            className={inputClass}
                        />
                    </Field>

                    <Field label="采样器 (Sampler)">
                        <select
                            value={draft.sampler}
                            onChange={e => patch({ sampler: e.target.value })}
                            className={inputClass + ' appearance-none'}
                        >
                            {NOVELAI_SAMPLERS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                        </select>
                    </Field>

                    <Field label="噪声调度 (Noise Schedule)">
                        <select
                            value={draft.noiseSchedule}
                            onChange={e => patch({ noiseSchedule: e.target.value })}
                            className={inputClass + ' appearance-none'}
                        >
                            {NOVELAI_NOISE_SCHEDULES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                        </select>
                    </Field>

                    <Field label="随机种子 (Seed)" hint="-1 表示随机抽签；固定种子可复现同一张图">
                        <div className="flex gap-2">
                            <input
                                type="number"
                                value={draft.seed}
                                onChange={e => patch({ seed: Number(e.target.value) })}
                                className={inputClass}
                            />
                            <button
                                type="button"
                                onClick={() => patch({ seed: Math.floor(Math.random() * 4_294_967_295) })}
                                className="shrink-0 px-3 rounded-xl bg-slate-100 text-slate-600 text-xs font-medium active:scale-95 transition-transform"
                            >
                                抽一个
                            </button>
                        </div>
                    </Field>

                    <Field
                        label="评级 (Rating)"
                        hint="写进正面提示词。要出成人内容必须用 Full 模型——Curated 的 Quality Tags 会自动追加 rating:general，把这里的选择顶掉。"
                    >
                        <select
                            value={draft.rating || ''}
                            onChange={e => patch({ rating: e.target.value })}
                            className={inputClass + ' appearance-none'}
                        >
                            {NOVELAI_RATINGS.map(r => (
                                <option key={r.id || 'none'} value={r.id}>{r.label}</option>
                            ))}
                        </select>
                    </Field>

                    <Field label="负面提示词预设 (UC Preset)">
                        <select
                            value={draft.ucPreset}
                            onChange={e => patch({ ucPreset: Number(e.target.value) })}
                            className={inputClass + ' appearance-none'}
                        >
                            {NOVELAI_UC_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                        </select>
                    </Field>

                    <div className="border-t border-slate-100 mt-2">
                        <ToggleRow label="SMEA" checked={draft.sm} onChange={v => patch({ sm: v })} />
                        <ToggleRow label="SMEA DYN" checked={draft.smDyn} onChange={v => patch({ smDyn: v })} />
                    </div>

                    <Field label="CFG Rescale" hint="0~1，降低 CFG 的过度饱和（推荐 0）">
                        <input
                            type="number" min={0} max={1} step={0.05}
                            value={draft.cfgRescale}
                            onChange={e => patch({ cfgRescale: Number(e.target.value) })}
                            className={inputClass}
                        />
                    </Field>

                    <Field label="Undesired Content Strength" hint="负面提示词强度（推荐 1）">
                        <input
                            type="number" min={0} max={1} step={0.05}
                            value={draft.ucStrength}
                            onChange={e => patch({ ucStrength: Number(e.target.value) })}
                            className={inputClass}
                        />
                    </Field>

                    <div className="border-t border-slate-100">
                        <ToggleRow
                            label="Quality Tags"
                            hint="V4/V4.5 自动在提示词前面加上官方品质词串（best quality, very aesthetic, absurdres）"
                            checked={draft.qualityTags}
                            onChange={v => patch({ qualityTags: v })}
                        />
                        <ToggleRow
                            label="Variety+"
                            hint="提升画面多样性、减少同质化（仅 V4 系列有效）"
                            checked={draft.varietyBoost}
                            onChange={v => patch({ varietyBoost: v })}
                        />
                        <ToggleRow
                            label="Dynamic Thresholding"
                            checked={draft.dynamicThresholding}
                            onChange={v => patch({ dynamicThresholding: v })}
                        />
                        <ToggleRow
                            label="画风参考 (Vibe Transfer)"
                            hint="上传参考图或导入 NovelAI 导出的 .naiv4vibe 文件，让生成的图沿用它画风 / 氛围 / 配色（仅 V4/V4.5 有效）。上传原图首次会先编码并缓存；导入 .naiv4vibe 则直接使用免编码。"
                            checked={draft.vibeEnabled}
                            onChange={v => patch({ vibeEnabled: v })}
                        />
                    </div>

                    {draft.vibeEnabled && (
                        <div className="border border-slate-200 rounded-2xl p-3 mb-4">
                            {draft.vibeRefs.length === 0 && (
                                <p className="text-[11px] text-slate-400 mb-2">还没有画风参考。可选一张图，或导入 .naiv4vibe。</p>
                            )}
                            <div className="space-y-3">
                                {draft.vibeRefs.map(ref => (
                                    <div key={ref.id} className="rounded-xl bg-slate-50 p-3">
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="text-xs font-medium text-slate-700 flex-1 truncate">{ref.name}</span>
                                            <button
                                                onClick={() => removeVibe(ref.id)}
                                                className="text-[11px] text-rose-500 px-2 py-1 rounded-lg active:bg-rose-50"
                                            >
                                                删除
                                            </button>
                                        </div>
                                        <label className="text-[10px] text-slate-400 block mb-1">
                                            参考强度 {ref.strength.toFixed(2)}
                                        </label>
                                        <input
                                            type="range" min={0} max={1} step={0.05}
                                            value={ref.strength}
                                            onChange={e => updateVibe(ref.id, { strength: Number(e.target.value) })}
                                            className="w-full accent-emerald-500"
                                        />
                                        <label className="text-[10px] text-slate-400 block mb-1 mt-2">
                                            信息提取 {ref.informationExtracted.toFixed(2)}
                                        </label>
                                        <input
                                            type="range" min={0} max={1} step={0.05}
                                            value={ref.informationExtracted}
                                            onChange={e => updateVibe(ref.id, { informationExtracted: Number(e.target.value) })}
                                            className="w-full accent-emerald-500"
                                        />
                                    </div>
                                ))}
                            </div>
                            <button
                                type="button"
                                onClick={handlePickVibeImage}
                                disabled={!!encoding}
                                className="mt-3 w-full py-2 rounded-xl bg-white border border-dashed border-slate-300 text-xs font-medium text-slate-600 active:scale-[0.99] transition-transform disabled:opacity-50"
                            >
                                {encoding ? `正在编码 ${encoding}…` : '＋ 上传参考图 / 导入 .naiv4vibe'}
                            </button>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*,.naiv4vibe,.vibe"
                                className="hidden"
                                onChange={e => {
                                    const file = e.target.files?.[0];
                                    if (file) void handleVibeFile(file);
                                }}
                            />
                        </div>
                    )}

                    <Field label="正面预设词" hint="拼在角色写的画面描述前面，每次都会带。">
                        <textarea
                            value={draft.positivePreset}
                            onChange={e => patch({ positivePreset: e.target.value })}
                            rows={3}
                            placeholder="masterpiece, best quality, ..."
                            className={inputClass + ' resize-none font-mono text-[12px]'}
                        />
                    </Field>

                    <Field label="负面预设词" hint="要和上面的 UC Preset 一起用：Preset 2（不加）时这里也不会生效。">
                        <textarea
                            value={draft.negativePreset}
                            onChange={e => patch({ negativePreset: e.target.value })}
                            rows={4}
                            placeholder="lowres, bad anatomy, ..."
                            className={inputClass + ' resize-none font-mono text-[12px]'}
                        />
                    </Field>

                    {testMsg && (
                        <div className={`text-xs px-3 py-2 rounded-xl leading-relaxed ${
                            testMsg.startsWith('✅') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
                        }`}>
                            {testMsg}
                        </div>
                    )}
                </div>

                <div className="shrink-0 px-5 pt-3 pb-5 border-t border-slate-100 space-y-2.5">
                    <div className="flex gap-3">
                        <button
                            type="button"
                            onClick={handleReset}
                            className="flex-1 py-3 rounded-2xl bg-slate-100 text-slate-600 font-bold text-sm active:scale-95 transition-transform"
                        >
                            恢复默认
                        </button>
                        <button
                            type="button"
                            onClick={handleSave}
                            className="flex-1 py-3 rounded-2xl bg-blue-500 text-white font-bold text-sm shadow-lg shadow-blue-500/20 active:scale-95 transition-transform"
                        >
                            保存设置
                        </button>
                    </div>
                    <button
                        type="button"
                        onClick={handleTest}
                        disabled={testing}
                        className="w-full py-3 rounded-2xl bg-emerald-50 text-emerald-600 font-bold text-sm border border-emerald-200 flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-50"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-4 h-4">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 19.5h16.5M7.5 7.5h.008v.008H7.5V7.5Z" />
                        </svg>
                        {testing ? '正在画一张测试图…' : '测试生图'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default NovelAiSettingsModal;
