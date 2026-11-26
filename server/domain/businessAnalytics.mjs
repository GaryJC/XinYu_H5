import { HttpError } from '../http/HttpError.mjs';
import { pageResult } from './pagination.mjs';

const DAY = 86_400_000;
const OFFSET = 8 * 3_600_000;
const timestamp = value => value ? new Date(value).getTime() : NaN;
const dateKey = time => new Date(time + OFFSET).toISOString().slice(0, 10);
const between = (time, start, end) => time >= start && time < end;
const clean = value => String(value || '').trim().toUpperCase().replace(/\s+/g, '');
const vehicleIds = rows => new Set(rows.map(row => row.vehicle).filter(Boolean));
const ageBucket = days => days <= 1 ? 0 : days <= 3 ? 1 : days <= 7 ? 2 : days <= 14 ? 3 : 4;
const executionModes = {internal:'店内维修', field:'员工外修', outsourced:'外包维修'};

function shiftMonth(start, months) {
  const date = new Date(start + OFFSET);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.getTime() - OFFSET;
}

export function analyticsPeriod({ days = 30, month }, now) {
  const today = Math.floor((now.getTime() + OFFSET) / DAY) * DAY - OFFSET;
  if (month === undefined) {
    if (![7, 30, 90, 180, 365].includes(days)) throw new HttpError(400, '请选择支持的统计周期');
    const start = today - days * DAY;
    return { start, end:today, previousStart:start - days * DAY, previousEnd:start, comparableEnd:today };
  }

  const currentMonth = dateKey(today).slice(0, 7);
  if (typeof month !== 'string' || !/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(month)
      || month.startsWith('0000') || month > currentMonth) {
    throw new HttpError(400, '请选择有效的当前或历史月份');
  }
  const start = Date.parse(month + '-01T00:00:00+08:00');
  const previousStart = shiftMonth(start, -1);
  if (month < currentMonth) {
    const end = shiftMonth(start, 1);
    return { start, end, previousStart, previousEnd:start, comparableEnd:end };
  }
  const completedDays = today - start;
  const matchedDays = Math.min(completedDays, start - previousStart);
  return { start, end:today, previousStart, previousEnd:previousStart + matchedDays, comparableEnd:start + matchedDays };
}

function normalizeOrders(input, now) {
  const rows = [];
  let invalidCreated = 0;
  for (const record of input) {
    if (['草稿', '待处理纸质委托书'].includes(record.status)) continue;
    const created = timestamp(record.createdAt);
    if (!Number.isFinite(created)) {
      invalidCreated++;
      continue;
    }
    if (created > now) continue;

    const completions = (record.completionDates || []).map(timestamp).filter(time => time >= created && time <= now);
    const fallbackStage = ['待结算', '完成'].includes(record.status) ? '维修完成' : record.status;
    const currentStage = record.status === '待客户签字' ? record.status : record.stage || fallbackStage;
    const plateKey = clean(record.plate);
    const vin = clean(record.vin);
    rows.push({
      id:record.id, dispatchNo:record.dispatchNo, plate:record.plate, plateKey, vin, vehicle:vin || plateKey,
      created, currentStage, completed:completions.length ? Math.min(...completions) : NaN,
      customer:String(record.customer || '').trim() || '未登记单位', executionMode:record.executionMode
    });
  }
  return { rows, invalidCreated };
}

