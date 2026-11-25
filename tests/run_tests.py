"""Offline tests for skills/gamma/scripts/generate.ts. No network, no credits.
Run: python3 tests/run_tests.py   (needs Bun; macOS or Linux for the TTY test)
Each case uses a throwaway HOME and a fake fetch (tests/mock-fetch.ts)."""
import os, subprocess, tempfile, json, stat, pty, time, select, sys, shutil, atexit
HERE=os.path.dirname(os.path.abspath(__file__))
SCRIPT=os.path.join(HERE,'..','skills','gamma','scripts','generate.ts')
SCRIPT=os.path.abspath(SCRIPT)
T=tempfile.mkdtemp(prefix='gamma-skill-tests-')
atexit.register(shutil.rmtree, T, ignore_errors=True)
BUN=shutil.which('bun') or os.path.expanduser('~/.bun/bin/bun')
KEY='sk-gamma-FAKEKEY0123456789abcdef'
results=[]
def check(name, cond, detail=''):
    results.append((name, bool(cond), detail)); print(('PASS' if cond else 'FAIL'), name, '' if cond else detail[:400])
def newhome(with_key=False, mode=0o600):
    h=tempfile.mkdtemp(prefix='gh-', dir=T); os.makedirs(os.path.join(h,'Downloads'))
    if with_key:
        os.makedirs(os.path.join(h,'.gamma')); p=os.path.join(h,'.gamma','config.json')
        open(p,'w').write(json.dumps({'api_key':KEY})); os.chmod(p,mode)
    return h
def run(args, home, stdin=None, scenario='ok', preload=True, extra_env=None):
    env={k:v for k,v in os.environ.items() if k not in ('GAMMA_API_KEY','CODEX_SANDBOX_NETWORK_DISABLED')}
    env['HOME']=home; env['MOCK_SCENARIO']=scenario; env['MOCK_LOG']=os.path.join(home,'mocklog.json')
    env.update(extra_env or {})
    cmd=[BUN]+(['--preload',os.path.join(HERE,'mock-fetch.ts')] if preload else [])+[SCRIPT]+args
    p=subprocess.run(cmd,input=stdin,capture_output=True,text=True,env=env,timeout=60)
    return p
def mocklog(home):
    try: return json.load(open(os.path.join(home,'mocklog.json')))
    except: return []
def nokey(p): return KEY not in p.stdout and KEY not in p.stderr

# 1 help
h=newhome(); p=run(['--help'],h); check('help exits 0', p.returncode==0 and 'Usage' in p.stdout)
# 2 unknown flag
p=run(['--bogus'],h); check('unknown flag rejected', p.returncode==1 and 'Unknown option: --bogus' in p.stderr, p.stderr)
# 3 bad values
p=run(['--topic','x','--pages','0'],h); check('pages 0 rejected', p.returncode==1 and 'positive whole number' in p.stderr, p.stderr)
p=run(['--topic','x','--format','docx'],h); check('format docx rejected', p.returncode==1 and 'must be one of' in p.stderr, p.stderr)
p=run(['--topic'],h); check('missing value rejected', p.returncode==1 and 'needs a value' in p.stderr, p.stderr)
# 4 no key
p=run(['--topic','x'],h); check('no key -> exit 1 with setup cmd', p.returncode==1 and '--setup' in p.stderr and SCRIPT in p.stderr and 'Never paste' in p.stderr, p.stderr)
check('no key -> no network call', mocklog(h)==[])
# 5 setup via pipe
h=newhome(); p=run(['--setup'],h,stdin=KEY+'\n')
cfg=os.path.join(h,'.gamma','config.json')
ok=os.path.exists(cfg) and json.load(open(cfg))=={'api_key':KEY}
check('setup pipe saves key', p.returncode==0 and ok, p.stdout+p.stderr)
check('setup file mode 600', oct(os.stat(cfg).st_mode&0o777)=='0o600', oct(os.stat(cfg).st_mode&0o777))
check('setup dir mode 700', oct(os.stat(os.path.dirname(cfg)).st_mode&0o777)=='0o700')
check('setup does not print key', nokey(p))
# 6 setup over existing 644 file, bracketed paste markers
h=newhome(with_key=True, mode=0o644); p=run(['--setup'],h,stdin='\x1b[200~sk-gamma-NEW999\x1b[201~\n')
cfg=os.path.join(h,'.gamma','config.json')
check('setup replaces + strips paste markers', p.returncode==0 and 'Replaced' in p.stdout and json.load(open(cfg))=={'api_key':'sk-gamma-NEW999'}, p.stdout+p.stderr+open(cfg).read())
check('replaced file tightened to 600', oct(os.stat(cfg).st_mode&0o777)=='0o600')
# 7 setup rejects empty / spaces
h=newhome(); p=run(['--setup'],h,stdin='   \n'); check('setup rejects empty', p.returncode==1 and not os.path.exists(os.path.join(h,'.gamma','config.json')), p.stderr)
p=run(['--setup'],h,stdin='sk gamma\n'); check('setup rejects spaces', p.returncode==1)
# 8 setup via real TTY (hidden input)
h=newhome(); env={k:v for k,v in os.environ.items() if k!='GAMMA_API_KEY'}; env['HOME']=h
pid,fd=pty.fork()
if pid==0:
    os.execve(BUN,[BUN,SCRIPT,'--setup'],env)
