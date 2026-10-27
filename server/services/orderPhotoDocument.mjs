import sharp from 'sharp';
import { zipSync, strToU8 } from 'fflate';
const xml = value => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/[<>&"']/g, character => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[character]));

// Minimal standards-based OOXML package. Images are embedded JPEGs, not remote links.
// Two-column pages hold up to four large photos with no per-photo captions.
export async function buildOrderPhotoDocument(_order, photos, readPhoto) {
  const files = {};
  const body = [], relationships = [];
  async function imageParagraph(photo, imageId, width, height) {
    const original=await readPhoto(photo.id);
    const {data,info}=await sharp(original).rotate().resize({width:2000,height:2400,fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'}).jpeg({quality:90}).toBuffer({resolveWithObject:true});
    const scale=Math.min(width/info.width,height/info.height);
    const cx=Math.round(info.width*scale*9525),cy=Math.round(info.height*scale*9525);
    files[`word/media/photo${imageId}.jpg`]=data;
    relationships.push(`<Relationship Id="photo${imageId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/photo${imageId}.jpg"/>`);
    return `<w:p><w:pPr><w:spacing w:before="0" w:after="40"/><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${imageId}" name="照片 ${imageId}" descr="${xml(photo.originalName)}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${imageId}" name="照片 ${imageId}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="photo${imageId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  }
  for (let start=0;start<photos.length;start+=4) {
    const page=photos.slice(start,start+4);
    if(start) body.push('<w:p><w:pPr><w:pageBreakBefore/><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr></w:p>');
    const columns=2;
    const rows=Math.ceil(page.length/columns);
    const cellWidth=Math.floor(10946/columns);
    const height=470;
    const tableRows=[];
    for(let row=0;row<rows;row++) {
      const cells=[];
      for(let column=0;column<columns;column++) {
        const offset=row*columns+column,photo=page[offset];
        const content=photo?await imageParagraph(photo,start+offset+1,350,height):'<w:p/>';
        cells.push(`<w:tc><w:tcPr><w:tcW w:w="${cellWidth}" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>${content}</w:tc>`);
      }
      tableRows.push(`<w:tr><w:trPr><w:cantSplit/></w:trPr>${cells.join('')}</w:tr>`);
    }
    body.push(`<w:tbl><w:tblPr><w:tblW w:w="10946" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="60" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="60" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${Array.from({length:columns},()=>`<w:gridCol w:w="${cellWidth}"/>`).join('')}</w:tblGrid>${tableRows.join('')}</w:tbl>`);
    // Word requires a paragraph after a table; keep it too small to create a blank page.
    body.push('<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr><w:r><w:rPr><w:sz w:val="2"/></w:rPr><w:t></w:t></w:r></w:p>');
  }
  const put=(path,content)=>{files[path]=strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${content}`);};
  put('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  put('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="document" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  put('word/_rels/document.xml.rels',`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships.join('')}</Relationships>`);
  put('word/document.xml',`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="480" w:bottom="480" w:left="480" w:right="480" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  return Buffer.from(zipSync(files,{level:1}));
}
