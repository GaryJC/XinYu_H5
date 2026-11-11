import {useState} from 'react';
import {Alert,Badge,Button,Empty,Segmented,Spin,Tabs} from 'antd';
import {Bell,CheckCheck,ChevronRight,RefreshCw} from 'lucide-react';
import type {PersonalBusinessTarget} from '../../../../shared/types';
import {usePersonalWorkbench} from './usePersonalWorkbench';
import './personalWorkbench.css';
export type PersonalWorkbenchController=ReturnType<typeof usePersonalWorkbench>;
export function openPersonalTarget(target:PersonalBusinessTarget) {
 const url=new URL(location.href);
 for(const key of ['dispatchOrder','dispatchSection','workOrder','paperOrder','vehicleTrip','procurementTender','procurementReport'])url.searchParams.delete(key);
 url.searchParams.set(target.targetKey,target.targetId);
 location.assign(url.href);
}
export function PersonalMessageBell({controller:c,onOpen}:{controller:PersonalWorkbenchController;onOpen:()=>void}) {
 return <Badge className="personal-message-entry" count={c.data?.unread||0} overflowCount={99}><Button className="personal-message-bell" aria-label={`消息，${c.data?.unread??0} 条未读`} icon={<Bell size={20}/>} onClick={onOpen}/></Badge>;
}
export function PersonalNotificationPage({controller:c}:{controller:PersonalWorkbenchController}) {
 const [tab,setTab]=useState('消息');
 const inbox=<div className="personal-inbox">
   <div className="personal-inbox-toolbar"><Segmented size="small" options={[{label:'未读',value:true},{label:'全部',value:false}]} value={c.unreadOnly} onChange={v=>c.setUnreadOnly(Boolean(v))}/><Button type="primary" className="personal-read-all" icon={<CheckCheck size={16} aria-hidden="true"/>} disabled={!c.data?.unread} onClick={()=>void c.markRead()}>全部已读</Button></div>
   {c.messageError&&<Alert type="warning" title={c.messageError} action={<Button onClick={c.refresh}>重试</Button>}/>}
   {c.loading&&!c.messages.length?<Spin/>:!c.messages.length?<Empty className="personal-empty" image={<Bell size={28} strokeWidth={1.5}/>} description={c.unreadOnly?'暂无未读消息':'暂无消息'}/>:null}
   <div className="personal-message-list">{c.messages.map(message=><article className={`personal-message ${message.readAt?'':'is-unread'}`} key={message.id}>
    <button type="button" className="personal-message-link" onClick={()=>{void (async()=>{if(message.readAt||await c.markRead(message.id))openPersonalTarget(message);})();}}>
     <div className="personal-message-heading"><strong>{message.title}</strong>{!message.readAt&&<span className="personal-unread-dot" aria-label="未读"/>}</div>
     {message.plate&&<span className="personal-message-plate">{message.plate}</span>}
     {message.summary&&<p>{message.summary}</p>}
    </button>
    <footer className="personal-message-footer"><time>{new Date(message.createdAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</time><div className="personal-message-actions">
     {!message.readAt&&<Button type="text" className="personal-read-action" aria-label={`标为已读：${message.title}`} title="标为已读" onClick={()=>void c.markRead(message.id)}>标为已读</Button>}
    </div></footer>
   </article>)}</div>
   {c.cursor&&<Button block loading={c.loading} onClick={()=>void c.more()}>加载更多</Button>}
  </div>;
 return <section className="personal-notification-page">
  <Tabs className="personal-page-tabs" activeKey={tab} onChange={setTab} destroyOnHidden items={[
   {key:'消息',label:<span className="personal-tab-label">消息{Boolean(c.data?.unread)&&<span className="personal-tab-count">{c.data!.unread}</span>}</span>,children:inbox},
   {key:'待办',label:'我的待办',children:<PersonalTodoPanel controller={c}/>}
  ]}/>
 </section>;
}
export function PersonalTodoPanel({controller:c}:{controller:PersonalWorkbenchController}) {
 const [category,setCategory]=useState('全部');const [limit,setLimit]=useState(20);
 const todos=c.data?.todos||[];
 const categories=[...new Set(todos.map(t=>t.category))];
 const selected=category==='全部'||categories.includes(category)?category:'全部';
 const visible=todos.filter(t=>selected==='全部'||t.category===selected);
 return <section className="personal-todo-panel" aria-label="我的待办">
  <div className="workbench-section-heading"><h2>我的待办 <span className="personal-total">{c.data?todos.length:'—'}</span></h2><Button type="text" aria-label="刷新我的待办" icon={<RefreshCw size={17}/>} onClick={c.refresh}/></div>
  {c.error&&<Alert type="warning" title="更新失败，当前内容可能不是最新" description={c.error} action={<Button onClick={c.refresh}>重试</Button>}/>}
  {c.data&&todos.length>0&&<div className="personal-todo-filters" aria-label="待办分类">{['全部',...categories].map(name=><button type="button" aria-pressed={selected===name} key={name} onClick={()=>{setCategory(name);setLimit(20);}}>{name}<span>{name==='全部'?todos.length:todos.filter(t=>t.category===name).length}</span></button>)}</div>}
  {!c.data&&!c.error?<Spin/>:c.data&&!todos.length?<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无待办"/>:null}
  <div className="personal-todo-list">{visible.slice(0,limit).map(todo=><button type="button" className="personal-todo-row" key={todo.id} onClick={()=>openPersonalTarget(todo)}><div><span className="personal-todo-category">{todo.category}</span><strong>{todo.title}</strong>{todo.summary&&<p>{todo.summary}</p>}</div><ChevronRight size={18} aria-hidden="true"/></button>)}</div>
  {visible.length>limit&&<Button block onClick={()=>setLimit(v=>v+20)}>查看更多</Button>}
 </section>;
}
