import {useState,useEffect} from 'react';
import {Alert,Badge,Button,Empty,Segmented,Spin,Tabs} from 'antd';
import {Bell,CheckCheck,ChevronRight,RefreshCw} from 'lucide-react';
import type {PersonalBusinessTarget} from '../../../../shared/types';
import {usePersonalWorkbench} from './usePersonalWorkbench';
import './personalWorkbench.css';
export type PersonalWorkbenchController=ReturnType<typeof usePersonalWorkbench>;
export function openPersonalTarget(target:PersonalBusinessTarget) {
 const url=new URL(location.href);
 for(const key of ['personalTasks','dispatchOrder','dispatchSection','workOrder','paperOrder','vehicleTrip','procurementTender','procurementReport'])url.searchParams.delete(key);
 url.searchParams.set(target.targetKey,target.targetId);
 location.assign(url.href);
}
export function PersonalMessageBell({controller:c,onOpen}:{controller:PersonalWorkbenchController;onOpen:()=>void}) {
 return <Badge className="personal-message-entry" count={(c.data?.todoCount||0)+(c.data?.unread||0)} overflowCount={99}><Button className="personal-message-bell" aria-label={`我的事项，${c.data?.todoCount??0} 项待处理，${c.data?.unread??0} 条未读通知`} icon={<Bell size={20}/>} onClick={onOpen}/></Badge>;
}
export function PersonalNotificationPage({controller:c}:{controller:PersonalWorkbenchController}) {
 const [tab,setTab]=useState('待办');
 useEffect(()=>{c.setInboxOpen(tab==='消息');return()=>c.setInboxOpen(false);},[tab,c.setInboxOpen]);
 const inbox=<div className="personal-inbox">
   <div className="personal-inbox-toolbar"><Segmented size="small" options={[{label:'未读',value:true},{label:'全部',value:false}]} value={c.unreadOnly} onChange={v=>c.setUnreadOnly(Boolean(v))}/><Button type="primary" className="personal-read-all" icon={<CheckCheck size={16} aria-hidden="true"/>} disabled={!c.data?.unread} onClick={()=>void c.markRead()}>全部已读</Button></div>
   {c.messageError&&<Alert type="warning" title={c.messageError} action={<Button onClick={c.refresh}>重试</Button>}/>}
   {c.loading&&!c.messages.length?<Spin/>:!c.messages.length?<Empty className="personal-empty" image={<Bell size={28} strokeWidth={1.5}/>} description={c.unreadOnly?'暂无未读结果通知':'暂无结果通知'}/>:null}
   <div className="personal-message-list">{c.messages.map(message=><article className={`personal-message ${message.readAt||message.noticeKind==='action'?'':'is-unread'}`} key={message.id}>
    <button type="button" className="personal-message-link" onClick={()=>{void (async()=>{if(message.readAt||await c.markRead(message.id))openPersonalTarget(message);})();}}>
     <div className="personal-message-heading"><strong>{message.title}</strong>{!message.readAt&&message.noticeKind!=='action'&&<span className="personal-unread-dot" aria-label="未读"/>}</div>
     {message.plate&&<span className="personal-message-plate">{message.plate}</span>}
     {message.summary&&<p>{message.summary}</p>}
    </button>
    <footer className="personal-message-footer"><time>{new Date(message.createdAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</time><div className="personal-message-actions">
     {!message.readAt&&message.noticeKind!=='action'&&<Button type="text" className="personal-read-action" aria-label={`标为已读：${message.title}`} title="标为已读" onClick={()=>void c.markRead(message.id)}>标为已读</Button>}
    </div></footer>
   </article>)}</div>
   {c.cursor&&<Button block loading={c.loading} onClick={()=>void c.more()}>加载更多</Button>}
  </div>;
 return <section className="personal-notification-page">
  <Tabs className="personal-page-tabs" activeKey={tab} onChange={setTab} destroyOnHidden items={[
   {key:'待办',label:`待我处理 ${c.data?.todoCount??'—'}`,children:<PersonalTodoPanel controller={c}/>},
   {key:'跟进',label:`我在跟进 ${c.data?.followingCount??'—'}`,children:<PersonalTodoPanel controller={c} following/>},
   {key:'消息',label:<span className="personal-tab-label">通知记录{Boolean(c.data?.unread)&&<span className="personal-tab-count">{c.data!.unread}</span>}</span>,children:inbox}
  ]}/>
 </section>;
}
export function PersonalTodoPanel({controller:c,following=false}:{controller:PersonalWorkbenchController;following?:boolean}) {
 const [category,setCategory]=useState('全部');const [limit,setLimit]=useState(20);
 const todos=(following?c.data?.following:c.data?.todos)||[];
 const categories=[...new Set(todos.map(t=>t.category))];
 const selected=category==='全部'||categories.includes(category)?category:'全部';
 const visible=todos.filter(t=>selected==='全部'||t.category===selected);
 return <section className="personal-todo-panel" aria-label={following?"我在跟进":"待我处理"}>
  <div className="personal-todo-toolbar"><Button type="text" aria-label="刷新我的待办" icon={<RefreshCw size={17}/>} onClick={c.refresh}/></div>
  {c.error&&<Alert type="warning" title="更新失败，当前内容可能不是最新" description={c.error} action={<Button onClick={c.refresh}>重试</Button>}/>}
  {c.data&&todos.length>0&&<div className="personal-todo-filters" aria-label="待办分类">{['全部',...categories].map(name=><button type="button" aria-pressed={selected===name} key={name} onClick={()=>{setCategory(name);setLimit(20);}}>{name}<span>{name==='全部'?todos.length:todos.filter(t=>t.category===name).length}</span></button>)}</div>}
  {!c.data&&!c.error?<Spin/>:c.data&&!todos.length?<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={following?"暂无跟进事项":"暂无待处理事项"}/>:null}
  <div className="personal-todo-list">{visible.slice(0,limit).map(todo=><article className="personal-task-card" key={todo.id}><button type="button" className="personal-todo-row" onClick={()=>openPersonalTarget(todo)}><div><span className="personal-todo-category">{todo.category}</span><strong>{todo.title}</strong>{todo.summary&&<p>{todo.summary}</p>}{todo.waitingSince&&<p>已等待 {todo.waitingMinutes??0} 个工作分钟 · {new Date(todo.waitingSince).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</p>}</div><ChevronRight size={18} aria-hidden="true"/></button>{Boolean(todo.reminderHistory?.length)&&<details className="personal-task-history"><summary>提醒记录（{todo.reminderHistory!.length}）</summary><ol>{todo.reminderHistory!.map((entry,i)=><li key={i}>{entry.label} · {new Date(entry.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})} · {({pending:'待发送',accepted:'钉钉已受理',sent:'已发送',failed:'发送失败',unknown:'结果待核实',cancelled:'已取消'} as Record<string,string>)[entry.status]||entry.status}</li>)}</ol></details>}{Boolean(todo.eventHistory?.length)&&<details className="personal-task-history"><summary>相关记录（{todo.eventHistory!.length}）</summary><ol>{todo.eventHistory!.map((entry,i)=><li key={i}>{entry.label} · {new Date(entry.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}</li>)}</ol></details>}</article>)}</div>
  {visible.length>limit&&<Button block onClick={()=>setLimit(v=>v+20)}>查看更多</Button>}
 </section>;
}
