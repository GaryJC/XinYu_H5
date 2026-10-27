import sharp from 'sharp';
import { zipSync, strToU8 } from 'fflate';
import { photoAlbumLabels } from '../../shared/orderPhotoAlbums.mjs';
const xml = value => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/[<>&"']/g, character => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[character]));
const paragraph = (text, size = 18, extra = '') => `<w:p><w:pPr>${extra}<w:spacing w:before="0" w:after="70"/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Microsoft YaHei"/><w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`;

// Minimal standards-based OOXML package. Images are embedded JPEGs, not remote links.
// Explicit page breaks and bounded image slots keep each A4 page at <= 5 photos.
export async function buildOrderPhotoDocument(order, photos, readPhoto) {
  const files = {};
  const body = [], relationships = [];
  for (let index=0;index<photos.length;index++) {
    const photo=photos[index], imageId=index+1;
    if(index%5===0) {
      body.push(paragraph(`${order.vehicle.plate || '未登记车牌'} 工单照片`,26,index?'<w:pageBreakBefore/>':''));
      body.push(paragraph(`派工号 ${order.dispatchNo || '未派工'}  第 ${Math.floor(index/5)+1} 页`));
    }
    const original=await readPhoto(photo.id);
    const {data,info}=await sharp(original).rotate().resize({width:1400,height:1000,fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'}).jpeg({quality:88}).toBuffer({resolveWithObject:true});
    const scale=Math.min(510/info.width,140/info.height);
    const cx=Math.round(info.width*scale*9525),cy=Math.round(info.height*scale*9525);
    files[`word/media/photo${imageId}.jpg`]=data;
    relationships.push(`<Relationship Id="photo${imageId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/photo${imageId}.jpg"/>`);
    body.push(`<w:p><w:pPr><w:keepNext/><w:spacing w:before="0" w:after="0"/><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${imageId}" name="照片 ${imageId}" descr="${xml(photo.originalName)}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${imageId}" name="照片 ${imageId}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="photo${imageId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`);
    const at=photo.createdAt?new Date(photo.createdAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'时间未记录';
    body.push(paragraph(`${imageId}. ${photoAlbumLabels[photo.category]} · ${photo.uploadedName || '上传人员未记录'}${photo.repairRound ? ` · 第 ${photo.repairRound} 轮` : ''} · ${at}`,16));
  }
  const put=(path,content)=>{files[path]=strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${content}`);};
  put('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  put('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="document" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  put('word/_rels/document.xml.rels',`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships.join('')}</Relationships>`);
  put('word/document.xml',`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="650" w:bottom="650" w:left="720" w:right="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  return Buffer.from(zipSync(files,{level:1}));
}
