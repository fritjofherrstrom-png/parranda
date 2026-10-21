import copy,hashlib,http.client,json,os,pathlib,socket,subprocess,sys,time,urllib.request,urllib.parse,uuid
os.umask(0o077)
ROOT=pathlib.Path(__file__).resolve().parent
SHA='a1441a0c73d556959e02fa7bcd0db5c6fc69371a'
BASE='0643bc56202a8d1d552ea09e302a0bb0a1cd2aca'
TREE='67b01048ad1a33229cd75982fe46c21da831ed21'
NAMES=['parranda-stage-563-564-web','parranda-stage-563-564-source-worker']
PROTECTED=['parranda-stage-563-564-db','parranda-stage-563-564-search','parranda-stage-563-564-tunnel']
TAG='parranda-pr631:'+SHA
OWNER='codex-pr631-controlled-runtime'
class UnixHTTP(http.client.HTTPConnection):
 def connect(self):
  self.sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);self.sock.settimeout(self.timeout);self.sock.connect('/var/run/docker.sock')

def api(method,path,body=None):
 c=UnixHTTP('localhost',timeout=60)
 c.request(method,'/v1.47'+path,body=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json'})
 r=c.getresponse();b=r.read();c.close()
 if r.status>=300:raise RuntimeError('Docker API '+str(r.status)+' '+b.decode()[:160])
 return json.loads(b) if b else None

def inspect(n):return api('GET','/containers/'+n+'/json')

def maybe(n):
 try:return inspect(n)
 except RuntimeError as e:
  if 'Docker API 404' in str(e):return None
  raise

def record(name,value):
 p=ROOT/name;tmp=ROOT/(name+'.tmp-'+uuid.uuid4().hex)
 with tmp.open('x') as f:
  f.write(json.dumps(value,indent=2)+'\n');f.flush();os.fsync(f.fileno())
 os.replace(tmp,p)

def read(name):return json.loads((ROOT/name).read_text())

def env(c):return dict(v.split('=',1) for v in c['Config']['Env'] if '=' in v)

def mounts(c):return sorted((m['Type'],m['Source'],m['Destination'],m['RW']) for m in c['Mounts'])

def digest(c):
 nets={n:{k:v for k,v in ep.items() if k in ['NetworkID','IPAMConfig','Links','Aliases','DriverOpts','GwPriority']} for n,ep in c['NetworkSettings']['Networks'].items()}
 for ep in nets.values():
  if isinstance(ep.get('Aliases'),list):ep['Aliases']=sorted(ep['Aliases'])
 data={'Config':c['Config'],'HostConfig':c['HostConfig'],'Mounts':mounts(c),'Networks':nets}
 return hashlib.sha256(json.dumps(data,sort_keys=True,separators=(',',':')).encode()).hexdigest()

def summary(c):
 e=env(c);return {'name':c['Name'].lstrip('/'),'id':c['Id'],'image_id':c['Image'],'sha':e.get('PARRANDA_BUILD_SHA'),
  'reader_disabled':e.get('PARRANDA_EVENT_READER')=='disabled','running':c['State']['Running'],'paused':c['State']['Paused'],
  'health':c['State'].get('Health',{}).get('Status'),'restart_count':c['RestartCount'],'config_digest':digest(c)}

def health():
 with urllib.request.urlopen('http://127.0.0.1:18518/api/health',timeout=5) as response: h=json.load(response)
 assert h.get('ok') is True and h.get('build_sha')==BASE,'PUBLIC_RELEASE_CHANGED'
 return h
def guard():
 for n,old in read('originals-private.json').items():
  c=inspect(n)
  assert c['Id']==old['Id'] and digest(c)==digest(old) and c['State']['Running'] and not c['State']['Paused'],'SHARED_TARGET_CHANGED: '+n
  observed=read('reconnect-observation.json').get(n) if (ROOT/'reconnect-observation.json').exists() else None
  if observed:
   assert n=='parranda-stage-563-564-source-worker' and old['RestartCount']==1 and observed['restart_count']==2 and observed['id']==old['Id'] and observed['config_digest']==digest(old),'INVALID_RECONNECT_OBSERVATION'
   assert c['RestartCount']==observed['restart_count'] and c['State']['StartedAt']==observed['started_at'],'SHARED_TARGET_CHANGED_AFTER_RECONNECT: '+n
  else:assert c['RestartCount']==old['RestartCount'],'SHARED_TARGET_RESTARTED: '+n
 for name,old in read('volumes-private.json').items():
  current=api('GET','/volumes/'+urllib.parse.quote(name,safe=''))
  for key in ['Name','Driver','Mountpoint','Labels','Options','Scope']:assert current.get(key)==old.get(key),'SHARED_VOLUME_CONFIG_CHANGED'
 assert inspect(NAMES[0])['State']['Health']['Status']=='healthy'
 return health()
def prepare():
 assert not (ROOT/'originals-private.json').exists(),'snapshot exists; refuse overwrite'
 originals={name:inspect(name) for name in NAMES+PROTECTED}
 targets=[originals[n] for n in NAMES]
 for c in targets:
  assert env(c).get('PARRANDA_BUILD_SHA')==BASE and env(c).get('PARRANDA_EVENT_READER')=='disabled'
  assert c['State']['Running'] and not c['State']['Paused'] and not c['HostConfig'].get('AutoRemove')
 assert targets[0]['Image']==targets[1]['Image']
 volumes={m['Name']:api('GET','/volumes/'+urllib.parse.quote(m['Name'],safe='')) for c in originals.values() for m in c['Mounts'] if m['Type']=='volume'}
 record('originals-private.json',originals);record('volumes-private.json',volumes)
 im=api('GET','/images/'+targets[0]['Image']+'/json')
 backup='parranda-rollback:pr631-0643bc5-20261021'
 check=subprocess.run(['docker','image','inspect',backup,'--format','{{.Id}}'],capture_output=True,text=True)
 if check.returncode==0:assert check.stdout.strip()==im['Id']
 else:subprocess.run(['docker','image','tag',im['Id'],backup],check=True,capture_output=True)
 assert api('GET','/images/'+backup+'/json')['Id']==im['Id']
 out={'prepared':True,'targets':[summary(c) for c in targets],'protected':[summary(originals[n]) for n in PROTECTED],'volume_names':sorted(volumes),'health':guard(),'rollback_image_tag':backup,'rollback_image_id':im['Id'],'rollback_repo_digests':im.get('RepoDigests',[]),'private_original_configuration_preserved_on_pi':True,'public_services_replaced_or_paused':False}
 record('preflight.json',out);print(json.dumps(out))
def image():
 guard();im=api('GET','/images/'+TAG+'/json')
 assert im['Architecture']=='arm64' and im['Os']=='linux'
 assert im['Config']['Labels']['org.opencontainers.image.revision']==SHA
 assert dict(v.split('=',1) for v in im['Config']['Env'])['PARRANDA_BUILD_SHA']==SHA
 limits=['--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','256m','--pids-limit','64','--label','qa.owner='+OWNER,'--entrypoint','node']
 command='console.log(JSON.stringify({node:process.version,architecture:process.arch,platform:process.platform,sha:process.env.PARRANDA_BUILD_SHA}))'
 runtime=json.loads(subprocess.check_output(['docker','run',*limits,im['Id'],'-e',command],text=True))
 assert runtime['node'].startswith('v22.') and runtime['architecture']=='arm64' and runtime['platform']=='linux' and runtime['sha']==SHA
 native=json.loads(subprocess.check_output(['docker','run',*limits,im['Id'],'scripts/check-native-runtime.js'],text=True))
 assert native['status']=='native_runtime_ready' and native['architecture']=='arm64'
 out={'id':im['Id'],'sha':SHA,'tree':TREE,'architecture':im['Architecture'],'os':im['Os'],'repo_digests':im.get('RepoDigests',[]),'node_runtime':runtime,'native_runtime':native,'image_tag':TAG}
 record('candidate-image.json',out);guard();print(json.dumps(out))
def start():
 guard();plan=read('candidate-image.json');im=api('GET','/images/'+plan['id']+'/json');assert im['Id']==plan['id']
 name='codex-pr631-runtime-'+SHA[:7]; netname=name+'-net';labels={'qa.owner':OWNER,'qa.sha':SHA}
 assert maybe(name) is None and not (ROOT/'owned-runtime.json').exists()
 assert not api('GET','/networks?filters='+urllib.parse.quote(json.dumps({'name':[netname]})))
 network=api('POST','/networks/create',{'Name':netname,'Driver':'bridge','Internal':True,'Labels':labels})
 record('owned-network.json',{'id':network['Id'],'labels':labels,'name':netname})
 cfg={'Image':im['Id'],'User':'node','WorkingDir':'/app','Env':['NODE_ENV=production','PARRANDA_BUILD_SHA='+SHA,'PARRANDA_EVENT_READER=disabled','PARRANDA_RUNTIME_PROFILE=controlled-pr631'],'Cmd':['node','/qa/controlled-bootstrap.cjs'],'Labels':labels,
 'HostConfig':{'Binds':[str(ROOT/'controlled-bootstrap.cjs')+':/qa/controlled-bootstrap.cjs:ro'],'NetworkMode':netname,'ReadonlyRootfs':True,'Tmpfs':{'/tmp':'rw,nosuid,size=64m','/var/lib/parranda':'rw,nosuid,size=64m,uid=1000,gid=1000'},'Memory':805306368,'NanoCpus':1000000000,'PidsLimit':128,'CapDrop':['ALL'],'SecurityOpt':['no-new-privileges:true'],'RestartPolicy':{'Name':'no'}},'NetworkingConfig':{'EndpointsConfig':{netname:{}}}}
 made=api('POST','/containers/create?name='+name,cfg)
 owned={'name':name,'id':made['Id'],'image_id':im['Id'],'network_id':network['Id'],'network_name':netname,'labels':labels,'sha':SHA};record('owned-runtime.json',owned)
 api('POST','/containers/'+made['Id']+'/start');c=inspect(name)
 assert c['Image']==im['Id'] and c['State']['Running'] and c['HostConfig']['ReadonlyRootfs']
 assert len(c['Mounts'])==1 and c['Mounts'][0]['Destination']=='/qa/controlled-bootstrap.cjs' and not c['Mounts'][0]['RW']
 assert not any(c['NetworkSettings']['Ports'].values())
 assert env(c).get('PARRANDA_EVENT_READER')=='disabled'
 ip=c['NetworkSettings']['Networks'][netname]['IPAddress']
 for i in range(30):
  try:
   with urllib.request.urlopen('http://'+ip+':8000/api/health',timeout=2) as response:h=json.load(response)
   assert h['build_sha']==SHA and h['ok'] is True;break
  except Exception:
   if i==29:raise
   time.sleep(.5)
 guard();out={**owned,'health':h,'ssh_forward_target':ip+':8000','isolated_network':True,'no_published_ports':True,'no_shared_volumes_or_environment':True,'readonly_product_image':True};record('runtime-launch.json',out);print(json.dumps(out))
def cleanup():
 if not (ROOT/'owned-runtime.json').exists():
  if not (ROOT/'owned-network.json').exists():
   guard();print(json.dumps({'nothing_created':True,'shared_targets_unchanged':True}));return
  ownednet=read('owned-network.json');network=api('GET','/networks/'+ownednet['id'])
  assert network['Id']==ownednet['id'] and network['Internal'] and network['Labels']==ownednet['labels'] and not network['Containers'],'NETWORK_ONLY_CLEANUP_OWNERSHIP_CHANGED'
  api('DELETE','/networks/'+ownednet['id']);guard()
  out={'sha':SHA,'owned_container_created':False,'owned_internal_network_removed':True,'shared_targets_unchanged':True};record('runtime-cleanup.json',out);print(json.dumps(out));return
 owned=read('owned-runtime.json');c=inspect(owned['name'])
 assert c['Id']==owned['id'] and c['Image']==owned['image_id'] and all(c['Config']['Labels'].get(k)==v for k,v in owned['labels'].items())
 if c['State']['Running']:api('POST','/containers/'+c['Id']+'/stop?t=10')
 c=inspect(owned['name']);raw=subprocess.check_output(['docker','logs',owned['id']],stderr=subprocess.STDOUT,text=True)
 record('runtime-log-summary.json',{'sha':SHA,'exit_code':c['State']['ExitCode'],'lines':[json.loads(line) for line in raw.splitlines() if line.startswith('{') and ('controlled_' in line)]})
 network=api('GET','/networks/'+owned['network_id']);assert network['Internal'] and network['Labels']==owned['labels'] and set(network['Containers']).issubset({owned['id']})
 api('DELETE','/containers/'+owned['id']);api('DELETE','/networks/'+owned['network_id']);guard()
 out={'sha':SHA,'image_id':owned['image_id'],'owned_container_removed':True,'owned_internal_network_removed':True,'exit_code':c['State']['ExitCode'],'shared_targets_unchanged':True,'public_health':health()};record('runtime-cleanup.json',out);print(json.dumps(out))
if __name__=='__main__':{'prepare':prepare,'guard':lambda:print(json.dumps({'originals_unchanged':True,'health':guard()})),'image':image,'start':start,'cleanup':cleanup}[sys.argv[1]]()
