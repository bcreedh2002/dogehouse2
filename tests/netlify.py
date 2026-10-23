"""Exercise the checked-in build dispatcher rather than trusting UI overrides."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
ROOT = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as folder:
    root = Path(folder)
    for name in ['scripts','viewer','vendor']:
        shutil.copytree(ROOT / name, root / name)
    for source in ROOT.glob('*'):
        if source.is_file():
            shutil.copyfile(source, root / source.name)
    base = {k:v for k,v in os.environ.items() if not k.startswith(('SUPABASE_', 'STAGING_', 'DOGEHOUSE_')) and k not in ('CONTEXT','URL')}
    good = dict(STAGING_SUPABASE_URL='https://synthetic.supabase.co',STAGING_SUPABASE_PUBLISHABLE_KEY='sb_publishable_synthetic',STAGING_SITE_URL='https://synthetic.netlify.app')
    def run(settings):
        return subprocess.run(['python3',str(root/'scripts/prepare-netlify.py')],env={**base,**settings},capture_output=True,text=True)
    assert run({'CONTEXT':'production'}).returncode != 0
    assert run({'DOGEHOUSE_ENV':'production','CONTEXT':'production','URL':'https://synthetic.netlify.app'}).returncode != 0
    assert run({**good,'DOGEHOUSE_ENV':'staging','CONTEXT':'production','URL':'https://synthetic.netlify.app'}).returncode == 0
    assert 'synthetic.supabase.co' in (root/'_site/account-config.js').read_text()
    assert run({**good,'DOGEHOUSE_ENV':'production','CONTEXT':'deploy-preview','URL':'https://dogehouse.netlify.app'}).returncode == 0
    assert 'synthetic.supabase.co' in (root/'_site/account-config.js').read_text()
    prod=dict(DOGEHOUSE_ENV='production',CONTEXT='production',URL='https://dogehouse.netlify.app',SUPABASE_URL='https://lftpzfnzokjqgeteitul.supabase.co',SUPABASE_PUBLISHABLE_KEY='sb_publishable_synthetic')
    assert run({**prod,'SUPABASE_URL':'https://synthetic.supabase.co'}).returncode != 0
    assert run(prod).returncode == 0
print('PASS: explicit build mode, canonical production site/project enforcement and staging isolation even in a separate test site production context')
