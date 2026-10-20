import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../client/src/features/dispatch/useDispatchFilterDraft.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace("from 'react'",`from '${import.meta.resolve('react')}'`);
const {advancedFilterCount,activeFilterCount,filterDateError}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
test('advanced filter badge counts execution choices as a group and a date range as a group',()=>{
 assert.equal(advancedFilterCount({}),0);
 assert.equal(advancedFilterCount({executionMode:'internal,field',from:'2026-10-01',to:'2026-10-31'}),2);
 assert.equal(advancedFilterCount({technicianId:'t',to:'2026-10-31'}),2);
 assert.equal(activeFilterCount({stage:'待检验',urgent:'true',overdue:'true',search:'A67527',executionMode:'internal,field'}),5);
});
test('date range accepts open bounds without injecting month defaults and rejects reversed dates',()=>{
 for(const filters of [{},{from:'2026-10-01'},{to:'2026-10-31'},{from:'2026-10-01',to:'2026-10-01'}])assert.equal(filterDateError(filters),'');
 assert.match(filterDateError({from:'2026-10-31',to:'2026-10-01'}),/开始日期不能晚于结束日期/);
});