out=b''; t0=time.time(); sent=False
while time.time()-t0<20:
    r,_,_=select.select([fd],[],[],0.2)
    if r:
        try: chunk=os.read(fd,4096)
        except OSError: break
        if not chunk: break
        out+=chunk
    if not sent and b'Paste your Gamma API key' in out:
        os.write(fd,(KEY+'x').encode()); time.sleep(0.2); os.write(fd,b'\x7f'); time.sleep(0.2); os.write(fd,b'\r'); sent=True
_,status=os.waitpid(pid,0)
cfg=os.path.join(h,'.gamma','config.json')
check('tty setup saves key (backspace works)', os.path.exists(cfg) and json.load(open(cfg))=={'api_key':KEY}, out.decode(errors='ignore'))
check('tty setup does not echo key', KEY.encode() not in out, out.decode(errors='ignore'))
# 9 dry run
h=newhome(); p=run(['--topic','Roadmap','--pages','5','--dry-run'],h)
try: d=json.loads(p.stdout)
except Exception: d={}
b=d.get('body',{})
check('dry-run body', p.returncode==0 and b.get('sharingOptions')=={'externalAccess':'noAccess'} and b.get('exportAs')=='pdf' and b.get('numCards')==5 and b.get('format')=='presentation', p.stdout+p.stderr)
check('dry-run no network', mocklog(h)==[])
# 10 full generate flow (mock)
h=newhome(with_key=True); p=run(['--topic','Roadmap','--format','pdf','--external-access','view'],h)
lg=mocklog(h); post=[x for x in lg if x['method']=='POST']
hdr=post[0]['headers'] if post else {}
body=json.loads(post[0]['body']) if post else {}
saved=[f for f in os.listdir(os.path.join(h,'Downloads'))]
last=json.loads(p.stdout.strip().splitlines()[-1]) if p.stdout.strip() else {}
check('generate: POST with X-API-KEY', post and hdr.get('X-API-KEY')==KEY and post[0]['u']=='https://public-api.gamma.app/v1.0/generations', json.dumps(post)[:300])
check('generate: external access passed', body.get('sharingOptions')=={'externalAccess':'view'})
check('generate: saved pdf to Downloads', p.returncode==0 and len(saved)==1 and saved[0].endswith('.pdf') and open(os.path.join(h,'Downloads',saved[0]),'rb').read(5)==b'%PDF-', p.stdout+p.stderr)
check('generate: json summary', last.get('downloaded') is True and last.get('creditsDeducted')==42 and last.get('generationId')=='gen123', p.stdout)
check('generate: key not printed', nokey(p))
# 11 html export is not saved
h=newhome(with_key=True); p=run(['--topic','x'],h,scenario='html')
check('html export rejected, nothing saved', p.returncode==0 and os.listdir(os.path.join(h,'Downloads'))==[] and 'not a PDF or PPTX' in p.stdout, p.stdout+p.stderr)
# 12 wanted pptx but got pdf
h=newhome(with_key=True); p=run(['--topic','x','--format','pptx'],h)
check('format mismatch not saved', os.listdir(os.path.join(h,'Downloads'))==[] and 'expected pptx but got pdf' in p.stdout, p.stdout+p.stderr)
# 13 timeout -> exit 2 + resume command, no second POST
h=newhome(with_key=True); p=run(['--topic','x','--max-wait','1'],h,scenario='pending')
check('timeout exit 2 + resume hint', p.returncode==2 and '--resume gen123' in p.stderr and 'Do NOT start' in p.stderr, p.stdout+p.stderr)
check('timeout only one POST', len([x for x in mocklog(h) if x['method']=='POST'])==1)
# 14 resume -> completes, no POST
h=newhome(with_key=True); p=run(['--resume','gen123'],h)
lg=mocklog(h)
check('resume completes without POST', p.returncode==0 and not [x for x in lg if x['method']=='POST'] and 'Saved to' in p.stdout, p.stdout+p.stderr)
# 15 failed generation
h=newhome(with_key=True); p=run(['--topic','x'],h,scenario='failed')
check('failed generation -> exit 1', p.returncode==1 and 'boom' in p.stderr, p.stderr)
# 16 check
h=newhome(with_key=True); p=run(['--check'],h)
check('check prints plan/credits, not email', p.returncode==0 and 'credits left: 400' in p.stdout and 'secret@example.com' not in p.stdout, p.stdout+p.stderr)
p=run(['--check'],h,scenario='badkey')
check('check bad key -> hint, no key printed', p.returncode==1 and 'run --setup again' in p.stderr and nokey(p), p.stderr)
# 17 env var takes priority
h=newhome(); env_key='sk-gamma-ENVKEY'
env={k:v for k,v in os.environ.items()}; env.update(HOME=h, GAMMA_API_KEY=env_key, MOCK_SCENARIO='ok', MOCK_LOG=os.path.join(h,'mocklog.json'))
p=subprocess.run([BUN,'--preload',os.path.join(HERE,'mock-fetch.ts'),SCRIPT,'--check'],capture_output=True,text=True,env=env)
lg=mocklog(h); check('env key used', p.returncode==0 and lg and lg[0]['headers'].get('X-API-KEY')==env_key)
# 18 content tip
h=newhome(with_key=True); open(os.path.join(h,'c.md'),'w').write('a\n---\nb\n')
p=run(['--content-file',os.path.join(h,'c.md'),'--dry-run'],h); check('separator tip', 'Tip:' in p.stdout)
print('\nSUMMARY', sum(1 for r in results if r[1]), '/', len(results))

