#!/usr/bin/env python3
"""Dispatch explicit Netlify environments; never infer staging from a UI build override."""
import os
from pathlib import Path
import runpy
ROOT = Path(__file__).resolve().parents[1]

def main():
    context = os.environ.get('CONTEXT', '')
    mode = os.environ.get('DOGEHOUSE_ENV', '')
    if context in ('deploy-preview', 'branch-deploy') or mode == 'staging':
        runpy.run_path(str(ROOT / 'scripts/prepare-staging.py'), run_name='__main__')
        return
    if mode != 'production' or context != 'production':
        raise ValueError('Set DOGEHOUSE_ENV explicitly to staging or production on the intended Netlify site')
    if os.environ.get('URL', '').rstrip('/') != 'https://dogehouse.netlify.app':
        raise ValueError('Production build is restricted to the canonical Netlify site')
    module = runpy.run_path(str(ROOT / 'scripts/prepare-pages.py'))
    config = module['public_config']()
    if not config or config['supabaseUrl'] != 'https://lftpzfnzokjqgeteitul.supabase.co':
        raise ValueError('Production build must use the verified production Supabase reference')
    module['main']()

if __name__ == '__main__':
    main()
