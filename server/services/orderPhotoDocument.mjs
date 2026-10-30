import sharp from 'sharp';
import { zipSync, strToU8 } from 'fflate';
import { layoutOrderPhotos, PHOTO_PAGE_WIDTH, PHOTO_GAP } from './orderPhotoLayout.mjs';
const xml = value => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/[<>&"']/g, character => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[character]));

// Minimal standards-based OOXML package. Images are embedded JPEGs, not remote links.
// Rows adapt to image proportions without cropping or per-photo captions.
export async function buildOrderPhotoDocument(_order, photos, readPhoto) {
  const files = {};
  const body = [], relationships = [];
  const images = [];
  for (const photo of photos) {
    const original = await readPhoto(photo.id);
    const {data, info} = await sharp(original).rotate().resize({width:2000,height:2400,fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'}).jpeg({quality:90}).toBuffer({resolveWithObject:true});
    images.push({ data, width: info.width, height: info.height });
  }
  function imageParagraph(photo, imageId, width, height) {
    const {data}=images[imageId-1];
    const cx=width*635,cy=height*635;
    files[`word/media/photo${imageId}.jpg`]=data;
    relationships.push(`<Relationship Id="photo${imageId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/photo${imageId}.jpg"/>`);
    return `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/><w:rPr><w:sz w:val="2"/></w:rPr></w:pPr><w:r><w:rPr><w:sz w:val="2"/></w:rPr><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${imageId}" name="照片 ${imageId}" descr="${xml(photo.originalName)}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${imageId}" name="照片 ${imageId}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="photo${imageId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  }
  const pages = layoutOrderPhotos(images);
  for (const [pageIndex, rows] of pages.entries()) {
    if (pageIndex) body.push('<w:p><w:pPr><w:pageBreakBefore/><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr></w:p>');
    for (const row of rows) {
      // Each photo keeps its independent dimensions. Distribute unused row
      // width evenly instead of leaving a large gap before the final photo.
      const widths = row.map(cell => cell.width + PHOTO_GAP * 2);
      const spare = PHOTO_PAGE_WIDTH - widths.reduce((a, b) => a + b, 0);
      for (let i = 0; i < widths.length; i++) widths[i] += Math.floor(spare / widths.length) + (i < spare % widths.length ? 1 : 0);
      const cells = row.map((cell, index) => `<w:tc><w:tcPr><w:tcW w:w="${widths[index]}" w:type="dxa"/><w:vAlign w:val="top"/></w:tcPr>${imageParagraph(photos[cell.index],cell.index+1,cell.width,cell.height)}</w:tc>`);
      body.push(`<w:tbl><w:tblPr><w:tblW w:w="${PHOTO_PAGE_WIDTH}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="${PHOTO_GAP}" w:type="dxa"/><w:left w:w="${PHOTO_GAP}" w:type="dxa"/><w:bottom w:w="${PHOTO_GAP}" w:type="dxa"/><w:right w:w="${PHOTO_GAP}" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map(width=>`<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid><w:tr><w:trPr><w:cantSplit/></w:trPr>${cells.join('')}</w:tr></w:tbl>`);
      // Separate row grids and keep the mandatory paragraph negligible.
      body.push('<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr><w:r><w:rPr><w:sz w:val="2"/></w:rPr><w:t></w:t></w:r></w:p>');
    }
  }
  const put=(path,content)=>{files[path]=strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${content}`);};
  put('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  put('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="document" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  put('word/_rels/document.xml.rels',`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships.join('')}</Relationships>`);
  put('word/document.xml',`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="480" w:bottom="480" w:left="480" w:right="480" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  return Buffer.from(zipSync(files,{level:1}));
}
