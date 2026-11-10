import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

test('Windows deployment lock waits for release and times out without entering preparation', {skip:process.platform!=='win32',timeout:30000}, async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'deployment-lock-'));
  const children=[];
  const run=args=>{
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass',...args]);
    children.push(child);
    let output='';child.stdout.on('data',data=>{output+=data;});child.stderr.on('data',data=>{output+=data;});
    const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>resolve({code,output}));});
    return {child,done};
  };
  try {
    const source=await readFile(new URL('../scripts/deploy-windows.ps1',import.meta.url),'utf8');
    const start=source.indexOf('    $lockPath =');
    const end=source.indexOf('    $lockTimer.Stop()',start)+'    $lockTimer.Stop()'.length;
    assert.ok(start>0&&end>start);
    const probe=path.join(dir,'probe.ps1');
    await writeFile(probe,`param([string]$AppPath,[int]$DeploymentLockTimeoutSeconds)
$ErrorActionPreference='Stop'
$deploymentLock=$null
try {
${source.slice(start,end)}
Write-Output 'PREPARATION_REACHED'
} finally { if ($deploymentLock) { $deploymentLock.Dispose() } }
`);
    const attempt=seconds=>run(['-File',probe,dir,String(seconds)]).done;
    assert.equal((await attempt(0)).code,0);
    const holder=path.join(dir,'holder.ps1');
    await writeFile(holder,`param([string]$AppPath)
$ErrorActionPreference='Stop'
$lock=[System.IO.File]::Open((Join-Path $AppPath '.deployment.lock'),'OpenOrCreate','ReadWrite','None')
try { Write-Output 'LOCKED'; [Console]::In.ReadLine() | Out-Null } finally { $lock.Dispose() }
`);
    const held=run(['-File',holder,dir]);
    await new Promise((resolve,reject)=>{
      held.child.stdout.on('data',data=>{if(String(data).includes('LOCKED'))resolve();});
      held.child.on('error',reject);held.child.on('exit',()=>reject(new Error('holder exited before lock')));
    });
    const blocked=await attempt(1);
    assert.notEqual(blocked.code,0);assert.match(blocked.output,/Deployment lock timeout/);
    assert.doesNotMatch(blocked.output,/PREPARATION_REACHED/);
    const waiting=run(['-File',probe,dir,'10']);
    waiting.child.stdout.on('data',data=>{if(String(data).includes('Waiting for deployment lock'))held.child.stdin.end('\n');});
    const acquired=await waiting.done;
    assert.equal(acquired.code,0,acquired.output);assert.match(acquired.output,/PREPARATION_REACHED/);
    await held.done;
    assert.equal((await attempt(0)).code,0,'handle released after successful deployment');
  } finally {
    for(const child of children)if(child.exitCode===null)child.kill();
    await rm(dir,{recursive:true,force:true});
  }
});
