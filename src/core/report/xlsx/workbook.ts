/**
 * 最小 xlsx 写出器:把通用工作簿模型写成 OOXML + zip。与「UI 测试」无关。
 *
 * 只覆盖本子系统用到的能力:内联字符串 / 数字、6 种样式、冻结首行、
 * 自动筛选、按单元格锚定的图片。以后换库或支持模板时,替换范围限于 xlsx/ 目录。
 */

import { buildZip, type ZipEntry } from './zip';

export type CellStyle = 'default' | 'header' | 'wrap' | 'pass' | 'fail' | 'skip';

export interface Cell {
  value: string | number;
  style?: CellStyle;
}

/** row / col 从 0 起。 */
export interface SheetImage {
  row: number;
  col: number;
  offsetXPx: number;
  widthPx: number;
  heightPx: number;
  data: Buffer;
  format: 'png' | 'jpeg';
}

export interface Sheet {
  name: string;
  columnWidths: number[];
  rows: { cells: Cell[]; heightPt?: number }[];
  freezeHeader: boolean;
  autoFilter: boolean;
  images: SheetImage[];
}

export interface Workbook {
  sheets: Sheet[];
}

/** 样式在 cellXfs 中的下标(顺序与 STYLES_XML 一致)。 */
const STYLE_INDEX: Record<CellStyle, number> = {
  default: 0,
  header: 1,
  wrap: 2,
  pass: 3,
  fail: 4,
  skip: 5,
};

/** 1 像素 = 9525 EMU。 */
const EMU_PER_PX = 9525;

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const STYLES_XML =
  XML_DECL +
  `<styleSheet xmlns="${NS_MAIN}">` +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="6">' +
  '<fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill>' +
  solidFill('FFE7E6E6') +
  solidFill('FFC6EFCE') +
  solidFill('FFFFC7CE') +
  solidFill('FFD9D9D9') +
  '</fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="6">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
  wrapXf(0) +
  wrapXf(3) +
  wrapXf(4) +
  wrapXf(5) +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

function solidFill(argb: string): string {
  return `<fill><patternFill patternType="solid"><fgColor rgb="${argb}"/><bgColor indexed="64"/></patternFill></fill>`;
}

function wrapXf(fillId: number): string {
  const applyFill = fillId === 0 ? '' : ' applyFill="1"';
  return (
    `<xf numFmtId="0" fontId="0" fillId="${fillId}" borderId="0" xfId="0"${applyFill} applyAlignment="1">` +
    '<alignment vertical="top" wrapText="1"/></xf>'
  );
}

