'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {DuckDBInstance}=require('@duckdb/node-api');
const {buildOvertureQuery}=require('../server/place-candidates/overture-source');

test('dense admitted rows retain their license facts inside the native memory and shared spill allowance',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'parranda-overture-memory-'));
  const db=await DuckDBInstance.create(':memory:',{memory_limit:'128MB',threads:'1',autoload_known_extensions:'false',autoinstall_known_extensions:'false'});
  const conn=await db.connect();
  t.after(()=>{conn.closeSync();db.closeSync();fs.rmSync(dir,{recursive:true,force:true});});
  const file=path.join(dir,'places.parquet');
  await conn.run(`SET temp_directory='${dir}'; SET max_temp_directory_size='32MiB'`);
  await conn.run(`COPY (WITH x AS (SELECT i,md5(i::VARCHAR) h,
    CASE i%6 WHEN 0 THEN 'cafe' WHEN 1 THEN 'garden' WHEN 2 THEN 'museum' WHEN 3 THEN 'bar' WHEN 4 THEN 'restaurant' ELSE 'art_gallery' END category FROM range(245760)t(i))
    SELECT substr(h,1,8)||'-'||substr(h,9,4)||'-'||substr(h,13,4)||'-'||substr(h,17,4)||'-'||substr(h,21,12) id,
    {'primary':'Place '||h} AS "names",{'primary':category,'hierarchy':['root',category]} taxonomy,
    .99::DOUBLE confidence,CASE i%19 WHEN 0 THEN 'closed' ELSE 'open' END operating_status,
    ['https://example.test/'||h] websites,{'names':{'primary':CASE WHEN i%7=0 THEN 'Brand '||substr(h,1,10) END}} brand,
    list_transform([0,1],a->{'property':'name','dataset':CASE WHEN a=0 THEN 'fixture1' ELSE 'fixture2' END,'license':'CC0-1.0',
      'record_id':md5((i+a)::VARCHAR),'update_time':'2026-09-01T00:00:00','confidence':.99::DOUBLE,'between':[.1::DOUBLE,.2::DOUBLE],
      'provider':'fixture','resource':'fixture','version':'2026'}) sources,
    {'xmin':12.0+(i%200)*.0001::DOUBLE,'ymin':40.0+(i%100)*.0001::DOUBLE} bbox FROM x)
    TO '${file}' (FORMAT PARQUET,COMPRESSION ZSTD,ROW_GROUP_SIZE 20480)`);
  // The same 64MiB total leaves only this much spill after source allocation.
  const physical=fs.statSync(file).blocks*512;
  await conn.run(`SET max_temp_directory_size='${64*1024*1024-physical}B'`);
  const asset='s3://overturemaps-us-west-2/release/2026-09-23.1/theme=places/type=place/part-fixture.zstd.parquet';
  const sql=buildOvertureQuery({release:'2026-09-23.1',lat:40,lng:12,parquetPaths:[asset]}).replaceAll(`'${asset}'`,`'${file}'`);
  const rows=(await conn.runAndReadAll(sql)).getRowObjectsJson();
  assert.equal(rows.length,600);
  assert.equal(new Set(rows.map(row=>row.id)).size,600);
  assert.deepEqual([...new Set(rows.map(row=>row.category))].sort(),['art_gallery','bar','cafe','garden','museum','restaurant']);
  for(const row of rows){assert.deepEqual(row.licenses,['CC0-1.0']);assert.equal(row.operating_status,'open');}
});