function group(rows, key) {
  const counts = new Map();
  for (const row of rows) {
    const name = key(row);
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts].map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

function medianCycle(rows) {
  if (!rows.length) return null;
  const cycles = rows.map(row => (row.completed - row.created) / DAY).sort((a, b) => a - b);
  const mid = Math.floor(cycles.length / 2);
  const middle = cycles.length % 2 ? cycles[mid] : (cycles[mid - 1] + cycles[mid]) / 2;
  return Math.round(middle * 10) / 10;
}

function countMetric(value, previous, comparable, monthly) {
  const change = previous ? Math.round((comparable - previous) / previous * 1000) / 10 : null;
  return { value, previous, change, ...(monthly && { comparableValue:comparable }) };
}

function reconcileVehicles(rows) {
  const plateVins = new Map();
  for (const {plateKey, vin} of rows) {
    if (!plateKey || !vin) continue;
    if (!plateVins.has(plateKey)) plateVins.set(plateKey, vin);
    else if (plateVins.get(plateKey) !== vin) plateVins.set(plateKey, null);
  }
  const firstSeen = new Map();
  for (const row of rows) {
    if (!row.vin) row.vehicle = plateVins.get(row.plateKey) || row.vehicle;
    if (row.vehicle) firstSeen.set(row.vehicle, Math.min(firstSeen.get(row.vehicle) ?? Infinity, row.created));
  }
  return firstSeen;
}

export function buildBusinessAnalytics(input, { days = 30, month, now = new Date() } = {}) {
  const { start, end, previousStart, previousEnd, comparableEnd } = analyticsPeriod({ days, month }, now);
  const { rows, invalidCreated } = normalizeOrders(input, now.getTime());
  const firstSeen = reconcileVehicles(rows);
  const daily = Array.from({length:(end - start) / DAY}, (_, index) => {
    const previous = previousStart + index * DAY;
    const hasPrevious = previous < previousEnd;
    return {
      date:dateKey(start + index * DAY), previousDate:hasPrevious ? dateKey(previous) : '',
      created:0, previous:hasPrevious ? 0 : null, completed:0
    };
  });
  const currentMonth = dateKey(now.getTime()).slice(0, 7);
  const monthStart = Date.parse((month ?? currentMonth) + '-01T00:00:00+08:00');
  const trendStart = shiftMonth(monthStart, -11);
  const monthly = Array.from({length:12}, (_, index) => {
    const key = dateKey(shiftMonth(trendStart, index)).slice(0, 7);
    return {month:key, value:0, partial:key === currentMonth};
  });
  const monthBuckets = new Map(monthly.map(bucket => [bucket.month, bucket]));
  const current = [], previous = [], done = [], previousDone = [];
  for (const row of rows) {
    if (between(row.created, start, end)) {
      current.push(row);
      daily[Math.floor((row.created - start) / DAY)].created++;
    } else if (between(row.created, previousStart, previousEnd)) {
      previous.push(row);
      const day = daily[Math.floor((row.created - previousStart) / DAY)];
      if (day) day.previous++;
    }
    if (between(row.completed, start, end)) {
      done.push(row);
      daily[Math.floor((row.completed - start) / DAY)].completed++;
    } else if (between(row.completed, previousStart, previousEnd)) {
      previousDone.push(row);
    }
    if (row.created >= trendStart && (!month || row.created < end)) {
      const bucket = monthBuckets.get(dateKey(row.created).slice(0, 7));
      if (bucket) bucket.value++;
    }
  }

  const comparable = comparableEnd === end ? current : current.filter(row => row.created < comparableEnd);
  const comparableDone = comparableEnd === end ? done : done.filter(row => row.completed < comparableEnd);
  const vehicles = vehicleIds(current);
  const newVehicles = [...vehicles].filter(id => firstSeen.get(id) >= start).length;
  const live = rows.filter(row => row.currentStage !== '维修完成');
  const aging = ['≤1天', '1–3天', '3–7天', '7–14天', '>14天'].map(name => ({name, value:0}));
  for (const row of live) aging[ageBucket((now.getTime() - row.created) / DAY)].value++;
  const cycleBuckets = ['≤1天', '1–3天', '3–7天', '>7天'].map(name => ({name, value:0}));
  for (const row of done) cycleBuckets[Math.min(3, ageBucket((row.completed - row.created) / DAY))].value++;

  const customers = group(current, row => row.customer);
  const topCustomers = customers.slice(0, 6);
  if (customers.length > 6) {
    topCustomers.push({name:'其他单位', value:customers.slice(6).reduce((sum, row) => sum + row.value, 0)});
  }
  const range = {
    days:daily.length, from:dateKey(start), to:end > start ? dateKey(end - DAY) : '',
    previousFrom:dateKey(previousStart), previousTo:previousEnd > previousStart ? dateKey(previousEnd - DAY) : ''
  };
  if (month) {
    range.month = month;
    range.comparableTo = comparableEnd > start ? dateKey(comparableEnd - DAY) : '';
  }
  const cycleValue = medianCycle(done);
  return {
    generatedAt:now.toISOString(), range,
    kpis:{
      orders:countMetric(current.length, previous.length, comparable.length, month),
      completed:countMetric(done.length, previousDone.length, comparableDone.length, month),
      vehicles:countMetric(vehicles.size, vehicleIds(previous).size, comparable === current ? vehicles.size : vehicleIds(comparable).size, month),
      cycleDays:{value:cycleValue, previous:medianCycle(previousDone), samples:done.length,
        ...(month && {comparableValue:comparableDone === done ? cycleValue : medianCycle(comparableDone)})}
    },
    daily, monthly, customers:topCustomers, customerCount:customers.filter(customer => customer.name !== '未登记单位').length,
    vehicleMix:[{name:'首次记录车辆', value:newVehicles}, {name:'历史到店车辆', value:vehicles.size - newVehicles}],
    status:group(rows, row => row.currentStage), aging, cycleBuckets,
    execution:group(current, row => executionModes[row.executionMode] || '尚未安排 / 未记录'),
    liveCount:live.length,
    quality:{
      missingCompletion:rows.filter(row => row.currentStage === '维修完成' && !Number.isFinite(row.completed)).length,
      missingVehicle:current.filter(row => !row.vehicle).length, invalidCreated
    }
  };
}

export function analyticsOrderPage(input, { metric, page, pageSize }, period, now) {
  const { rows } = normalizeOrders(input, now.getTime());
  const key = metric === 'orders' ? 'created' : 'completed';
  const selected = rows.filter(row => between(row[key], period.start, period.end))
    .sort((a, b) => b[key] - a[key] || a.id.localeCompare(b.id));
  const result = pageResult(selected, { page, pageSize });
  return {
    ...result,
    items:result.items.map(row => ({
      id:row.id, dispatchNo:row.dispatchNo || '', plate:row.plate || '', stage:row.currentStage,
      createdAt:new Date(row.created).toISOString(),
      firstCompletedAt:Number.isFinite(row.completed) ? new Date(row.completed).toISOString() : null
    }))
  };
}