/** XML 转义,并去掉 XML 1.0 不允许的控制字符(保留 \t \n \r)。 */
function esc(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 列号(0 起)→ 列字母。 */
function colName(col: number): string {
  let n = col + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function cellXml(cell: Cell, ref: string): string {
  const s = STYLE_INDEX[cell.style ?? 'default'];
  const sAttr = s === 0 ? '' : ` s="${s}"`;
  if (typeof cell.value === 'number') {
    return `<c r="${ref}"${sAttr}><v>${cell.value}</v></c>`;
  }
  return `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${esc(cell.value)}</t></is></c>`;
}

function sheetXml(sheet: Sheet, hasDrawing: boolean): string {
  const maxCols = Math.max(sheet.columnWidths.length, ...sheet.rows.map((r) => r.cells.length), 1);
  const lastRef = `${colName(maxCols - 1)}${Math.max(sheet.rows.length, 1)}`;
  const parts: string[] = [XML_DECL, `<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">`];
  parts.push(`<dimension ref="A1:${lastRef}"/>`);
  parts.push('<sheetViews><sheetView workbookViewId="0">');
  if (sheet.freezeHeader) {
    parts.push('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
    parts.push('<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>');
  }
  parts.push('</sheetView></sheetViews>');
  parts.push('<sheetFormatPr defaultRowHeight="15"/>');
  if (sheet.columnWidths.length > 0) {
    parts.push('<cols>');
    sheet.columnWidths.forEach((w, i) => {
      parts.push(`<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`);
    });
    parts.push('</cols>');
  }
  parts.push('<sheetData>');
  sheet.rows.forEach((row, r) => {
    const ht = row.heightPt === undefined ? '' : ` ht="${row.heightPt}" customHeight="1"`;
    parts.push(`<row r="${r + 1}"${ht}>`);
    row.cells.forEach((cell, c) => {
      parts.push(cellXml(cell, `${colName(c)}${r + 1}`));
    });
    parts.push('</row>');
  });
  parts.push('</sheetData>');
  if (sheet.autoFilter && sheet.rows.length > 0) {
    parts.push(`<autoFilter ref="A1:${lastRef}"/>`);
  }
  parts.push('<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>');
  if (hasDrawing) parts.push('<drawing r:id="rId1"/>');
  parts.push('</worksheet>');
  return parts.join('');
}

function drawingXml(images: SheetImage[]): string {
  const parts: string[] = [
    XML_DECL,
    '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" ' +
      'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">',
  ];
  images.forEach((img, i) => {
    const id = i + 1;
    const cx = Math.round(img.widthPx * EMU_PER_PX);
    const cy = Math.round(img.heightPx * EMU_PER_PX);
    parts.push(
      '<xdr:oneCellAnchor>' +
        `<xdr:from><xdr:col>${img.col}</xdr:col><xdr:colOff>${Math.round(img.offsetXPx * EMU_PER_PX)}</xdr:colOff>` +
        `<xdr:row>${img.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
        `<xdr:ext cx="${cx}" cy="${cy}"/>` +
        '<xdr:pic>' +
        `<xdr:nvPicPr><xdr:cNvPr id="${id + 1}" name="截图 ${id}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
        `<xdr:blipFill><a:blip xmlns:r="${NS_REL}" r:embed="rId${id}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
        `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>` +
        '</xdr:pic><xdr:clientData/></xdr:oneCellAnchor>',
    );
  });
  parts.push('</xdr:wsDr>');
  return parts.join('');
}

function relsXml(rels: { id: string; type: string; target: string }[]): string {
  return (
    XML_DECL +
    `<Relationships xmlns="${NS_PKG_REL}">` +
    rels.map((r) => `<Relationship Id="${r.id}" Type="${REL_TYPE}/${r.type}" Target="${r.target}"/>`).join('') +
    '</Relationships>'
  );
}

/** 把工作簿模型写成 xlsx 字节。 */
export function writeWorkbook(wb: Workbook): Buffer {
  const files: ZipEntry[] = [];
  const put = (name: string, content: string | Buffer): void => {
    files.push({ name, data: typeof content === 'string' ? Buffer.from(content, 'utf8') : content });
  };
  const overrides: string[] = [
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
  ];

  let mediaCount = 0;
  let drawingCount = 0;
  const media: ZipEntry[] = [];
  wb.sheets.forEach((sheet, i) => {
    const n = i + 1;
    const hasDrawing = sheet.images.length > 0;
    put(`xl/worksheets/sheet${n}.xml`, sheetXml(sheet, hasDrawing));
    overrides.push(
      `<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    );
    if (!hasDrawing) return;
    drawingCount += 1;
    const d = drawingCount;
    put(`xl/worksheets/_rels/sheet${n}.xml.rels`, relsXml([{ id: 'rId1', type: 'drawing', target: `../drawings/drawing${d}.xml` }]));
    put(`xl/drawings/drawing${d}.xml`, drawingXml(sheet.images));
    overrides.push(
      `<Override PartName="/xl/drawings/drawing${d}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`,
    );
    const drawingRels = sheet.images.map((img, k) => {
      mediaCount += 1;
      const file = `image${mediaCount}.${img.format}`;
      media.push({ name: `xl/media/${file}`, data: img.data });
      return { id: `rId${k + 1}`, type: 'image', target: `../media/${file}` };
    });
    put(`xl/drawings/_rels/drawing${d}.xml.rels`, relsXml(drawingRels));
  });

  put(
    '[Content_Types].xml',
    XML_DECL +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="png" ContentType="image/png"/>' +
      '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
      overrides.join('') +
      '</Types>',
  );
  put('_rels/.rels', relsXml([{ id: 'rId1', type: 'officeDocument', target: 'xl/workbook.xml' }]));
  put(
    'xl/workbook.xml',
    XML_DECL +
      `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><sheets>` +
      wb.sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
      '</sheets></workbook>',
  );
  put(
    'xl/_rels/workbook.xml.rels',
    relsXml([
      ...wb.sheets.map((_, i) => ({ id: `rId${i + 1}`, type: 'worksheet', target: `worksheets/sheet${i + 1}.xml` })),
      { id: `rId${wb.sheets.length + 1}`, type: 'styles', target: 'styles.xml' },
    ]),
  );
  put('xl/styles.xml', STYLES_XML);

  // [Content_Types].xml 放首位(部分读取方按顺序探测)
  const ordered = [
    ...files.filter((f) => f.name === '[Content_Types].xml'),
    ...files.filter((f) => f.name !== '[Content_Types].xml'),
    ...media,
  ];
  return buildZip(ordered);
}
