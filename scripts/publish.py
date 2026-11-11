"""Prepare, commit, push and verify one explicitly authorized Kitchen release.
No repository creation, no photography destination, no force push, no baseline advancement before verification.
"""
import argparse
from datetime import datetime, timezone
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import kitchen as k

_github_env = None


def github_environment():
    """Use existing CLI auth or the official Git credential helper, never a token file.
    The existing github.com credential stays in memory and is not logged or saved.
    """
    global _github_env
    if _github_env is not None: return _github_env
    env=os.environ.copy()
    env.update(GCM_INTERACTIVE='never',GIT_TERMINAL_PROMPT='0',GH_PROMPT_DISABLED='1')
    auth=subprocess.run(['gh','auth','status'],cwd=k.ROOT,env=env,capture_output=True,text=True,encoding='utf8',timeout=30)
    if auth.returncode and not (env.get('GH_TOKEN') or env.get('GITHUB_TOKEN')):
        owner=k.config().get('githubOwner','lhdfwoaini')
        credential=subprocess.run(['git','credential','fill'],input=f'protocol=https\nhost=github.com\nusername={owner}\n\n',
                                  cwd=k.ROOT,env=env,capture_output=True,text=True,encoding='utf8',timeout=30)
        values=dict(line.split('=',1) for line in credential.stdout.splitlines() if '=' in line)
        if credential.returncode or not values.get('password'):
            raise ValueError('没有可用的 GitHub CLI / Git 凭据管理器登录；请在本机完成 gh auth login')
        env['GH_TOKEN']=values['password']
    _github_env=env
    return env


def command(args, check=True):
    env=github_environment() if args[0]=='gh' else {**os.environ,'GCM_INTERACTIVE':'never','GIT_TERMINAL_PROMPT':'0'}
    p=subprocess.run(args,cwd=k.ROOT,env=env,capture_output=True,text=True,encoding='utf8',timeout=60)
    if check and p.returncode: raise ValueError('Command failed: '+args[0]+' '+args[1]+'\n'+p.stderr.strip())
    return p


def preflight():
    c=k.config();blockers=[]
    if not c.get('repository'):blockers.append('未配置独立食谱仓库 repository')
    if not c.get('siteUrl'):blockers.append('未配置食谱 GitHub Pages 地址 siteUrl')
    try:
        login=command(['gh','api','user','--jq','.login']).stdout.strip()
        if login!=c.get('githubOwner','lhdfwoaini'):blockers.append('GitHub 登录账号不匹配：'+login)
    except Exception as exc:blockers.append(str(exc))
    return {'ready':not blockers,'blockers':blockers,'repository':c.get('repository'),'siteUrl':c.get('siteUrl')}


def verify_online(commit):
    c=k.config();url=c['siteUrl'].rstrip('/')+'/'
    expected=k.read(k.local('dist/release.json'))
    def fetch(relative):
        target=url+urllib.parse.quote(relative,safe='/')+'?release='+commit[:12]
        request=urllib.request.Request(target,headers={'User-Agent':'LilD-Kitchen-Verifier','Cache-Control':'no-cache'})
        with urllib.request.urlopen(request,timeout=25) as response:
            if response.status!=200:raise ValueError('HTTP failure: '+relative)
            if not response.url.startswith(url):raise ValueError('Unexpected site redirect')
            return response.read()
    actual=json.loads(fetch('release.json'))
    if actual['siteFingerprint']!=expected['siteFingerprint']:raise ValueError('Pages still serves another version')
    import hashlib
    for p,h in expected['files'].items():
        if hashlib.sha256(fetch(p)).hexdigest()!=h:raise ValueError('Online file mismatch: '+p)
    # This is the only writer of the successful publication baseline.
    state=k.read(k.local(k.STATE))
    baseline={'schema':'lild-kitchen-published-v1','status':'deployed','repository':c['repository'],'siteUrl':url,
              'commit':commit,'verifiedAt':datetime.now(timezone.utc).isoformat(),'siteFingerprint':expected['siteFingerprint'],
              'files':expected['files'],'sources':state['sources'],'images':k.read(k.local('data/images.json'))['images'],
              'recipes':k.read(k.local('data/recipes.json'))['recipes']}
    k.save(k.local(k.PUBLISHED),baseline)
    k.save(k.local('.local/reports/deploy.json'),{'status':'deployed','commit':commit,'siteUrl':url,'verifiedFiles':len(expected['files'])})
    return baseline


