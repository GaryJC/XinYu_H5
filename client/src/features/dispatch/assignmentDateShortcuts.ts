export function assignmentDateShortcuts(now=new Date()) {
 const local=new Date(now.getTime()+8*3600000);
 const day=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate());
 const date=(offset:number)=>new Date(day+offset*86400000).toISOString().slice(0,10);
 return [
  {key:'all',label:'全部',from:'',to:''},
  {key:'today',label:'今天',from:date(0),to:date(0)},
  {key:'yesterday',label:'昨天',from:date(-1),to:date(-1)},
  {key:'week',label:'近7天',from:date(-6),to:date(0)}
 ];
}
