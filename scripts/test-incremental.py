"""Risk-focused tests in an isolated project copy; never imports fixtures into production."""
import copy
import json
from pathlib import Path
import re
import shutil
import tempfile
import unittest
import zipfile
from PIL import Image
import kitchen as k

REAL_ROOT=k.ROOT


class KitchenTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='incremental-',dir=REAL_ROOT/'.local')
        self.root=Path(self.tmp.name)
        for p in ('index.html','kitchen.config.json'):
            shutil.copy2(REAL_ROOT/p,self.root/p)
        for p in ('data','assets','图片','.local/generated'):
            shutil.copytree(REAL_ROOT/p,self.root/p)
        k.ROOT=self.root
        self.old_recipes=k.read(k.local('data/recipes.json'))
        self.old_published=k.local(k.PUBLISHED).read_bytes()

    def tearDown(self):
        k.ROOT=REAL_ROOT
        self.tmp.cleanup()

    def picture(self,folder,name='新增.png',color='blue'):
        p=k.local('图片/原图/'+folder+'/'+name);p.parent.mkdir(parents=True,exist_ok=True)
        Image.new('RGB',(61,47),color).save(p)
        return p

    def test_noop_twice_preserves_bytes_and_mtimes(self):
        paths=[k.local('data/recipes.json'),k.local('data/images.json'),k.local(k.STATE),*[k.local(p) for p in k.public_files()]]
        before={p:(k.sha(p),p.stat().st_mtime_ns) for p in paths}
        self.assertTrue(k.scan()['no_op']);self.assertEqual(k.build()['images_generated'],[])
        self.assertTrue(k.scan()['no_op']);self.assertEqual(k.build()['images_generated'],[])
        self.assertEqual(before,{p:(k.sha(p),p.stat().st_mtime_ns) for p in paths})

    def test_known_recipe_new_photo_and_duplicate(self):
        p=self.picture('空气炸锅牛扒')
        shutil.copy2(p,p.with_name('同图别名.png'))
        k.sync();k.build()
        now=k.read(k.local('data/recipes.json'))
        self.assertEqual(len(now['recipes']),len(self.old_recipes['recipes']))
        self.assertEqual(len(now['recipes'][0]['photos']),len(self.old_recipes['recipes'][0]['photos'])+1)
        for old,new in zip(self.old_recipes['recipes'],now['recipes']):
            self.assertEqual({x:v for x,v in old.items() if x!='photos'},{x:v for x,v in new.items() if x!='photos'})
        self.assertEqual(k.build()['images_generated'],[])
        self.assertEqual(self.old_published,k.local(k.PUBLISHED).read_bytes())

    def test_unknown_dish_stays_draft(self):
        self.picture('未提供做法的新菜')
        k.sync();k.build()
        self.assertEqual(self.old_recipes,k.read(k.local('data/recipes.json')))
        self.assertEqual(k.read(k.local('data/drafts.json'))['drafts'][0]['status'],'needs-recipe-text')
        self.assertEqual(self.old_published,k.local(k.PUBLISHED).read_bytes())

    def test_missing_original_preserves_public_material_and_baseline(self):
        p=k.local('图片/原图/快食意大利面/快食意面.jpg')
        p.unlink() # Isolated fixture only.
        hashes={x:k.sha(k.local(x)) for x in k.public_files()}
        self.assertEqual(len(k.scan()['changes']['missing']),1)
        self.assertEqual(k.build()['images_generated'],[])
        self.assertEqual(hashes,{x:k.sha(k.local(x)) for x in k.public_files()})
        self.assertEqual(len(k.scan()['changes']['missing']),1)
        self.assertEqual(self.old_published,k.local(k.PUBLISHED).read_bytes())

    def test_rename_preserves_stable_photo_and_recipe(self):
        p=k.local('图片/原图/空气炸锅牛扒/空气炸锅的口蘑.jpg');p.rename(p.with_name('口蘑改名.jpg'))
        self.assertEqual(len(k.scan()['changes']['renamed']),1)
        k.sync();self.assertEqual(k.build()['images_generated'],[])
        self.assertEqual(self.old_recipes,k.read(k.local('data/recipes.json')))
        im=next(i for i in k.read(k.local('data/images.json'))['images'] if i['id']=='r001-detail')
        self.assertTrue(im['source'].endswith('口蘑改名.jpg'))
        self.assertTrue(k.scan()['no_op'])

    def test_archive_retains_original_content(self):
        with zipfile.ZipFile(REAL_ROOT/'.local/backups/before-redesign-20261111/original.zip') as z:
            old_html=z.read('index.html').decode('utf8')
            old_steps=re.findall(r'<li class="step">.*?<p>(.*?)</p>',old_html,re.S)
            clean=lambda x:re.sub(r'\s+','',re.sub('<[^>]+>','',x))
            self.assertEqual([clean(x) for x in old_steps],[clean(x) for r in self.old_recipes['recipes'] if r['id'] in ('recipe-001','recipe-002') for x in r['steps']])
            for im in k.read(k.local('data/images.json'))['images']:
                if im['kind']=='real' and Path(im['source']).name in z.namelist(): self.assertEqual(z.read(Path(im['source']).name),k.local(im['source']).read_bytes())

    def test_recipe_illustrations_are_honest_and_stable(self):
        registry=k.read(k.local('data/images.json'))
        data=k.read(k.local('data/recipes.json'))
        for rid in ('recipe-003','recipe-004'):
            recipe=next(r for r in data['recipes'] if r['id']==rid)
            image=next(i for i in registry['images'] if i['id']==recipe['cover'])
            self.assertEqual(image['basis'],'recipe')
            self.assertFalse(image.get('references'))
            self.assertNotIn('time',recipe)
        k.sync();k.sync();k.build();k.build()
        self.assertEqual(data,k.read(k.local('data/recipes.json')))
        self.assertEqual(registry,k.read(k.local('data/images.json')))
        wrong=copy.deepcopy(registry)
        next(i for i in wrong['images'] if i['id']=='r003-cover')['references']=['r001-main']
        with self.assertRaises(ValueError):k.validate_data(data,wrong)

    def test_protected_repositories_are_rejected(self):
        for repository in ('lhdfwoaini/lildphotos','lhdfwoaini/street-corner-darkroom','lhdfwoaini/thesis-doctor'):
            c=k.read(k.local('kitchen.config.json'));c['repository']=repository;k.save(k.local('kitchen.config.json'),c)
            with self.assertRaises(ValueError):k.config()

    def test_archived_recipes_stay_out_after_repeated_sync(self):
        archived=[r for r in self.old_recipes['recipes'] if r['status']=='archived']
        for r in archived:self.picture(r['sourceFolder'],name='归档补图.png')
        k.sync();k.build();k.sync();k.build()
        current=k.read(k.local('data/recipes.json'))
        public=json.loads(k.local('assets/recipes.js').read_text('utf8').split('window.KITCHEN_DATA = ',1)[1].rstrip(';\n'))
        for r in archived:
            self.assertEqual(next(x for x in current['recipes'] if x['id']==r['id'])['status'],'archived')
            self.assertNotIn(r['id'],[x['id'] for x in public['recipes']])
            self.assertNotIn(r['cover'],public['images'])
            for iid in r['photos']:self.assertNotIn(iid,public['images'])
        self.assertEqual(self.old_published,k.local(k.PUBLISHED).read_bytes())

    def test_corrupt_input_cannot_be_published(self):
        p=k.local('图片/原图/空气炸锅牛扒/坏图.jpg');p.write_bytes(b'broken')
        self.assertTrue(k.scan()['errors'])
        with self.assertRaises(ValueError):k.build()
        self.assertEqual(self.old_published,k.local(k.PUBLISHED).read_bytes())

    def test_publish_target_cannot_be_photography(self):
        c=k.config();c['repository']='lhdfwoaini/lildphotos';k.save(k.local('kitchen.config.json'),c)
        with self.assertRaises(ValueError):k.config()


if __name__=='__main__':
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(KitchenTests)
    result=unittest.TextTestRunner(verbosity=2).run(suite)
    k.save(REAL_ROOT/'.local/reports/incremental-tests.json',{'passed':result.wasSuccessful(),'tests':result.testsRun,'errors':len(result.errors),'failures':len(result.failures),'scope':'isolated fixtures; production recipes unchanged'})
    raise SystemExit(0 if result.wasSuccessful() else 1)
