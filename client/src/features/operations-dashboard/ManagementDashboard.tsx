import {Suspense,useState} from 'react';
import {Drawer} from 'antd';
import {ChartNoAxesCombined, PanelsTopLeft} from 'lucide-react';
import type {UserProfile} from '../../../../shared/types';
import {lazy} from '../../shared/ui/recoverableLazy';
import {LoadingState} from '../../shared/ui/LoadingState';
import {NotificationUsagePanel} from '../notifications/NotificationUsagePanel';
import {OnsiteDashboardPage} from './OnsiteDashboardPage';
import './management-dashboard.css';

const BusinessAnalyticsPage = lazy(()=>import('../business-analytics/BusinessAnalyticsPage').then(m=>({default:m.BusinessAnalyticsPage})));
const OrderOverviewDetail = lazy(()=>import('../order-overview/OrderOverviewDetail').then(m=>({default:m.OrderOverviewDetail})));
const VehicleTripsPage = lazy(()=>import('../vehicle-trips/VehicleTripsPage').then(m=>({default:m.VehicleTripsPage})));
const views = [{label:'现场运营',icon:PanelsTopLeft},{label:'经营复盘',icon:ChartNoAxesCombined}] as const;

export function ManagementDashboard({user}:{user:UserProfile}) {
  const [view,setView] = useState<'现场运营'|'经营复盘'>('现场运营');
  const [orderId,setOrderId] = useState<string>();
  const [reportMonth,setReportMonth] = useState<string>();
  const [tripRevision,setTripRevision] = useState(0);
  return <div className="management-dashboard">
    <div className="dashboard-views" role="radiogroup" aria-label="看板视图">
      {views.map(({label,icon:Icon})=><label key={label}>
        <input type="radio" name="management-dashboard-view" checked={view===label} onChange={()=>setView(label)}/>
        <span><Icon size={16} aria-hidden="true"/>{label}</span>
      </label>)}
    </div>
    {view==='现场运营' ? <OnsiteDashboardPage onOpenOrder={setOrderId} onOpenReport={setReportMonth} revision={tripRevision}/> :
      <Suspense fallback={<LoadingState label="正在加载经营复盘…"/>}><BusinessAnalyticsPage onOpenOrder={setOrderId}/></Suspense>}
    <NotificationUsagePanel/>
    <Drawer title="工单原单" size="large" zIndex={1120} open={Boolean(orderId)} onClose={()=>setOrderId(undefined)} destroyOnHidden>
      {orderId && <Suspense fallback={<LoadingState label="正在加载工单原单…"/>}><OrderOverviewDetail key={orderId} id={orderId}/></Suspense>}
    </Drawer>
    <Drawer title="用车统计" size="large" open={Boolean(reportMonth)} onClose={()=>setReportMonth(undefined)} destroyOnHidden>
      {reportMonth && <Suspense fallback={<LoadingState label="正在加载用车统计…"/>}><VehicleTripsPage user={user} reportMonth={reportMonth} onTripChanged={()=>setTripRevision(n=>n+1)}/></Suspense>}
    </Drawer>
  </div>;
}
