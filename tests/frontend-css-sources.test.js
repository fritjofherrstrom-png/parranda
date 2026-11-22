'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const frontend = path.resolve(__dirname, '../frontend');

test('production Tailwind output is independent of generated browser fixture bundles', {timeout:60000}, async()=>{
  const temp = await fs.mkdtemp(path.join(frontend,'.map-selection-dist-probe-'));
  const compile = () => execFileSync(process.execPath,[path.join(frontend,'node_modules/@tailwindcss/cli/dist/index.mjs'),
    '-i',path.join(frontend,'src/styles/tailwind.css'),'--minify'],{cwd:frontend,encoding:'utf8',maxBuffer:10*1024*1024});
  try {
    const clean=compile();
    await fs.writeFile(path.join(temp,'entry.tsx'),'<div className="h-[707px] text-justify isolate"/>');
    const afterFixture=compile();
    assert.equal(afterFixture,clean,'test-only entry files must not add production utilities');
    assert.ok(!afterFixture.includes('height:707px'));
    assert.ok(afterFixture.includes('.route-map-marker'),'real component styles stay present');
  } finally {await fs.rm(temp,{recursive:true,force:true});}
});
