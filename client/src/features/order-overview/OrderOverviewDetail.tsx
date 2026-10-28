import { OrderSupportingRecords } from "./OrderSupportingRecords";
import { useState } from 'react';
import { Alert, Button, Checkbox, Collapse, Descriptions, Empty, Grid, Image, Space, Spin, Table, Timeline } from 'antd';
import type { OrderPhotoCategory } from '../../../../shared/types';
import { collectOrderPhotoAlbums, photoAlbumLabels } from '../../../../shared/orderPhotoAlbums.mjs';
import { OrderDetail } from '../workbench/OrderDetail';
import { PartsRequirementSummary } from '../dispatch/PartsRequirementSummary';
import { RepairRoundHistory } from '../dispatch/RepairRoundHistory';
import { dispatchEventLabel, displayTime } from '../dispatch/dispatchLabels';
import { AuthenticatedImage } from '../../shared/ui/AuthenticatedImage';
import { useOrderOverview, useOrderPhotoExport } from './useOrderOverview';
import './order-overview.css';
const categories=Object.keys(photoAlbumLabels) as OrderPhotoCategory[];
export function OrderOverviewDetail({id}:{id:string}) {
  const {data,error,loading,retry}=useOrderOverview(id);
  const exporter=useOrderPhotoExport(id);
  const [selected,setSelected]=useState<OrderPhotoCategory[]>(categories);
  const screens=Grid.useBreakpoint();
  if(loading)return <Spin description="正在加载工单完整资料…"><div style={{minHeight:120}}/></Spin>;
  if(error||!data)return <Alert type="error" title={error||'无法加载工单'} action={<Button onClick={retry}>重试</Button>}/>;
  const {order,dispatch}=data;
  const albums=collectOrderPhotoAlbums(order,dispatch.files);
  const count=categories.reduce((sum,key)=>sum+albums[key].length,0);
  const selectedCount=selected.reduce((sum,key)=>sum+albums[key].length,0);
  const task=dispatch.task;
  return <div className="order-overview-detail">
    <section aria-label="照片下载"><h3>照片下载</h3>
      <p>每个 Word 文件包含本单所选照片，每页最多 4 张，双栏大图排版，按接车、维修时排序。接车包括行驶证、车况及纸质委托书；维修时包括维修过程、历史完工、配件和铭牌照片，不包含签名图片。</p>
      <Checkbox.Group aria-label="下载照片分类" value={selected} disabled={exporter.busy} onChange={values=>setSelected(values as OrderPhotoCategory[])} options={categories.map(key=>({label:`${photoAlbumLabels[key]}（${albums[key].length}）`,value:key}))}/>
      <Space wrap style={{margin:'12px 0'}}>
        <Button type="primary" loading={exporter.busy} disabled={!count} onClick={()=>void exporter.generate(categories)}>一键下载全部照片（{count}）</Button>
        <Button disabled={exporter.busy||!selectedCount} onClick={()=>void exporter.generate(selected)}>下载所选分类（{selectedCount}）</Button>
      </Space>
      {!count&&<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本单暂无照片"/>}
      {exporter.error&&<Alert showIcon type="error" title={exporter.error}/>}
      {exporter.download&&<Alert showIcon type="success" title={`已生成 ${exporter.download.photoCount} 张照片的 Word 文档`} description={<><p>下载链接 5 分钟内有效。钉钉内可保存到钉盘；无法下载时复制链接到浏览器打开。</p><a href={exporter.download.path} download={exporter.download.fileName}>下载 Word</a><p style={{wordBreak:'break-all',userSelect:'all'}}>{new URL(exporter.download.path,location.origin).href}</p></>}/>}
    </section>
    <Collapse items={categories.map(key=>({key,label:`${photoAlbumLabels[key]}照片（${albums[key].length}）`,children:<Image.PreviewGroup><div className="overview-photo-grid">{albums[key].map(photo=><div key={photo.id}><AuthenticatedImage fileId={photo.id} alt={`${photoAlbumLabels[key]}：${photo.originalName}`} width="100%" height={120}/><small>{photo.uploadedName} · {displayTime(photo.createdAt)}</small></div>)}</div>{!albums[key].length&&<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无照片"/>}</Image.PreviewGroup>}))}/>
    <h3>全部工单信息</h3>
    <OrderDetail order={order} isMobile={!screens.md} onUpdated={()=>retry()}/>
    <OrderSupportingRecords data={data}/>
    <h3>维修流程与配件</h3>
    <Descriptions bordered size="small" column={screens.md?2:1} items={[
      {key:'stage',label:'当前维修阶段',children:task.stage},
      {key:'worker',label:'维修人员',children:task.technicianName||'待派工'},
      {key:'inspector',label:'检验人员',children:task.inspectorName||'待检验'},
      {key:'hours',label:'实际工时',children:task.workHours===undefined?'未记录':`${task.workHours} 小时`},
      {key:'due',label:'预计完工',children:displayTime(task.dueAt)},
      {key:'completed',label:'维修完成',children:displayTime(task.completedAt)},
      {key:'pause',label:'暂停原因',children:[task.pauseReason,task.pauseNote].filter(Boolean).join('：')||'无'},
      {key:'note',label:'维修备注',children:task.note||'无'},
      {key:'submission',label:'完工说明',children:task.submissionNote||'无'},
      {key:'feedback',label:'反馈',children:task.feedback||'无'}
    ]}/>
    <Table rowKey="id" size="small" pagination={false} scroll={{x:'max-content'}} dataSource={task.items} columns={[
      {title:'维修项目',dataIndex:'name'},{title:'负责人',dataIndex:'responsibleName'},{title:'状态',dataIndex:'status'},
      {title:'开工',render:(_,item)=>displayTime(item.startAt)},{title:'提检',render:(_,item)=>displayTime(item.finishAt)},
      {title:'检验人',dataIndex:'inspectorName'},{title:'检验时间',render:(_,item)=>displayTime(item.inspectedAt)},{title:'退回原因',dataIndex:'rejectionReason'}
    ]}/>
    {(task.partsRequests?.length?task.partsRequests:[task.partsRequirement]).map((value,index)=><PartsRequirementSummary key={index} value={value}/>)}
    <RepairRoundHistory detail={dispatch}/>
    <h3>流程记录</h3>
    {dispatch.events.length?<Timeline items={dispatch.events.map(event=>({content:<><strong>{dispatchEventLabel(event)}</strong><p>{displayTime(event.at)} · {event.actorName} · {event.detail.stage}</p><p>{[event.detail.reason,event.detail.note,event.detail.pauseReason].filter(Boolean).join('；')}</p>{event.detail.technicianName&&<p>维修人员：{event.detail.technicianName}</p>}</>}))}/>:<p>暂无维修流程记录，开单与签字记录见操作留痕。</p>}
  </div>;
}
