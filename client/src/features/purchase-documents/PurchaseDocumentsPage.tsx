import { Alert,Button,Checkbox,Collapse,Input,InputNumber,Select,Space,Table,Tag } from 'antd';
import type { PurchaseDocumentRules } from '../../../../shared/types';
import { usePurchaseDocuments } from './usePurchaseDocuments';
import './purchase-documents.css';
export function PurchaseDocumentsPage(){
 const c=usePurchaseDocuments(),r=c.rules;
 const update=(patch:Partial<PurchaseDocumentRules>)=>r&&c.updateRules({...r,...patch});
 if(!r)return <Alert type={c.error?'error':'info'} title={c.error||'正在加载生成规则…'}/>;
 const num=(key:'fixedPercent'|'minPercent'|'maxPercent'|'minOriginalPrice',label:string,max=200)=><label>{label}<InputNumber aria-label={label} min={key==='minOriginalPrice'?0:1} max={max} precision={key==='minOriginalPrice'?2:0} value={r[key]} onChange={v=>update({[key]:v??0})}/></label>;
 return <div className="purchase-documents">
  {c.error&&<Alert type="error" showIcon title={c.error}/>}
  <fieldset disabled={c.busy} className="purchase-settings">
   <section className="panel purchase-upload"><h2>上传明细</h2><input aria-label="上传明细Excel或ZIP" type="file" accept=".xls,.xlsx,.zip" multiple disabled={c.busy} onChange={e=>void c.chooseFiles(Array.from(e.target.files||[]))}/><p>Excel／ZIP，合计最多8MB。支持配件名称、数量、单价表头。</p>{c.files.map((f,i)=><div className="purchase-file" key={i}>{f.name}</div>)}</section>
   <section className="panel"><h2>价格规则</h2><div className="purchase-fields">
    <label>价格模式<Select aria-label="价格模式" value={r.mode} onChange={mode=>update({mode})} options={[{value:'original',label:'与原报价一致'},{value:'fixed',label:'统一折算比例'},{value:'range',label:'区间浮动比例'}]}/></label>
    {r.mode==='fixed'&&num('fixedPercent','固定比例（%）')}
    {r.mode==='range'&&<>{num('minPercent','最低比例（%）')}{num('maxPercent','最高比例（%）')}</>}
    {(r.mode!=='original'||r.overrides.length>0)&&<label>新单价精度<Select aria-label="新单价精度" value={r.decimals} onChange={decimals=>update({decimals})} options={[{value:2,label:'保留两位小数'},{value:0,label:'四舍五入取整数'}]}/></label>}
   </div>{r.mode==='range'&&<p>同门店、同名称、同范围的比例固定，重复生成不变。名称仅忽略空格。</p>}
   <Collapse items={[{key:'overrides',label:`指定配件价格／比例（${r.overrides.length}）`,children:<div className="purchase-rule-list">{r.overrides.map((o,i)=><div className="purchase-override" key={i}>
    <Input aria-label={`配件名称${i+1}`} placeholder="配件名称，如清洗剂" value={o.name} onChange={e=>update({overrides:r.overrides.map((v,k)=>k===i?{...v,name:e.target.value}:v)})}/>
    <Select aria-label={`配件规则${i+1}`} value={o.kind} options={[{value:'percent',label:'固定比例（%）'},{value:'price',label:'固定单价（元）'}]} onChange={kind=>update({overrides:r.overrides.map((v,k)=>k===i?{...v,kind}:v)})}/>
    <InputNumber aria-label={`配件数值${i+1}`} min={0} max={o.kind==='percent'?200:10000000} value={o.value} onChange={value=>update({overrides:r.overrides.map((v,k)=>k===i?{...v,value:value??0}:v)})}/>
    <Button onClick={()=>update({overrides:r.overrides.filter((_,k)=>k!==i)})}>移除</Button></div>)}<Button onClick={()=>update({overrides:[...r.overrides,{name:'',kind:'percent',value:90}]})}>添加配件规则</Button></div>}]} />
   </section>
   <section className="panel"><h2>筛选与模板</h2><div className="purchase-fields">{num('minOriginalPrice','保留原单价不低于（元）',1000000)}<label>日期<Select aria-label="日期规则" value={r.dateMode} onChange={dateMode=>update({dateMode})} options={[{value:'source',label:'沿用明细日期'},{value:'blank',label:'留空'},{value:'fixed',label:'指定日期'}]}/></label>{r.dateMode==='fixed'&&<label>指定日期<Input aria-label="指定日期" type="date" value={r.date} onChange={e=>update({date:e.target.value})}/></label>}</div>
   <Space wrap>{(['excludeBattery','excludeTyre','excludeOil','splitPaint','splitHengyu'] as const).map((key,i)=><Checkbox key={key} checked={r[key]} onChange={e=>update({[key]:e.target.checked})}>{['排除电瓶','排除轮胎','排除机油','漆料单独列出','恒裕一半分给海鑫源'][i]}</Checkbox>)}</Space>
   <Collapse items={[
    {key:'exclude',label:'补充排除配件',children:<Input.TextArea aria-label="补充排除配件名称" placeholder="每行一个完整名称，不按关键词模糊删除" value={r.excludedNames} onChange={e=>update({excludedNames:e.target.value})}/>},
    {key:'templates',label:'车型模板映射',children:<div className="purchase-rule-list">{r.modelRules.map((rule,i)=><div className="purchase-model" key={i}><Input.TextArea aria-label={`车型组${i+1}`} value={rule.models} onChange={e=>update({modelRules:r.modelRules.map((v,k)=>k===i?{...v,models:e.target.value}:v)})}/><Select aria-label={`车型模板${i+1}`} value={rule.template} options={c.templates.map(value=>({value,label:value}))} onChange={template=>update({modelRules:r.modelRules.map((v,k)=>k===i?{...v,template}:v)})}/><Button onClick={()=>update({modelRules:r.modelRules.filter((_,k)=>k!==i)})}>移除</Button></div>)}<Button onClick={()=>update({modelRules:[...r.modelRules,{models:'',template:c.templates[0]}]})}>添加车型组</Button></div>}
   ]}/></section>
  </fieldset>
  <Space wrap><Button type="primary" disabled={!c.files.length||c.busy} loading={c.busy&&!c.preview} onClick={()=>void c.run('preview')}>识别并核对</Button><Button disabled={!c.preview?.canGenerate||c.busy} loading={c.busy&&!!c.preview} onClick={()=>void c.run('generate')}>生成Excel压缩包</Button>{c.download&&<a className="purchase-download" href={c.download} download="进货单.zip">下载进货单.zip</a>}</Space>
  {c.preview&&<section className="panel"><h2>核对结果</h2><Space wrap><Tag>明细 {c.preview.summary.documents} 张</Tag><Tag>生成 {c.preview.summary.generated} 张</Tag><Tag>保留 {c.preview.summary.kept} 行</Tag><Tag>排除 {c.preview.summary.excluded} 行</Tag><Tag>合计 ¥{c.preview.summary.total.toFixed(2)}</Tag></Space>
   {!c.preview.canGenerate&&<Alert type="warning" title="请处理下方错误，调整配置或修正源文件后重新识别"/>}
   <Table size="small" rowKey="id" dataSource={c.preview.docs} pagination={{pageSize:10,showSizeChanger:false}} scroll={{x:1050}} columns={[
    {title:'源文件／工作表',render:(_,d)=><>{d.file}<br/>{d.sheet}</>},{title:'内部编号',dataIndex:'code'},{title:'车型',dataIndex:'model'},{title:'模板',dataIndex:'template'},{title:'日期',dataIndex:'date'},{title:'配件／漆料',render:(_,d)=>`${d.kept} / ${d.paint}`},{title:'金额',dataIndex:'total'}]}/>
   <Collapse items={[{key:'lines',label:'逐行金额核对',children:<Table size="small" rowKey={i=>`${i.file}/${i.sheet}/${i.row}`} dataSource={c.preview.lines} pagination={{pageSize:10,showSizeChanger:false}} scroll={{x:760}} columns={[{title:'内部编号',dataIndex:'code'},{title:'配件',dataIndex:'name'},{title:'数量',dataIndex:'qty'},{title:'原单价',dataIndex:'price'},{title:'新单价',dataIndex:'newPrice'},{title:'金额',dataIndex:'amount'}]}/>},{key:'issues',label:`待核对事项（${c.preview.issues.length}）`,children:<div className="purchase-issues">{c.preview.issues.map((i,k)=><Alert key={k} type={i.severity==='error'?'error':'warning'} title={i.message} description={`${i.file} / ${i.sheet}${i.row?` / 第${i.row}行`:''}`}/>)}</div>},{key:'rates',label:'配件折算明细',children:<Table size="small" rowKey="name" dataSource={c.preview.rates} pagination={{pageSize:10,showSizeChanger:false}} columns={[{title:'配件',dataIndex:'name'},{title:'比例',render:(_,i)=>i.percent===null?'固定价格':`${i.percent}%`},{title:'固定单价',dataIndex:'price'}]}/>}]}/>
  </section>}
 </div>;
}
