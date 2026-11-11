const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { JobCache } = require("../dist/cache");
const details = id => ({id,source:"scontrol",raw:"",fields:{SubmitTime:"2026-11-11T01:00:00",StdOut:"/shared/slurm-%j.out",StdErr:""}});
const fixture = async action => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"slurm-cache-"));
  try { await action(root); } finally { await fs.rm(root,{recursive:true,force:true}); }
};

test("extension ID migration copies paths and scripts before reads and preserves the old cache", () => fixture(async root => {
  const oldRoot=path.join(root,"xx025.slurm-job-viewer","job-cache");
  const newRoot=path.join(root,"xx025.slurm-explorer","job-cache");
  const oldCache=new JobCache(oldRoot,()=>"host",()=>1024*1024);
  await oldCache.remember(details("42"));
  await oldCache.saveScript("42","#!/bin/bash\necho migration\n");
  const migrated=new JobCache(newRoot,()=>"host",()=>1024*1024,undefined,oldRoot);
  assert.equal((await migrated.get("42")).items.stdout.source,"/shared/slurm-42.out");
  assert.equal((await migrated.script("42")).text,"#!/bin/bash\necho migration\n");
  assert.equal((await oldCache.script("42")).text,"#!/bin/bash\necho migration\n");
  for (const file of await fs.readdir(path.join(newRoot,migrated.namespace()))) {
    assert.equal((await fs.stat(path.join(newRoot,migrated.namespace(),file))).mode&0o777,0o600);
  }
  await migrated.clear();
  const restarted=new JobCache(newRoot,()=>"host",()=>1024*1024,undefined,oldRoot);
  assert.equal(await restarted.get("42"),undefined,"cleared snapshots must not return after restart");
}));

test("extension ID migration keeps a new cache and permits writes when the old cache is missing", () => fixture(async root => {
  const oldRoot=path.join(root,"old");
  const newRoot=path.join(root,"new");
  const fresh=new JobCache(newRoot,()=>"host",()=>1024*1024,undefined,oldRoot);
  await fresh.saveScript("42","new script");
  const legacy=new JobCache(oldRoot,()=>"host",()=>1024*1024);
  await legacy.saveScript("42","old script");
  const restarted=new JobCache(newRoot,()=>"host",()=>1024*1024,undefined,oldRoot);
  assert.equal((await restarted.script("42")).text,"new script");
}));

test("cache persists script bytes and resolved log paths across instances without copying logs", () => fixture(async root => {
  const cache=new JobCache(root,()=>"host-a/login/slurm",()=>1024*1024);
  const text='#!/bin/bash\n# 中文\necho "$SLURM_JOB_ID"\n';
  await Promise.all([cache.remember(details("42")),cache.saveScript("42",text)]);
  const restarted=new JobCache(root,()=>"host-a/login/slurm",()=>1024*1024);
  const record=await restarted.get("42");
  assert.equal(record.items.stdout.source,"/shared/slurm-42.out");
  assert.equal(record.items.stderr.source,"/shared/slurm-42.out");
  assert.equal(record.items.stdout.file,undefined);
  assert.equal(record.items.stderr.file,undefined);
  assert.equal((await restarted.script("42")).text,text);
  const directory=path.join(root,cache.namespace());
  const files=await fs.readdir(directory);
  assert.equal(files.filter(file=>file.endsWith('.data')).length,1);
  assert.equal((await fs.stat(directory)).mode&0o777,0o700);
  for(const file of files) assert.equal((await fs.stat(path.join(directory,file))).mode&0o777,0o600);
}));

test("missing accounting paths do not erase cached paths and namespaces never mix jobs", () => fixture(async root => {
  let scope="host-a/login/bin-a";
  const cache=new JobCache(root,()=>scope,()=>1024*1024);
  await cache.remember(details("42"));
  await cache.remember({id:"42",source:"sacct",raw:"",fields:{State:"COMPLETED"}});
  assert.equal((await cache.get("42")).items.stdout.source,"/shared/slurm-42.out");
  scope="host-a/login/bin-b";
  assert.equal(await cache.get("42"),undefined);
  await cache.saveScript("42","different cluster");
  scope="host-a/login/bin-a";
  assert.equal(await cache.script("42"),undefined);
}));

test("a reused controller job ID invalidates the previous submission's script", () => fixture(async root => {
  const cache=new JobCache(root,()=>"host",()=>1024*1024);
  await cache.remember(details("42")); await cache.saveScript("42","old script");
  const next=details("42"); next.fields.SubmitTime="2027-01-01T00:00:00"; next.fields.StdOut="/new/slurm-42.out";
  await cache.remember(next);
  assert.equal(await cache.script("42"),undefined);
  assert.equal((await cache.get("42")).items.stdout.source,"/new/slurm-42.out");
}));

test("capacity evicts oldest complete entries and clear affects only the current scope", () => fixture(async root => {
  const cache=new JobCache(root,()=>"a",()=>1700);
  await cache.saveScript("1","a".repeat(700));
  await new Promise(resolve=>setTimeout(resolve,5));
  await cache.saveScript("2","b".repeat(700));
  assert.equal(await cache.script("1"),undefined);
  assert.equal((await cache.script("2")).text,"b".repeat(700));
  const other=new JobCache(root,()=>"b",()=>1700);
  await other.saveScript("1","other");
  await cache.clear();
  assert.equal(await cache.get("2"),undefined);
  assert.equal((await other.script("1")).text,"other");
}));

test("corrupt and unsafe cache metadata cannot expose unrelated files", () => fixture(async root => {
  const cache=new JobCache(root,()=>"host",()=>1024*1024);
  await cache.saveScript("42","script");
  const directory=path.join(root,cache.namespace());
  const file=(await fs.readdir(directory)).find(file=>file.endsWith('.json'));
  const record=JSON.parse(await fs.readFile(path.join(directory,file),'utf8'));
  record.items.script.file='../secret';
  await fs.writeFile(path.join(directory,file),JSON.stringify(record));
  assert.equal(await cache.script("42"),undefined);
  await fs.writeFile(path.join(directory,file),'broken json');
  assert.equal(await cache.get("42"),undefined);
  assert.equal(await cache.get("42",'../host'),undefined);
}));

test("unwritable cache does not reject a successful live script retrieval", () => fixture(async root => {
  const filename=path.join(root,'not-a-directory'); await fs.writeFile(filename,'file');
  const errors=[];
  const cache=new JobCache(filename,()=>"host",()=>1024,error=>errors.push(error));
  await cache.saveScript("42","script");
  assert.ok(errors.length);
  assert.equal(await cache.script("42"),undefined);
}));
