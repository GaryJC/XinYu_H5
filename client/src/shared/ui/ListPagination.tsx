import { Button, Pagination } from 'antd';
export function ListPagination({mobile,page,total,loaded,loading,onPage,onMore,pageSize=20}:{mobile:boolean;page:number;total:number;loaded:number;loading:boolean;onPage:(page:number)=>void;onMore:()=>void;pageSize?:number}) {
  return <div style={{display:'flex',justifyContent:'center',padding:'20px 0'}} aria-label="列表分页">
    {mobile ? <Button block loading={loading} disabled={page*pageSize>=total&&!loading} onClick={onMore}>
      {page*pageSize<total?`加载更多（已加载 ${loaded} / ${total} 条）`:total?`没有更多记录（已显示 ${loaded} 条）`:'暂无记录'}
    </Button> : <Pagination current={page} total={total} pageSize={pageSize} showSizeChanger={false} hideOnSinglePage disabled={loading} onChange={onPage} showTotal={value=>`共 ${value} 条`}/>}
  </div>;
}
