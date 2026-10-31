"""Build the illustrated platform manual from Markdown. Requires reportlab and fonttools."""
import argparse
import copy
import json
import os
import re
import tempfile
from html import escape
from pathlib import Path
from urllib.parse import quote, urljoin

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, CondPageBreak, Frame, Image, KeepTogether, PageBreak, PageTemplate,
    Paragraph, Spacer, Table, TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source', type=Path, default=ROOT / 'doc/使用指南.md')
parser.add_argument('--output', type=Path, default=ROOT / 'doc/使用指南.pdf')
parser.add_argument('--font', default=os.environ.get('RESOLVER_DOC_FONT'))
parser.add_argument('--ref', default='codex/production-platform', help='GitHub ref used for relative PDF links')
args = parser.parse_args()
source = args.source.read_text(encoding='utf-8')
version = json.loads((ROOT / 'package.json').read_text())['version']
date = re.search(r'更新日期：([0-9-]+)', source).group(1)
font_path = Path(args.font) if args.font else ROOT / 'public/assets/font/NotoSansSC-VF.ttf'
if not font_path.is_file():
    raise SystemExit('CJK font missing. Pass --font /path/to/font.ttf.')

ink, muted, rule, wash, link = map(colors.HexColor, ['#181818', '#6b6b68', '#ddddda', '#f3f4f1', '#315f50'])
page_width, page_height = A4
margin = 42
available = page_width - 2 * margin - 12
repo = 'https://github.com/Albert-Li-Sz/Resolver-Web/blob/' + quote(args.ref, safe='/') + '/doc/'


def inline(text):
    text = escape(text, quote=False)
    def hyperlink(match):
        target = match[2]
        if not target.startswith(('http://', 'https://', '#')):
            target = urljoin(repo, target)
        return '<link href="' + escape(target, quote=True) + '" color="#315f50">' + match[1] + '</link>'
    text = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', hyperlink, text)
    text = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', text)
    return re.sub(r'`([^`]+)`', r'<font color="#315f50">\1</font>', text)


def register_fonts(directory):
    # Pin the bundled variable font to two real weights, rather than relying on
    # a PDF reader's variation-font support or the host operating system fonts.
    try:
        from fontTools import subset
        from fontTools.ttLib import TTFont as SourceFont
        from fontTools.varLib.instancer import instantiateVariableFont
    except ImportError as exc:
        raise SystemExit('Install dependencies: python -m pip install reportlab fonttools') from exc
    font = SourceFont(str(font_path))
    text = source + ''.join(chr(i) for i in range(32, 127)) + '目录操作说明书赛事制作台接入导播展示与滚榜四模块分支练习数据•'
    missing = sorted(set(text) - set(map(chr, font.getBestCmap())) - set('\n\r\t'))
    if missing:
        raise SystemExit('Font is missing glyphs: ' + repr(''.join(missing)))
    cutter = subset.Subsetter()
    cutter.populate(text=text)
    cutter.subset(font)
    for name, weight in [('ManualCN', 400), ('ManualCNBold', 650)]:
        face = instantiateVariableFont(font, {'wght': weight}, inplace=False) if 'fvar' in font else copy.deepcopy(font)
        target = Path(directory) / (name + '.ttf')
        face.save(target)
        pdfmetrics.registerFont(TTFont(name, str(target)))
        face.close()
    font.close()
    pdfmetrics.registerFontFamily('ManualCN', normal='ManualCN', bold='ManualCNBold', italic='ManualCN', boldItalic='ManualCNBold')


def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(rule)
    canvas.line(margin, page_height - 31, page_width - margin, page_height - 31)
    canvas.setFillColor(muted)
    canvas.setFont('ManualCN', 8)
    canvas.drawString(margin, page_height - 23, 'ICPC 赛事制作台 | 操作说明书')
    canvas.drawString(margin, 23, date + ' · 四模块分支')
    canvas.drawRightString(page_width - margin, 23, str(doc.page))
    canvas.restoreState()


