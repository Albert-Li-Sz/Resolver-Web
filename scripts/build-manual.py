"""Render doc/使用指南.md to a screenshot-based PDF. Requires reportlab and a CJK TTF."""
import argparse
import json
import os
import re
from html import escape
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image, Table, TableStyle, PageBreak, KeepTogether

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / 'package.json').read_text())['version']
DOC_DATE = '2026-10-29'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--font', default=os.environ.get('RESOLVER_DOC_FONT'))
args = parser.parse_args()
choices = [args.font, str(Path.home() / 'Library/Fonts/微软雅黑.ttf'), '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc', 'C:/Windows/Fonts/msyh.ttc']
font = next((p for p in choices if p and Path(p).is_file()), None)
if not font:
    raise SystemExit('Pass --font /path/to/a-CJK-font.ttf, or set RESOLVER_DOC_FONT.')
pdfmetrics.registerFont(TTFont('ManualCN', font))
pdfmetrics.registerFontFamily('ManualCN', normal='ManualCN', bold='ManualCN', italic='ManualCN', boldItalic='ManualCN')
blue, ink, muted, line = map(colors.HexColor, ['#141413', '#262627', '#696969', '#d9d4ce'])
styles = {
    'body': ParagraphStyle('body', fontName='ManualCN', fontSize=10, leading=16, textColor=ink, spaceAfter=7, wordWrap='CJK'),
    'title': ParagraphStyle('title', fontName='ManualCN', fontSize=28, leading=40, textColor=ink, spaceAfter=18, wordWrap='CJK'),
    'h2': ParagraphStyle('h2', fontName='ManualCN', fontSize=19, leading=28, textColor=blue, spaceAfter=12, keepWithNext=True, wordWrap='CJK'),
    'caption': ParagraphStyle('caption', fontName='ManualCN', fontSize=8, leading=12, textColor=muted, alignment=TA_CENTER, spaceAfter=10, wordWrap='CJK'),
    'cell': ParagraphStyle('cell', fontName='ManualCN', fontSize=9, leading=14, textColor=ink, wordWrap='CJK'),
}
page_size = landscape(A4)
width, height = page_size
available = width - 92  # account for the frame's inner padding
repo = 'https://github.com/Albert-Li-Sz/Resolver-Web/blob/main/doc/'

def inline(text):
    text = escape(text)
    text = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', lambda m: f'<link href="{escape(m[2] if m[2].startswith("http") else repo + m[2], quote=True)}" color="#9a3a0a">{m[1]}</link>', text)
    text = re.sub(r'\*\*(.*?)\*\*', r'<b>\1</b>', text)
    return re.sub(r'`([^`]+)`', r'<font color="#9a3a0a">\1</font>', text)

def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(line)
    canvas.line(40, height - 32, width - 40, height - 32)
    canvas.setFont('ManualCN', 8)
    canvas.setFillColor(muted)
    canvas.drawString(40, height - 23, 'Resolver Web | 图文使用指南')
    canvas.drawString(40, 22, f'v{VERSION} · {DOC_DATE} · 实测截图 / 合成练习数据')
    canvas.drawRightString(width - 40, 22, str(doc.page))
    canvas.restoreState()

def block_height(item):
    if isinstance(item, KeepTogether):
        return sum(block_height(child) for child in item._content)
    return item.wrap(available, 10000)[1] + item.getSpaceBefore() + item.getSpaceAfter()

source = (ROOT / 'doc/使用指南.md').read_text()
sections = re.split(r'^## ', source, flags=re.M)
story = [Spacer(1, 45), Paragraph('Resolver Web', styles['title']), Paragraph('图文使用指南', styles['h2']),
         Paragraph('从导入赛事，到主持滚榜与观众同步', styles['body']), Spacer(1, 14),
         Paragraph(f'版本 {VERSION} · {DOC_DATE}', styles['body']),
         Paragraph('本指南适用于赛事主持人、现场转播操作员与部署管理员。界面截图来自 Browser 实测，部分展示较早版本界面；示例成绩为合成练习数据。', styles['body']), Spacer(1, 18),
         Paragraph('阅读顺序', styles['h2']),
         Paragraph('1 打开配置中心　2 导入赛事　3 准备素材　4 显示与奖项<br/>5 手动预览　6 配置管理　7 主持滚榜　8 分享观众链接　9 收尾与排错', styles['body']), Spacer(1, 16),
         Paragraph('<link href="https://github.com/Albert-Li-Sz/Resolver-Web" color="#9a3a0a">项目、示例下载及部署教程：github.com/Albert-Li-Sz/Resolver-Web</link>', styles['body'])]