def publish(verify_only=False):
    gate=preflight()
    if not gate['ready']:raise ValueError('；'.join(gate['blockers']))
    c=k.config();repo=c['repository']
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+',repo):raise ValueError('Invalid repository')
    owner,name=repo.split('/')
    expected_url=f'https://{owner.lower()}.github.io/{name}/'
    if c['siteUrl'].rstrip('/')+'/'!=expected_url:raise ValueError('Pages URL must match the independently configured repository')
    if command(['git','rev-parse','--show-toplevel']).stdout.strip().replace('\\','/').lower()!=str(k.ROOT).replace('\\','/').lower():raise ValueError('Wrong Git worktree')
    origin=command(['git','remote','get-url','origin']).stdout.strip()
    if origin not in (f'https://github.com/{repo}.git',f'https://github.com/{repo}',f'git@github.com:{repo}.git'):raise ValueError('Origin mismatch')
    if command(['git','branch','--show-current']).stdout.strip()!=c['branch']:raise ValueError('Branch mismatch')
    k.check();k.pack()
    qa=k.read(k.local('data/release-check.json'))
    if not qa.get('passed') or not qa.get('visualReview') or qa['siteFingerprint']!=k.site_fingerprint():raise ValueError('Missing current browser/visual verification')
    commit=command(['git','rev-parse','HEAD']).stdout.strip()
    if verify_only:
        runs=json.loads(command(['gh','run','list','--repo',repo,'--workflow','pages.yml','--commit',commit,'--limit','5','--json','status,conclusion']).stdout)
        if not any(r['status']=='completed' and r['conclusion']=='success' for r in runs):raise ValueError('No successful Pages workflow for this commit yet')
        return verify_online(commit)
    if command(['git','diff','--cached','--name-only']).stdout.strip():raise ValueError('Pre-existing staged changes; review before publishing')
    # Explicit allowlist, including project skill and scripts; excludes raw media/archives.
    allowed=['index.html','assets','data/recipes.json','data/images.json','data/release-check.json','图片/展示图',
             'scripts','docs','.agents/skills/lild-kitchen-update','.github/workflows/pages.yml',
             'README.md','AGENTS.md','kitchen.config.json','.gitignore','.gitattributes','一键预览.cmd']
    reviewed=k.read(k.local('.local/release-files.json'))
    if not isinstance(reviewed,list) or not all(isinstance(p,str) and any(p==a or p.startswith(a+'/') for a in allowed) and '..' not in p.split('/') and not k.local(p).is_dir() for p in reviewed):raise ValueError('Exact reviewed file list is missing or unsafe')
    if command(['git','ls-remote','--heads','origin',c['branch']]).stdout.strip():
        command(['git','fetch','origin',c['branch']])
        remote='origin/'+c['branch']
        if command(['git','merge-base','--is-ancestor',remote,'HEAD'],False).returncode:raise ValueError('Remote diverged or ahead; no automatic merge')
    elif command(['git','ls-remote','--heads','origin']).stdout.strip():raise ValueError('Expected branch missing in a nonempty repository')
    k.backup()
    if reviewed:command(['git','add','--',*reviewed])
    staged=command(['git','diff','--cached','--name-only','-z']).stdout.split('\0')
    if any(p and (p.startswith(('图片/原图/','.local/','dist/')) or p.endswith(('.zip','.env'))) for p in staged):raise ValueError('Private material in staging')
    if any(staged):
        identity=[] if command(['git','var','GIT_AUTHOR_IDENT'],False).returncode==0 else ['-c','user.name=Codex','-c','user.email=codex@localhost']
        command(['git',*identity,'commit','-m','Update Lil D Home Kitchen recipes and assets'])
    commit=command(['git','rev-parse','HEAD']).stdout.strip()
    baseline=k.read(k.local(k.PUBLISHED))
    if baseline.get('commit')==commit and baseline.get('siteFingerprint')==k.site_fingerprint():return {'status':'no-changes','commit':commit}
    pages=json.loads(command(['gh','api',f'repos/{repo}/pages']).stdout)
    if pages.get('build_type')!='workflow':raise ValueError('Enable GitHub Pages / GitHub Actions for this kitchen repository first')
    command(['git','push','--set-upstream','origin',c['branch']])
    k.save(k.local('.local/reports/deploy.json'),{'status':'pushed-not-verified','commit':commit})
    # Bounded, resumable polling; never create a second commit to retry deployment.
    last='Pages workflow not yet visible'
    for _ in range(36):
        runs=json.loads(command(['gh','run','list','--repo',repo,'--workflow','pages.yml','--commit',commit,'--limit','5','--json','status,conclusion,databaseId']).stdout)
        if runs:
            run=runs[0]
            if run['status']=='completed':
                if run['conclusion']!='success':raise ValueError('Pages deployment failed: '+str(run))
                try:return verify_online(commit)
                except Exception as exc:last=str(exc)
        print('Waiting for verified Pages release...',flush=True);time.sleep(5)
    raise ValueError('Not confirmed online: '+last+'; rerun with --verify-only after deployment. Previous baseline retained.')


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--execute',action='store_true');p.add_argument('--verify-only',action='store_true')
    args=p.parse_args()
    try:
        value=publish(args.verify_only) if args.execute or args.verify_only else preflight()
        print(json.dumps(value,ensure_ascii=False,indent=2))
    except Exception as exc:
        print('未发布或未确认上线：'+str(exc),file=sys.stderr);raise SystemExit(1)
