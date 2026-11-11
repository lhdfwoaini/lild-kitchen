"""Lil D Kitchen: incremental local assets, validation and publish packaging.
Adapted from the inspected lild-photos-update fingerprint/baseline contract.
No Git or network writes. Original photos are always read-only.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
from html.parser import HTMLParser
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import zipfile
from PIL import Image, ImageOps, ImageDraw

sys.dont_write_bytecode = True
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parents[1]
EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp'}
STATE = 'data/本地处理记录.json'
PUBLISHED = 'data/已发布照片清单.json'
VERSION = 'webp-v1-q84-exif-transpose'


def sha(path):
    with Path(path).open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def local(relative):
    p = ROOT / relative
    if not p.resolve().is_relative_to(ROOT.resolve()) or any(part == '..' for part in Path(relative).parts):
        raise ValueError('Path leaves project: ' + str(relative))
    if p.exists() and (p.is_symlink() or p.stat().st_nlink > 1):
        raise ValueError('Linked file refused: ' + str(relative))
    return p


def write(path, value):
    """Atomic and byte-stable: unchanged content keeps its modification time."""
    p = Path(path)
    payload = value if isinstance(value, bytes) else value.encode('utf-8')
    if p.exists() and p.read_bytes() == payload:
        return False
    p.parent.mkdir(parents=True, exist_ok=True)
    temp = p.with_name(p.name + '.tmp')
    temp.write_bytes(payload)
    os.replace(temp, p)
    return True


def save(path, value):
    return write(path, json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def config():
    c = read(local('kitchen.config.json'))
    if c.get('project') != 'lild-home-kitchen':
        raise ValueError('Wrong project')
    if c.get('repository') in c.get('forbiddenRepositories', []):
        raise ValueError('Photography repository is forbidden')
    return c


def inventory():
    folder = local(config()['sourceRoot'])
    if not folder.is_dir():
        raise ValueError('Original photo folder missing; not treated as an empty library')
    files, errors = {}, []
    for base, dirs, names in os.walk(folder, followlinks=False):
        dirs[:] = sorted(d for d in dirs if not d.startswith('.') and not (Path(base)/d).is_symlink()
                         and not getattr(Path(base)/d, 'is_junction', lambda: False)())
        for name in sorted(names):
            p = Path(base)/name
            if name.startswith(('.', '~')) or p.suffix.lower() not in EXTENSIONS:
                continue
            rel = p.relative_to(ROOT).as_posix()
            try:
                local(rel)
                with Image.open(p) as im:
                    im.verify()
                files[rel] = {'sha256': sha(p), 'bytes': p.stat().st_size}
            except Exception as e:
                errors.append({'path': rel, 'error': str(e)})
    return files, errors


def scan():
    current, errors = inventory()
    state = read(local(STATE)) if local(STATE).exists() else {'sources': {}}
    if 'sources' not in state:
        raise ValueError('Damaged processing baseline')
    previous = state['sources']
    changes = {key: [] for key in ('new', 'modified', 'unchanged', 'renamed', 'missing', 'ambiguous', 'duplicates')}
    added, missing = set(current)-set(previous), set(previous)-set(current)
    for p in sorted(set(current) & set(previous)):
        changes['unchanged' if current[p]['sha256'] == previous[p]['sha256'] else 'modified'].append(p)
    for old in sorted(list(missing)):
        candidates = [p for p in added if current[p]['sha256'] == previous[old]['sha256']]
        olds = [p for p in missing if previous[p]['sha256'] == previous[old]['sha256']]
        if len(candidates) == len(olds) == 1 and Path(old).parent == Path(candidates[0]).parent:
            new = candidates[0]
            changes['renamed'].append({'from': old, 'to': new})
            added.remove(new); missing.remove(old)
    for p in sorted(added):
        matches = [q for q in previous if current[p]['sha256'] == previous[q]['sha256']]
        if matches:
            same = [q for q in matches if Path(q).parent == Path(p).parent and q not in missing]
            changes['duplicates' if len(same) == 1 else 'ambiguous'].append({'path': p, 'matches': matches})
        else:
            changes['new'].append(p)
    changes['missing'] = sorted(missing)
    registered = {i['source'] for i in read(local('data/images.json'))['images'] if i['kind'] == 'real'}
    unassigned = sorted(set(current)-registered)
    report = {'schema': 'lild-kitchen-scan-v1', 'changes': changes, 'unassigned': unassigned,
              'errors': errors, 'no_op': not errors and not unassigned and not any(v for k,v in changes.items() if k != 'unchanged'),
              'summary': {k: len(v) for k,v in changes.items()}, 'commit_allowed': False}
    save(local('.local/reports/scan.json'), report)
    return report


def backup():
    paths = [local('index.html'), local('kitchen.config.json')]
    for folder in ('assets', 'data', '图片/展示图'):
        paths += [p for p in local(folder).rglob('*') if p.is_file()]
    name = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    target = local('.local/backups/update-' + name + '.zip')
    target.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as z:
        for p in paths:
            if p.exists(): z.write(p, p.relative_to(ROOT).as_posix())
    return str(target.relative_to(ROOT))


def sync():
    report = scan()
    if report['errors']: raise ValueError(str(report['errors']))
    recipes = read(local('data/recipes.json'))
    registry = read(local('data/images.json'))
    files, _ = inventory()
    folders = {r['sourceFolder']: r for r in recipes['recipes']}
    existing = {i['source']: i for i in registry['images']}
    before = digest([recipes, registry])
    drafts = read(local('data/drafts.json')) if local('data/drafts.json').exists() else {'drafts': []}
    for rename in report['changes']['renamed']:
        if rename['from'] in existing:
            existing[rename['from']]['source'] = rename['to']
    assigned = {i['source'] for i in registry['images']}
    ambiguous = {i['path'] for i in report['changes']['ambiguous']}
    for p in sorted(set(files)-assigned):
        if p in ambiguous: continue
        rel = Path(p).relative_to(config()['sourceRoot'])
        folder = rel.parts[0] if len(rel.parts)>1 else None
        r = folders.get(folder)
        if not r:
            if not any(d['source'] == p for d in drafts['drafts']):
                drafts['drafts'].append({'id': 'draft-'+digest(p)[:12], 'source': p, 'status': 'needs-recipe-text',
                                         'missing': ['菜名', '食材', '实际步骤', '照片对应关系']})
            continue
        # Byte-identical same-recipe aliases do not create duplicate gallery items.
        if any(i.get('recipeId') == r['id'] and i['source'] in files and files[i['source']]['sha256'] == files[p]['sha256'] for i in registry['images']):
            continue
        iid = r['id'] + '-photo-' + files[p]['sha256'][:10]
        registry['images'].append({'id': iid, 'recipeId': r['id'], 'source': p, 'kind': 'real',
                                   'label': '补充实拍', 'alt': r['name']+'的补充实拍', 'focus': '50% 50%'})
        r['photos'].append(iid)
    if digest([recipes, registry]) != before:
        backup()
        save(local('data/recipes.json'), recipes); save(local('data/images.json'), registry)
    if drafts['drafts']: save(local('data/drafts.json'), drafts)
    return {'mapped_changes': digest([recipes, registry]) != before, 'drafts': len(drafts['drafts']), 'scan': report['summary']}


def validate_data(data, registry):
    ids = [r['id'] for r in data['recipes']]
    iids = [i['id'] for i in registry['images']]
    if len(set(ids)) != len(ids) or len(set(iids)) != len(iids): raise ValueError('Duplicate stable ID')
    images = {i['id']: i for i in registry['images']}
    for r in data['recipes']:
        if not re.fullmatch(r'recipe-[a-z0-9-]+', r['id']): raise ValueError('Unsafe recipe ID')
        if r['status'] != 'ready': continue
        for key in ('name','ingredients','steps','record','quick','cover'):
            if not r.get(key): raise ValueError(r['id']+' missing '+key)
        for iid in [r['cover'], *r['photos']]:
            if iid not in images or images[iid]['recipeId'] != r['id']: raise ValueError('Wrong photo mapping: '+iid)
    for im in images.values():
        if not re.fullmatch('[a-z0-9-]+', im['id']): raise ValueError('Unsafe image ID')
        if im['kind'] not in ('real','ai','external'): raise ValueError('Unknown provenance')
        if im['kind'] == 'ai' and (not im.get('references') or any(x not in images for x in im['references'])): raise ValueError('AI image without references')
        if im['kind'] == 'external' and not im.get('license'): raise ValueError('External image without license')


def assets_valid(record):
    return bool(record) and all(local(p).is_file() and sha(local(p)) == h for p,h in record.get('outputs',{}).items())


def build():
    data, registry = read(local('data/recipes.json')), read(local('data/images.json'))
    validate_data(data, registry)
    old = read(local(STATE)) if local(STATE).exists() else {'sources': {}, 'assets': {}}
    sources, errors = inventory()
    if errors: raise ValueError(str(errors))
    image_map, records, changed, warnings = {}, {}, [], []
    by_id = {i['id']:i for i in registry['images']}
    for im in registry['images']:
        iid, path = im['id'], local(im['source'])
        prior = old['assets'].get(iid)
        refs = {r: sources.get(by_id[r]['source'],old['sources'].get(by_id[r]['source'],{})).get('sha256') for r in im.get('references',[])}
        if im['kind'] == 'ai' and prior and prior.get('references') != refs and all(refs.values()):
            if path.exists() and sha(path) == prior.get('source_sha256'):
                raise ValueError('AI cover reference changed; redraw or explicitly review: '+iid)
        if not path.exists():
            if not assets_valid(prior): raise ValueError('Missing source and valid derivative: '+im['source'])
            warnings.append('源图暂缺，保留既有展示图：'+im['source']); record = prior
        else:
            fingerprint = digest({'source': sha(path), 'pipeline': VERSION})
            if prior and prior.get('fingerprint') == fingerprint and assets_valid(prior):
                record = dict(prior)
            else:
                record = {'fingerprint': fingerprint, 'source_sha256': sha(path), 'outputs': {}, 'variants': {}}
                with Image.open(path) as original:
                    corrected = ImageOps.exif_transpose(original).convert('RGB')
                    # Fresh image drops EXIF/GPS/XMP/ICC/comments; never save to source.
                    clean = Image.new('RGB', corrected.size); clean.paste(corrected)
                for size in (640, 1200):
                    result = clean.copy(); result.thumbnail((size,size), Image.Resampling.LANCZOS)
                    dest = config()['displayRoot']+'/'+iid+'-'+str(size)+'.webp'
                    buffer = io.BytesIO(); result.save(buffer, format='WEBP', quality=84, method=6)
                    write(local(dest), buffer.getvalue())
                    record['outputs'][dest] = sha(local(dest))
                    record['variants'][str(size)] = {'src':dest,'width':result.width,'height':result.height}
                changed.append(iid)
            record['references'] = refs
        records[iid] = record
        large, small = record['variants']['1200'], record['variants']['640']
        image_map[iid] = {**large, 'small':small['src'], 'smallWidth':small['width'],
                          **{k:im[k] for k in ('kind','alt','label','focus')}}
    public = {k:data[k] for k in ('brand','title','description')}
    public['recipes'] = [{k:v for k,v in r.items() if k not in ('sourceFolder','status')} for r in data['recipes'] if r['status']=='ready']
    used = {i for r in public['recipes'] for i in [r['cover'], *r['photos']]}
    public['images'] = {i: image_map[i] for i in image_map if i in used}
    code = '/* Generated by scripts/kitchen.py; edit data/recipes.json instead. */\nwindow.KITCHEN_DATA = '+json.dumps(public, ensure_ascii=False, indent=2).replace('</','<\\/')+';\n'
    data_changed = write(local('assets/recipes.js'), code)
    if not local('assets/favicon.png').exists():
        icon = Image.new('RGB',(64,64),'#f8f6f1'); draw=ImageDraw.Draw(icon)
        draw.ellipse((6,6,58,58),outline='#69765c',width=3)
        draw.line((24,20,24,43,41,43),fill='#69765c',width=4)
        icon.save(local('assets/favicon.png'))
    # Missing sources remain in local baseline so future scans continue to report them.
    combined = {p:v for p,v in old['sources'].items() if p not in sources}
    combined.update(sources)
    for item in scan()['changes']['renamed']: combined.pop(item['from'], None)
    state = {'schema':'lild-kitchen-processing-v1','phase':'generated','sources':combined,'assets':records,
             'data_sha256':digest(public),'input_sha256':digest([data,registry])}
    save(local(STATE),state)
    report = {'phase':'generated','images_generated':changed,'data_changed':data_changed,'warnings':warnings}
    save(local('.local/reports/build.json'),report)
    return report


def public_files():
    paths = ['index.html','assets/site.css','assets/site.js','assets/recipes.js','assets/favicon.png']
    public = json.loads(local('assets/recipes.js').read_text('utf-8').split('window.KITCHEN_DATA = ',1)[1].rstrip(';\n'))
    for im in public['images'].values(): paths.extend([im['src'],im['small']])
    return sorted(set(paths))


def site_fingerprint():
    return hashlib.sha256('\n'.join(p+':'+sha(local(p)) for p in public_files()).encode()).hexdigest()


def check():
    data, registry = read(local('data/recipes.json')), read(local('data/images.json'))
    validate_data(data,registry)
    state = read(local(STATE))
    errors = []
    if state['input_sha256'] != digest([data,registry]): errors.append('Data changed after build')
    class Reader(HTMLParser):
        def handle_starttag(self,tag,attrs):
            for k,v in attrs:
                if k in ('src','href') and v and not v.startswith('#'):
                    if ':' in v or v.startswith('/') or not local(v).is_file(): errors.append('Bad resource: '+v)
    Reader().feed(local('index.html').read_text('utf8'))
    for p in public_files():
        path=local(p)
        if not path.is_file(): errors.append('Missing: '+p); continue
        if path.suffix in ('.webp','.png'):
            with Image.open(path) as im:
                im.load()
                if im.getexif() or any(k in im.info for k in ('xmp','exif','comment')): errors.append('Private metadata: '+p)
    for iid,record in state['assets'].items():
        if not assets_valid(record): errors.append('Derivative differs from manifest: '+iid)
    for p in ('assets/site.js','assets/recipes.js'):
        result=subprocess.run(['node','--check',str(local(p))],capture_output=True,text=True,encoding='utf8')
        if result.returncode: errors.append(result.stderr)
    report={'phase':'checked-static','passed':not errors,'errors':errors,'siteFingerprint':site_fingerprint(),
            'recipeCount':len([r for r in data['recipes'] if r['status']=='ready']),
            'imageCount':len(registry['images']),'bytes':sum(local(p).stat().st_size for p in public_files()),
            'browserCheck':'required separately'}
    save(local('.local/reports/check.json'),report)
    if errors: raise ValueError(str(errors))
    return report


def pack():
    checked=check()
    target=local(config()['output']); target.mkdir(parents=True,exist_ok=True)
    files=public_files()
    # Allowlist only; any unexpected file fails instead of silently cleaning it.
    allowed=set(files)|{'.nojekyll','release.json'}
    unexpected=[p.relative_to(target).as_posix() for p in target.rglob('*') if p.is_file() and p.relative_to(target).as_posix() not in allowed]
    if unexpected: raise ValueError('Unexpected release files; review before removing: '+str(unexpected))
    for p in files: write(target/p,local(p).read_bytes())
    write(target/'.nojekyll',b'')
    release={'schema':'lild-kitchen-release-v1','siteFingerprint':checked['siteFingerprint'],
             'files':{p:sha(local(p)) for p in files},'recipeCount':checked['recipeCount']}
    save(target/'release.json',release)
    save(local('.local/reports/release.json'),{'phase':'prepared-not-deployed',**release})
    return {'phase':'prepared-not-deployed','directory':str(target),'files':len(files),'bytes':checked['bytes']}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=['scan','sync','build','check','pack','backup'])
    args=parser.parse_args()
    try:
        config()
        print(json.dumps(globals()[args.command](),ensure_ascii=False,indent=2))
    except Exception as exc:
        print('操作未完成：'+str(exc),file=sys.stderr); return 1
    return 0


if __name__=='__main__': raise SystemExit(main())