for section in sections[1:]:
    lines = section.strip().splitlines()
    heading = lines.pop(0)
    section_start = len(story)
    story.extend(([Spacer(1, 16)] if heading == '资料' else [PageBreak()]) + [Paragraph(inline(heading), styles['h2'])])
    i = 0
    while i < len(lines):
        text = lines[i].strip()
        if not text:
            i += 1
            continue
        if text.startswith('- '):
            story.append(Paragraph('• ' + inline(text[2:]), styles['body']))
            i += 1
            continue
        image_match = re.fullmatch(r'!\[([^\]]*)\]\(([^)]+)\)', text)
        if image_match:
            path = ROOT / 'doc' / image_match[2]
            picture = Image(str(path))
            # Keep the original pixels; readers can zoom into every screenshot.
            scale = min(available / picture.imageWidth, 310 / picture.imageHeight)
            picture.drawWidth, picture.drawHeight = picture.imageWidth * scale, picture.imageHeight * scale
            picture.hAlign = 'CENTER'
            story.append(KeepTogether([Spacer(1, 5), picture, Spacer(1, 5), Paragraph(escape(image_match[1]), styles['caption'])]))
            i += 1
            continue
        if text.startswith('|'):
            rows = []
            while i < len(lines) and lines[i].strip().startswith('|'):
                row = [cell.strip() for cell in lines[i].strip().strip('|').split('|')]
                if not all(re.fullmatch(r':?-+:?', cell) for cell in row):
                    rows.append([Paragraph(inline(cell), styles['cell']) for cell in row])
                i += 1
            columns = len(rows[0])
            widths = [available * .26, available * .74] if columns == 2 else [available / columns] * columns
            table = Table(rows, colWidths=widths, repeatRows=1, hAlign='LEFT')
            table.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'), ('BOTTOMPADDING', (0, 0), (-1, -1), 7), ('TOPPADDING', (0, 0), (-1, -1), 7), ('LEFTPADDING', (0, 0), (-1, -1), 10), ('RIGHTPADDING', (0, 0), (-1, -1), 10), ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#edf5ff')), ('LINEBELOW', (0, 0), (-1, -1), .4, line)]))
            story.extend([table, Spacer(1, 10)])
            continue
        paragraph = [text]
        i += 1
        while i < len(lines) and lines[i].strip() and not lines[i].strip().startswith(('|', '![', '- ')):
            paragraph.append(lines[i].strip())
            i += 1
        story.append(Paragraph(inline(' '.join(paragraph)), styles['body']))

    # Fit one chapter to one page, instead of stranding a short paragraph on
    # a nearly empty continuation page. Screenshot pixels remain embedded.
    blocks = story[section_start + 1:]
    pictures = [child for block in blocks if isinstance(block, KeepTogether)
                for child in block._content if isinstance(child, Image)]
    excess = sum(block_height(block) for block in blocks) - (height - 104)
    if excess > 0 and pictures:
        for picture in pictures:
            ratio = picture.drawWidth / picture.drawHeight
            picture.drawHeight = max(140, picture.drawHeight - excess / len(pictures) - 8)
            picture.drawWidth = ratio * picture.drawHeight

target = ROOT / 'doc/使用指南.pdf'
document = SimpleDocTemplate(str(target), pagesize=page_size, leftMargin=40, rightMargin=40, topMargin=48, bottomMargin=42,
                             title='Resolver Web 图文使用指南', author='Resolver Web', subject='上传、配置、预览、主持滚榜与观众同步')
document.build(story, onFirstPage=footer, onLaterPages=footer)
print(target)