print('\n--- review-fix cases')
h=newhome(with_key=True); p=run(['--topic','x'],h,scenario='flaky')
check('503 then ok: retried and saved', p.returncode==0 and 'retrying' in p.stderr and 'Saved to' in p.stdout, p.stdout+p.stderr)
h=newhome(with_key=True); p=run(['--topic','x'],h,scenario='netfail')
check('poll network failure -> exit 2 + resume', p.returncode==2 and '--resume gen123' in p.stderr and len([x for x in mocklog(h) if x['method']=='POST'])==1, p.stdout+p.stderr)
h=newhome(with_key=True); p=run(['--topic','x'],h,scenario='dlfail')
check('download throws -> resume hint, exit 0', p.returncode==0 and 'connection reset' in p.stdout and '--resume gen123' in p.stdout, p.stdout+p.stderr)
h=newhome(with_key=True); p=run(['--topic','x'],h,scenario='warn')
check('POST warnings printed', 'Gamma warning (tell the user): externalAccess was ignored' in p.stdout, p.stdout)
h=newhome(with_key=True); p=run(['--topic','x'],h,scenario='nocredit')
check('402 hint', p.returncode==1 and 'out of credits' in p.stderr, p.stderr)
h=newhome(with_key=True); p=run(['--topic','x'],h,scenario='postnet')
check('POST network error warns to check dashboard', p.returncode==1 and 'check gamma.app' in p.stderr, p.stderr)
h=newhome(); p=run(['--content','---\n# Title\n---\nB','--dry-run'],h)
check('content starting with --- accepted', p.returncode==0 and '"inputText": "---' in p.stdout, p.stdout+p.stderr)
h=newhome(with_key=True); p=run(['--topic','x','--output',os.path.join(h,'out.pptx')],h)
check('output ext mismatch not saved', not os.path.exists(os.path.join(h,'out.pptx')) and 'ends in .pptx' in p.stdout, p.stdout+p.stderr)
h=newhome(); p=run(['--setup'],h,stdin='abc123\n')
check('unusual prefix note', p.returncode==0 and 'usually start with' in p.stdout, p.stdout)
p=run(['--setup'],h,stdin='sk-gamma-a\x1bb\n'); check('control chars rejected', p.returncode==1 and 'control characters' in p.stderr, p.stderr)
print('\nSUMMARY2', sum(1 for r in results if r[1]), '/', len(results))

