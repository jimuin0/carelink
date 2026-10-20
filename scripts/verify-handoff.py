#!/usr/bin/env python3
"""Verify portable payload; optionally restore only verified regular archive members."""
import hashlib,json,pathlib,sys,tarfile,argparse,os
root=pathlib.Path(__file__).resolve().parent.parent
p=argparse.ArgumentParser();p.add_argument('--restore-to',type=pathlib.Path);a=p.parse_args()
def safe(name):
 q=pathlib.PurePosixPath(name)
 if q.is_absolute() or '..' in q.parts or '\\' in name or not q.parts:raise ValueError('unsafe path')
 return q
m=json.loads((root/'HANDOFF_MANIFEST.json').read_text())
for x in m['files']:
 q=root.joinpath(*safe(x['path']).parts)
 if q.is_symlink() or not q.is_file() or hashlib.sha256(q.read_bytes()).hexdigest()!=x['sha256']:raise ValueError('missing or modified: '+x['path'])
print('Manifest verified:',len(m['files']),'files')
if a.restore_to:
 target=a.restore_to.absolute()
 if target.exists():raise ValueError('destination must not exist')
 with tarfile.open(root/'docs/handoff/restart-evidence.tar.gz','r:gz') as t:
  members=t.getmembers();names=set();payload=[]
  for x in members:
   safe(x.name)
   if not x.isfile() or x.name in names or x.size>10000000:raise ValueError('invalid archive member')
   names.add(x.name);blob=t.extractfile(x).read()
   expected=m['archive_members'].get(x.name)
   if not expected or hashlib.sha256(blob).hexdigest()!=expected:raise ValueError('archive hash mismatch')
   payload.append((x.name,blob))
  if names!=set(m['archive_members']):raise ValueError('missing member')
 target.mkdir(parents=False)
 for name,blob in payload:
  q=target.joinpath(*safe(name).parts);q.parent.mkdir(parents=True,exist_ok=True)
  with q.open('xb') as f:f.write(blob)
 print('Restored verified archive:',len(payload),'files')
