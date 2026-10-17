#!/usr/bin/env python3
"""Build an isolated staging frontend. Never fall back to account-config.js."""
import os
from pathlib import Path
import runpy
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
PRODUCTION_PROJECT = 'lftpzfnzokjqgeteitul'


def staging_config(env):
    names = ['STAGING_SUPABASE_URL', 'STAGING_SUPABASE_PUBLISHABLE_KEY', 'STAGING_SITE_URL']
    if any(not env.get(name, '').strip() for name in names):
        raise ValueError('All three STAGING_* public build variables are required')
    url, key, site = (env[name].strip() for name in names)
    project = urlsplit(url)
    if (project.scheme != 'https' or not project.hostname
            or not project.hostname.endswith('.supabase.co')
            or len(project.hostname.split('.')) != 3
            or project.username or project.password or project.port
            or project.path not in ('', '/') or project.query or project.fragment):
        raise ValueError('Use the separate hosted Supabase project HTTPS origin')
    if project.hostname.split('.')[0] == PRODUCTION_PROJECT:
        raise ValueError('Staging cannot use the known production Supabase project')
    target = urlsplit(site)
    if (target.scheme != 'https' or not target.hostname or target.username or target.password
            or target.port or target.path not in ('', '/') or target.query or target.fragment
            or target.hostname in ('dogehouse.netlify.app', 'bcreedh2002.github.io')):
        raise ValueError('STAGING_SITE_URL must be a separate HTTPS site origin')
    return url, key, site.rstrip('/')


def main():
    url, key, site = staging_config(os.environ)
    # Override generic variables explicitly; the production config file cannot win.
    os.environ['SUPABASE_URL'] = url
    os.environ['SUPABASE_PUBLISHABLE_KEY'] = key
    module = runpy.run_path(str(ROOT / 'scripts/prepare-pages.py'))
    module['main']()
    for name in ['index.html', 'dogehouse-launch.html']:
        page = ROOT / '_site' / name
        html = page.read_text()
        marker = '<meta name="robots" content="noindex,nofollow">'
        banner = '<div role="note" style="background:#ffe36b;color:#111;padding:12px;text-align:center;font:700 16px sans-serif">DOGEHOUSE TEST SITE — Synthetic orders and Stripe test cards only.</div>'
        import re
        html = re.sub(r'(<head\b[^>]*>)', lambda m: m[0] + marker, html, count=1, flags=re.I)
        html = re.sub(r'(<body\b[^>]*>)', lambda m: m[0] + banner, html, count=1, flags=re.I)
        page.write_text(html)
    (ROOT / '_site/_headers').write_text('/*\n  X-Robots-Tag: noindex, nofollow\n  X-Content-Type-Options: nosniff\n')
    print('Isolated staging artifact ready. Backend Stripe mode must be verified separately.')


if __name__ == '__main__':
    main()