print('\n--- windows / sandbox cases')
SB={'CODEX_SANDBOX_NETWORK_DISABLED':'1'}
h=newhome(with_key=True); p=run(['--check'],h,extra_env=SB)
check('sandbox: --check exits 3, no request', p.returncode==3 and 'no internet access' in p.stderr and mocklog(h)==[], p.stdout+p.stderr)
p=run(['--topic','x'],h,extra_env=SB)
check('sandbox: generate exits 3, no POST', p.returncode==3 and mocklog(h)==[], p.stdout+p.stderr)
p=run(['--resume','gen123'],h,extra_env=SB)
check('sandbox: resume exits 3, no request', p.returncode==3 and mocklog(h)==[], p.stdout+p.stderr)
p=run(['--topic','x','--dry-run'],h,extra_env=SB)
check('sandbox: dry-run still works', p.returncode==0 and '"inputText"' in p.stdout, p.stdout+p.stderr)
h=newhome(); p=run(['--topic','x'],h,extra_env=SB)
check('sandbox + no key: setup message first', p.returncode==1 and '--setup' in p.stderr, p.stderr)
ZH='# 標題\n\n---\n\n## 第二頁 $5 "引號"\n'
h=newhome(); f=os.path.join(h,'u16.md'); open(f,'wb').write(b'\xff\xfe'+ZH.encode('utf-16-le'))
p=run(['--content-file',f,'--dry-run'],h)
try: got=json.loads(p.stdout[p.stdout.index('{'):])['body']['inputText']
except Exception: got=None
check('content-file UTF-16LE BOM decoded', p.returncode==0 and got==ZH, p.stdout+p.stderr)
f=os.path.join(h,'u8bom.md'); open(f,'wb').write(b'\xef\xbb\xbf'+ZH.encode('utf-8'))
p=run(['--content-file',f,'--dry-run'],h)
try: got=json.loads(p.stdout[p.stdout.index('{'):])['body']['inputText']
except Exception: got=None
check('content-file UTF-8 BOM stripped', p.returncode==0 and got==ZH, p.stdout+p.stderr)
f=os.path.join(h,'big5.md'); open(f,'wb').write('# 標題\n'.encode('cp950'))
p=run(['--content-file',f,'--dry-run'],h)
check('content-file Big5 refused', p.returncode==1 and 'not saved as UTF-8' in p.stderr, p.stdout+p.stderr)
f=os.path.join(h,'u16nobom.md'); open(f,'wb').write(ZH.encode('utf-16-le'))
p=run(['--content-file',f,'--dry-run'],h)
check('content-file UTF-16 without BOM refused', p.returncode==1 and 'not saved as UTF-8' in p.stderr, p.stdout+p.stderr)
f=os.path.join(h,'crlf.md'); open(f,'wb').write(b'# A\r\n---\r\n## B\r\n')
p=run(['--content-file',f,'--dry-run'],h)
try: got=json.loads(p.stdout[p.stdout.index('{'):])['body']['inputText']
except Exception: got=None
check('content-file CRLF normalized + tip shown', p.returncode==0 and got=='# A\n---\n## B\n' and 'Tip:' in p.stdout, p.stdout+p.stderr)
h=newhome(with_key=True); p=run(['--topic','x'],h,scenario='postnet')
check('POST network error mentions sandbox case', p.returncode==1 and 'nothing reached Gamma' in p.stderr, p.stderr)
# TTY: Enter with nothing pasted
h=newhome(); env={k:v for k,v in os.environ.items() if k!='GAMMA_API_KEY'}; env['HOME']=h
pid,fd=pty.fork()
if pid==0:
    os.execve(BUN,[BUN,SCRIPT,'--setup'],env)
out=b''; t0=time.time(); sent=False
while time.time()-t0<20:
    r,_,_=select.select([fd],[],[],0.2)
    if r:
        try: chunk=os.read(fd,4096)
        except OSError: break
        if not chunk: break
        out+=chunk
    if not sent and b'Paste your Gamma API key' in out:
        os.write(fd,b'\r'); sent=True
_,status=os.waitpid(pid,0)
check('tty empty paste -> clear hint, nothing saved', b'Nothing was pasted' in out and not os.path.exists(os.path.join(h,'.gamma','config.json')), out.decode(errors='ignore'))
print('\nSUMMARY3', sum(1 for r in results if r[1]), '/', len(results))

sys.exit(0 if all(r[1] for r in results) else 1)
