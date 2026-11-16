// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { extractDocxText, isDocxFile, isLegacyDocFile } from './docxText';

const DOCUMENT_XML_NAMESPACE = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

// 造一份最小可用的 .docx（zip 里只放 word/document.xml，真实 docx 还有别的文件但抽正文只看这个）。
const buildDocx = async (bodyXml: string): Promise<File> => {
    const zip = new JSZip();
    zip.file('word/document.xml', `<?xml version="1.0"?><w:document ${DOCUMENT_XML_NAMESPACE}><w:body>${bodyXml}</w:body></w:document>`);
    const blob = await zip.generateAsync({ type: 'blob' });
    return new File([blob], 'exam-scope.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
};

describe('docx 正文提取', () => {
    it('识别扩展名：.docx 是 docx，.doc 是旧版不是 docx', () => {
        expect(isDocxFile({ name: '考试范围.docx' })).toBe(true);
        expect(isDocxFile({ name: '考试范围.DOCX' })).toBe(true);
        expect(isDocxFile({ name: '考试范围.doc' })).toBe(false);
        expect(isLegacyDocFile({ name: '考试范围.doc' })).toBe(true);
        expect(isLegacyDocFile({ name: '考试范围.docx' })).toBe(false);
    });

    it('按段落抽取正文，制表符/换行标签转成对应字符', async () => {
        const file = await buildDocx(
            '<w:p><w:r><w:t>第一段：考试范围</w:t></w:r></w:p>' +
            '<w:p><w:r><w:t>姓名</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>分数</w:t></w:r></w:p>' +
            '<w:p><w:r><w:t>换行前</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>换行后</w:t></w:r></w:p>'
        );
        const text = await extractDocxText(file);
        expect(text).toBe('第一段：考试范围\n姓名\t分数\n换行前\n换行后');
    });

    it('没有正文或 XML 解析失败时报错，而不是静默返回空字符串', async () => {
        const emptyZip = new JSZip();
        const blob = await emptyZip.generateAsync({ type: 'blob' });
        const fileWithoutDocument = new File([blob], 'empty.docx');
        await expect(extractDocxText(fileWithoutDocument)).rejects.toThrow('没有在 Word 文件中找到正文');
    });
});
