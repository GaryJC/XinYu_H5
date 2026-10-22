import dayjs from 'dayjs';
import { useState } from 'react';
import { Alert, Button, Drawer, DatePicker, Select, Tag } from 'antd';
import { archiveDateError, defaultArchiveFilters, type ArchiveFilters } from './archiveFilters';
import type { ArchiveFilterController } from './useArchiveFilters';

const ranges: Array<{ value: ArchiveFilters['range']; label: string }> = [
  { value: 'all', label: '全部' }, { value: 'today', label: '今天' }, { value: 'yesterday', label: '昨天' }, { value: 'week', label: '近7天' }, { value: 'custom', label: '自定义' }
];
const sorts = [
  { value: 'updated-desc', label: '更新时间最新' }, { value: 'updated-asc', label: '更新时间最早' },
  { value: 'created-desc', label: '创建时间最新' }, { value: 'created-asc', label: '创建时间最早' }
];
export function ArchiveFilterBar({ archive, isMobile }: { archive: ArchiveFilterController; isMobile: boolean }) {
  const { filters, setFilters, options, reset } = archive;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(filters);
  const [customOpen, setCustomOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState(filters);
  const update = (patch: Partial<ArchiveFilters>) => setFilters({ ...filters, ...patch });
  const fields = (value: ArchiveFilters, onChange: (next: ArchiveFilters) => void) => <div className="archive-filter-fields">
    {(['statuses', 'advisors', 'technicians'] as const).map((key, index) => <label key={key}>
      <span>{['业务状态', '服务顾问', '维修技师'][index]}</span>
      <Select mode="multiple" allowClear showSearch aria-label={['业务状态', '服务顾问', '维修技师'][index]} placeholder="全部" value={value[key]} options={options[key]} onChange={items => onChange({ ...value, [key]: items })} />
    </label>)}
  </div>;
  const dates = (value: ArchiveFilters, onChange: (next: ArchiveFilters) => void) => <div className="archive-date-inputs">
    <label>开始日期<DatePicker classNames={{ popup: { root: "archive-date-popup" } }} aria-label="创建开始日期" inputReadOnly={isMobile} value={value.from ? dayjs(value.from) : null} onChange={date => onChange({ ...value, from: date ? date.format("YYYY-MM-DD") : "" })} /></label>
    <label>结束日期<DatePicker classNames={{ popup: { root: "archive-date-popup" } }} aria-label="创建结束日期" inputReadOnly={isMobile} value={value.to ? dayjs(value.to) : null} onChange={date => onChange({ ...value, to: date ? date.format("YYYY-MM-DD") : "" })} /></label>
    {archiveDateError(value) && <Alert type="warning" title={archiveDateError(value)} />}
  </div>;
  const count = filters.statuses.length + filters.advisors.length + filters.technicians.length;
  return <section className="archive-filter-bar" aria-label="委托单筛选">
    <div className="archive-filter-toolbar">
      <span>创建日期</span>
      <div className="archive-date-shortcuts">{ranges.map(range => <Button key={range.value} size="small" type={filters.range === range.value ? 'primary' : 'default'} onClick={() => {
        if (range.value === 'custom') {
          if (isMobile) { setDraft({ ...filters, range: 'custom' }); setOpen(true); }
          else { setCustomDraft({ ...filters, range: 'custom' }); setCustomOpen(true); }
        } else { update({ range: range.value, from: '', to: '' }); setCustomOpen(false); }
      }}>{range.label}</Button>)}</div>
      <div className="archive-list-controls">
      <Select size="small" className="archive-sort" aria-label="委托单排序" value={filters.sort} options={sorts} onChange={sort => update({ sort })} />
      {isMobile && <Button size="small" onClick={() => { setDraft(filters); setOpen(true); }}>更多筛选{count ? `（${count}）` : ''}</Button>}
      <Button size="small" type="link" onClick={() => { reset(); setCustomOpen(false); }}>重置</Button>
      </div>
    </div>
    {!isMobile && customOpen && <div className="archive-custom-dates">
      {dates(customDraft, setCustomDraft)}
      <Button type="primary" disabled={Boolean(archiveDateError(customDraft))} onClick={() => { update({ range: 'custom', from: customDraft.from, to: customDraft.to }); setCustomOpen(false); }}>应用日期</Button>
      <Button onClick={() => setCustomOpen(false)}>取消</Button>
    </div>}
    {!isMobile && fields(filters, setFilters)}
    <div className="archive-filter-summary" aria-live="polite">
      <span>共 {archive.filteredOrders.length} 张</span>
      {filters.range !== 'all' && <Tag closable onClose={() => update({ range: 'all', from: '', to: '' })}>创建日期：{filters.range === 'custom' ? `${filters.from} 至 ${filters.to}` : ranges.find(range => range.value === filters.range)?.label}</Tag>}
      {filters.search && <Tag closable onClose={() => update({ search: '' })}>搜索：{filters.search}</Tag>}
      {(['statuses', 'advisors', 'technicians'] as const).flatMap((key, index) => filters[key].map(value => <Tag key={`${key}-${value}`} closable onClose={() => update({ [key]: filters[key].filter(item => item !== value) })}>{['状态', '顾问', '技师'][index]}：{value}</Tag>))}
    </div>
    <Drawer title="筛选委托单" placement="bottom" open={open} onClose={() => setOpen(false)} height="80dvh" rootClassName="archive-filter-drawer" footer={<div className="archive-filter-footer">
      <Button onClick={() => setDraft(defaultArchiveFilters())}>重置条件</Button>
      <Button type="primary" disabled={Boolean(archiveDateError(draft))} onClick={() => { setFilters(draft); setOpen(false); }}>应用</Button>
    </div>}>
      <div className="archive-drawer-fields">
        <label>创建日期<Select aria-label="创建日期范围" value={draft.range} options={ranges} onChange={range => setDraft({ ...draft, range })} /></label>
        {draft.range === 'custom' && dates(draft, setDraft)}
        {fields(draft, setDraft)}
        <label>排序<Select aria-label="筛选抽屉排序" value={draft.sort} options={sorts} onChange={sort => setDraft({ ...draft, sort })} /></label>
      </div>
    </Drawer>
  </section>;
}