class ManualDocument(BaseDocTemplate):
    def afterFlowable(self, flowable):
        key = getattr(flowable, 'manual_bookmark', None)
        if key:
            title = flowable.getPlainText()
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(title, key, level=0, closed=False)
            self.notify('TOCEntry', (0, title, self.page, key))


def build():
    styles = {
        'body': ParagraphStyle('body', fontName='ManualCN', fontSize=10, leading=16.4, textColor=ink, spaceAfter=8, wordWrap='CJK'),
        'title': ParagraphStyle('title', fontName='ManualCNBold', fontSize=31, leading=43, textColor=ink, spaceAfter=14, wordWrap='CJK'),
        'subtitle': ParagraphStyle('subtitle', fontName='ManualCN', fontSize=15, leading=24, textColor=muted, spaceAfter=18, wordWrap='CJK'),
        'h2': ParagraphStyle('h2', fontName='ManualCNBold', fontSize=21, leading=31, textColor=ink, spaceAfter=16, keepWithNext=True, wordWrap='CJK'),
        'h3': ParagraphStyle('h3', fontName='ManualCNBold', fontSize=12, leading=19, textColor=ink, spaceBefore=12, spaceAfter=7, keepWithNext=True, wordWrap='CJK'),
        'caption': ParagraphStyle('caption', fontName='ManualCN', fontSize=8, leading=12, textColor=muted, alignment=TA_CENTER, spaceBefore=6, spaceAfter=13, wordWrap='CJK'),
        'cell': ParagraphStyle('cell', fontName='ManualCN', fontSize=9, leading=14, textColor=ink, wordWrap='CJK'),
        'head': ParagraphStyle('head', fontName='ManualCNBold', fontSize=9, leading=14, textColor=ink, wordWrap='CJK'),
        'code': ParagraphStyle('code', fontName='ManualCN', fontSize=8, leading=12.5, textColor=ink, wordWrap='CJK'),
        'list': ParagraphStyle('list', fontName='ManualCN', fontSize=10, leading=16.4, textColor=ink, spaceAfter=7, leftIndent=13, firstLineIndent=-13, wordWrap='CJK'),
    }
    story = [Spacer(1, 70), Paragraph('ICPC 赛事制作台', styles['title']), Paragraph('操作说明书', styles['title']), Spacer(1, 12),
             Paragraph('DOMjudge 与 Hydro + CCS API 接入<br/>导播 · 多屏展示 · 赛后滚榜', styles['subtitle']),
             Paragraph(inline('适用分支：`' + args.ref + '`'), styles['body']),
             Paragraph('包版本 ' + version + ' · ' + date, styles['body']), Spacer(1, 22),
             Paragraph('面向赛事管理员、导播、滚榜主持人和大屏操作员。截图使用合成练习数据，示例地址需要替换为现场实际地址。', styles['body']),
             Paragraph('该分支仍在进行现场验收，不代表已经发布新的稳定版本。', styles['body']), Spacer(1, 16),
             Paragraph(inline('[项目与源码](https://github.com/Albert-Li-Sz/Resolver-Web) · [在线说明书](' + repo + '使用指南.md)'), styles['body']), PageBreak(),
             Paragraph('目录', styles['h2'])]
    toc = TableOfContents()
    toc.levelStyles = [ParagraphStyle('toc', fontName='ManualCN', fontSize=10.5, leading=22, textColor=ink, leftIndent=0, firstLineIndent=0, spaceBefore=3, wordWrap='CJK')]
    story.extend([toc, PageBreak()])
    lines = source.splitlines()
    i = next(n for n, line in enumerate(lines) if line.startswith('## '))
    chapter = 0
    while i < len(lines):
        text = lines[i].strip()
        if not text:
            i += 1
            continue
        if text.startswith('## '):
            if chapter:
                story.extend([CondPageBreak(180), Spacer(1, 20)])
            chapter += 1
            title = Paragraph(inline(text[3:]), styles['h2'])
            title.manual_bookmark = 'chapter-' + str(chapter)
            story.append(title)
            i += 1
            continue
        if text.startswith('### '):
            story.append(Paragraph(inline(text[4:]), styles['h3']))
            i += 1
            continue
        if text.startswith('```'):
            code = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith('```'):
                code.append(escape(lines[i], quote=False).replace(' ', '&#160;') or '&#160;')
                i += 1
            if i == len(lines):
                raise ValueError('Unclosed code fence')
            block = Table([[Paragraph('<br/>'.join(code), styles['code'])]], colWidths=[available], hAlign='LEFT')
            block.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), wash), ('BOX', (0, 0), (-1, -1), .4, rule), ('LEFTPADDING', (0, 0), (-1, -1), 10), ('RIGHTPADDING', (0, 0), (-1, -1), 10), ('TOPPADDING', (0, 0), (-1, -1), 8), ('BOTTOMPADDING', (0, 0), (-1, -1), 8)]))
            story.extend([KeepTogether([block]), Spacer(1, 10)])
            i += 1
            continue
        image = re.fullmatch(r'!\[([^\]]*)\]\(([^)]+)\)', text)
        if image:
            path = args.source.parent / image[2]
            picture = Image(str(path))
            max_height = 400 if picture.imageHeight > picture.imageWidth * .8 else 250
            scale = min(available / picture.imageWidth, max_height / picture.imageHeight)
            picture.drawWidth, picture.drawHeight = picture.imageWidth * scale, picture.imageHeight * scale
            picture.hAlign = 'CENTER'
            story.append(KeepTogether([Spacer(1, 4), picture, Paragraph(escape(image[1]), styles['caption'])]))
            i += 1
            continue
        if text.startswith('|'):
            rows = []
            while i < len(lines) and lines[i].strip().startswith('|'):
                cells = [cell.strip() for cell in lines[i].strip().strip('|').split('|')]
                if not all(re.fullmatch(r':?-+:?', cell) for cell in cells):
                    style = styles['head'] if not rows else styles['cell']
                    rows.append([Paragraph(inline(cell), style) for cell in cells])
                i += 1
            columns = len(rows[0])
            first = .34 if '现象' in rows[0][0].getPlainText() else .29
            widths = [available * first, available * (1 - first)] if columns == 2 else [available / columns] * columns
            table = Table(rows, colWidths=widths, repeatRows=1, hAlign='LEFT')
            table.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'), ('BACKGROUND', (0, 0), (-1, 0), wash), ('LINEBELOW', (0, 0), (-1, -1), .4, rule), ('LEFTPADDING', (0, 0), (-1, -1), 9), ('RIGHTPADDING', (0, 0), (-1, -1), 9), ('TOPPADDING', (0, 0), (-1, -1), 7), ('BOTTOMPADDING', (0, 0), (-1, -1), 7)]))
            story.extend([table, Spacer(1, 10)])
            continue
        if text.startswith('- ') or re.match(r'^\d+\. ', text):
            rendered = '• ' + text[2:] if text.startswith('- ') else text
            story.append(Paragraph(inline(rendered), styles['list']))
            i += 1
            continue
        paragraph = [text]
        i += 1
        while i < len(lines) and lines[i].strip() and not re.match(r'^(#{2,3} |\||!\[|- |\d+\. |```)', lines[i].strip()):
            paragraph.append(lines[i].strip())
            i += 1
        story.append(Paragraph(inline(' '.join(paragraph)), styles['body']))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    document = ManualDocument(str(args.output), pagesize=A4, leftMargin=margin, rightMargin=margin, topMargin=49, bottomMargin=43, title='ICPC 赛事制作台操作说明书', author='ICPC 赛事制作台', subject='DOMjudge、Hydro CCS API 接入与四模块操作', pageCompression=1)
    frame = Frame(document.leftMargin, document.bottomMargin, document.width, document.height, id='body')
    document.addPageTemplates(PageTemplate(id='manual', frames=[frame], onPage=footer))
    document.multiBuild(story)
    print(args.output)


if __name__ == '__main__':
    with tempfile.TemporaryDirectory(prefix='resolver-manual-') as directory:
        register_fonts(directory)
        build()
