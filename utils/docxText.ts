// .docx 正文抽取：docx 本质是个 zip，正文在 word/document.xml 里。跟
// features/collaboration/files.ts 的 extractDocxText 同一个实现，抽到这里给
// StudyApp（导入课件/考前冲刺课件）复用，避免两边各写一份、改一处漏一处。
import JSZip from 'jszip';

export const isDocxFile = (file: Pick<File, 'name'>): boolean => /\.docx$/i.test(file.name);

/** 旧版 .doc（二进制格式，不是 zip）暂不支持；调用方应先用 isDocxFile 排除它。 */
export const isLegacyDocFile = (file: Pick<File, 'name'>): boolean => /\.doc$/i.test(file.name) && !isDocxFile(file);

export const extractDocxText = async (file: File): Promise<string> => {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const documentXml = await zip.file('word/document.xml')?.async('string');
    if (!documentXml) throw new Error('没有在 Word 文件中找到正文');
    const xml = new DOMParser().parseFromString(documentXml, 'application/xml');
    if (xml.querySelector('parsererror')) throw new Error('Word 文件正文无法解析');
    const paragraphs = Array.from(xml.getElementsByTagNameNS('*', 'p'));
    return paragraphs.map(paragraph => {
        const pieces: string[] = [];
        Array.from(paragraph.getElementsByTagName('*')).forEach(node => {
            const name = node.localName;
            if (name === 't') pieces.push(node.textContent || '');
            else if (name === 'tab') pieces.push('\t');
            else if (name === 'br' || name === 'cr') pieces.push('\n');
        });
        return pieces.join('');
    }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
};
