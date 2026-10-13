#!/usr/bin/env python3
"""Stage only public assets for GitHub Pages; never publish the whole checkout."""
import argparse
import base64
import json
import os
from pathlib import Path
import re
import shutil
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_FILES = ["app.js", "accounts.js", "accounts.css", "viewer-embed.js", "viewer-embed.css",
                "viewer/index.html", "viewer/state.js", "viewer/pricing.js", "viewer/three.min.js", "viewer/OrbitControls.js",
                "viewer/THREE-LICENSE", "viewer/README.md", "vendor/supabase.js",
                "vendor/THIRD-PARTY-NOTICES.txt", "vendor/README.md"]


def public_config():
    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_PUBLISHABLE_KEY", "").strip()
    if not url and not key:
        source = ROOT / "account-config.js"
        if source.is_file():
            match = re.search(r"window\.DOGEHOUSE_ACCOUNT_CONFIG\s*=\s*(\{[\s\S]*\})\s*;", source.read_text())
            if match:
                saved = json.loads(match.group(1))
                url = saved.get("supabaseUrl", "").strip()
                key = saved.get("supabasePublishableKey", "").strip()
        if not url and not key:
            return None
    parts = urlsplit(url)
    if not (parts.scheme == "https" and parts.hostname and not parts.username
            and not parts.password and parts.path in ("", "/")
            and not parts.query and not parts.fragment):
        raise ValueError("SUPABASE_URL must be the HTTPS project origin.")
    valid = bool(re.fullmatch(r"sb_publishable_[A-Za-z0-9_-]+", key))
    if not valid:
        try:
            payload = key.split(".")[1]
            claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
            valid = len(key.split(".")) == 3 and claims.get("role") == "anon"
        except (ValueError, IndexError, UnicodeError):
            pass
    if not valid:
        raise ValueError("SUPABASE_PUBLISHABLE_KEY must be a publishable or legacy anon key; secret/service-role keys are forbidden.")
    return {"supabaseUrl": url.rstrip("/"), "supabasePublishableKey": key}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--allow-unconfigured", action="store_true",
                        help="For local checks only: leave accounts disabled when no public configuration is supplied.")
    args = parser.parse_args()
    config = public_config()
    if config is None:
        if not args.allow_unconfigured:
            parser.error("Configure account-config.js or the SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY repository variables before deployment.")
        config = {"supabaseUrl": "", "supabasePublishableKey": ""}
    destination = ROOT / "_site"
    if destination.is_symlink():
        raise ValueError("Refusing to replace a symlink at _site.")
    if destination.exists():
        shutil.rmtree(destination)
    destination.mkdir()
    for relative in PUBLIC_FILES:
        source = ROOT / relative
        if source.is_symlink() or not source.is_file():
            raise ValueError(f"Expected a regular public asset: {relative}")
        output = destination / relative
        output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, output)
    # Preserve the named launch URL and provide the Pages root entry point.
    for name in ["index.html", "dogehouse-launch.html"]:
        shutil.copyfile(ROOT / "dogehouse-launch.html", destination / name)
    (destination / "account-config.js").write_text(
        "window.DOGEHOUSE_ACCOUNT_CONFIG = " + json.dumps(config) + ";\n", encoding="utf-8")
    (destination / ".nojekyll").touch()
    print("Staged public site in _site (accounts configured)." if config["supabaseUrl"] else "Staged local test site in _site (accounts disabled).")


if __name__ == "__main__":
    main()
