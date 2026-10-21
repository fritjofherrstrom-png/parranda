import pathlib,json,subprocess,sys
p=pathlib.Path(__file__).resolve().parent
sha='a1441a0c73d556959e02fa7bcd0db5c6fc69371a'
image=json.loads((p/'candidate-image.json').read_text());assert image['sha']==sha
args=['docker','run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','256m','--pids-limit','64','--label','qa.owner=codex-pr631-image-proof','-i','--entrypoint','node',image['id'],'-']
r=subprocess.run(args,input=(p/'probe-image.cjs').read_text(),text=True,capture_output=True,check=True);actual=json.loads(r.stdout)
assert actual['sha']==sha and actual['node'].startswith('v22.') and actual['platform']=='linux' and actual['architecture']=='arm64'
expected=json.loads((p/'expected-image-files.json').read_text());assert set(actual['files'])==set(expected)
assert actual['dist_inventory']==sorted(n for n in expected if n.startswith('frontend/dist/'))
for name,want in expected.items():
 assert actual['files'][name]['canonical_sha256']==want['canonical_sha256'],'IMAGE_CONTENT_DRIFT: '+name
actual['image_id']=image['id'];actual['tree']='67b01048ad1a33229cd75982fe46c21da831ed21';actual['canonical_match']=True
(p/'image-source-dist-proof.json').write_text(json.dumps(actual,indent=2)+chr(10))
print(json.dumps({'image_id':image['id'],'sha':sha,'source_files':len(expected),'dist_files':len(actual['dist_inventory']),'source_and_dist_match':True,'only_tolerated_difference':'uid inside astro-island opening tags in HTML'}))
