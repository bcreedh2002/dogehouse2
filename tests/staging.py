"""Exercise real staging builds; only synthetic keys and project URLs are used."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as folder:
    root = Path(folder)
    for name in ['scripts', 'viewer', 'vendor']:
        shutil.copytree(ROOT / name, root / name)
    for source in ROOT.glob('*'):
        if source.is_file():
            shutil.copyfile(source, root / source.name)
    env = {k: v for k, v in os.environ.items() if not k.startswith('STAGING_')}
    good = dict(STAGING_SUPABASE_URL='https://stagingtestproject.supabase.co',
                STAGING_SUPABASE_PUBLISHABLE_KEY='sb_publishable_synthetic',
                STAGING_SITE_URL='https://synthetic-staging.netlify.app')
    def run(settings):
        return subprocess.run(['python3', str(root / 'scripts/prepare-staging.py')],
                              env={**env, **settings}, capture_output=True, text=True)
    assert run({}).returncode != 0, 'Must not reuse committed production configuration'
    for change in [dict(STAGING_SUPABASE_URL='https://lftpzfnzokjqgeteitul.supabase.co'),
                   dict(STAGING_SITE_URL='https://dogehouse.netlify.app'),
                   dict(STAGING_SITE_URL='https://bcreedh2002.github.io'),
                   dict(STAGING_SUPABASE_PUBLISHABLE_KEY='sb_secret_reject'),
                   dict(STAGING_SITE_URL='https://user:pass@synthetic-staging.netlify.app'),
                   dict(STAGING_SITE_URL='https://synthetic-staging.netlify.app/path')]:
        assert run({**good, **change}).returncode != 0
    result = run({**good, 'SUPABASE_URL': 'https://lftpzfnzokjqgeteitul.supabase.co',
                  'SUPABASE_PUBLISHABLE_KEY': 'sb_publishable_production_synthetic'})
    assert result.returncode == 0, result.stderr
    config = (root / '_site/account-config.js').read_text()
    assert good['STAGING_SUPABASE_URL'] in config
    assert 'lftpzfnzokjqgeteitul' not in config
    for name in ['index.html', 'dogehouse-launch.html']:
        html = (root / '_site' / name).read_text()
        assert 'DOGEHOUSE TEST SITE' in html and 'noindex,nofollow' in html
    assert 'nosniff' in (root / '_site/_headers').read_text()
    assert not (root / '_site/supabase').exists()
print('PASS: staging refuses production/missing configuration and secrets; real artifact uses isolated public config, test banner and noindex headers')
