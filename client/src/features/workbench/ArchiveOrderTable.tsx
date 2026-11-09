import {Button,Empty,Table,Tag} from 'antd';
import type {WorkOrderListItem} from '../../../../shared/types';
import {workOrderDisplayStatus} from '../work-orders/domain/workOrderDomain';
import {StatusChip} from '../../shared/ui/Status';
import {OrderLegacySyncStatus} from './OrderLegacySyncStatus';
import {archiveTimeLabel} from './archiveFilters';
export function ArchiveOrderTable({listedOrders,ordersLoading,selectedId,openDetail,onReset}:{listedOrders:WorkOrderListItem[];ordersLoading:boolean;selectedId:string|null;openDetail:(order:WorkOrderListItem)=>void;onReset:()=>void}) {
 return (
        <Table
          className="orders-table"
          loading={{ spinning: ordersLoading, description: "正在加载委托单…" }}
          aria-busy={ordersLoading}
          size="small"
          rowKey="id"
          scroll={{ x: "max-content" }}
          pagination={false}
          locale={{ emptyText: ordersLoading ? <div style={{ minHeight: 140 }} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无符合条件的委托单"><Button onClick={onReset}>清空筛选</Button></Empty> }}
          rowClassName={(order) => order.id === selectedId ? "selected" : ""}
          onRow={(order) => ({ onClick: () => openDetail(order), tabIndex: 0, 'aria-label': `查看委托单 ${order.vehicle.plate || order.id}`, onKeyDown: event => {
            if (event.target !== event.currentTarget) return;
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openDetail(order); }
          } })}
          dataSource={listedOrders}
          columns={[
            { title: "派工号", render: (_, order) => order.dispatchNo || "暂无派工号", width: 160 },
            { title: "车牌", render: (_, order) => order.vehicle.plate || "-" },
            { title: "车主", render: (_, order) => order.customer.name || "-" },
            { title: "服务顾问", dataIndex: "advisor" },
            { title: "维修技师", dataIndex: "technician" },
            { title: "业务状态", render: (_, order) => <><StatusChip status={workOrderDisplayStatus(order)} />{order.legacyApproved && <Tag color="green">已审</Tag>}{order.isBaiyuanOrder && <Tag color="blue">百援</Tag>}{order.paperOrder && <Tag color="orange">纸质委托书</Tag>}</> },
            { title: "润丰同步", render: (_, order) => <OrderLegacySyncStatus order={order} /> },
            { title: "金额", render: (_, order) => order.settlementAmount || order.estimatedFee ? `¥${order.settlementAmount || order.estimatedFee}` : "-" },
            { title: "创建时间", render: (_, order) => archiveTimeLabel(order, "created"), width: 145 },
            { title: "更新时间", render: (_, order) => archiveTimeLabel(order, "updated"), width: 145 }
          ]}
        />
 );
}
