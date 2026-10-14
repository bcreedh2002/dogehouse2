"""Exercise the actual staging command in a temporary checkout, including bad config."""
import base64
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix="dogehouse-pages-") as directory:
    checkout = Path(directory)
    for name in ["scripts", "vendor", "viewer"]:
        shutil.copytree(ROOT / name, checkout / name)
    for name in ["owner-dashboard.js", "owner-dashboard.css", "dogehouse-launch.html", "app.js", "accounts.css", "accounts.js", "viewer-embed.js", "viewer-embed.css"]:
        shutil.copyfile(ROOT / name, checkout / name)
    # Representative private assets must never end up in the artifact.
    (checkout / ".data").mkdir()
    (checkout / ".data" / "private.sqlite").write_text("private placeholder")
    (checkout / "server.cjs").write_text("private server placeholder")
    (checkout / ".git").mkdir()
    (checkout / ".git" / "config").write_text("private git metadata placeholder")
    env = {**os.environ, "SUPABASE_URL": "", "SUPABASE_PUBLISHABLE_KEY": ""}
    def run(**settings):
        return subprocess.run(["python3", str(checkout / "scripts/prepare-pages.py")],
                              env={**env, **settings}, capture_output=True, text=True)
    assert run().returncode != 0
    valid_url = "https://mock.supabase.co"
    assert run(SUPABASE_URL=valid_url, SUPABASE_PUBLISHABLE_KEY="sb_secret_forbidden").returncode != 0
    def jwt(role):
        payload = base64.urlsafe_b64encode(json.dumps({"role": role}).encode()).decode().rstrip("=")
        return "header." + payload + ".signature"
    assert run(SUPABASE_URL=valid_url, SUPABASE_PUBLISHABLE_KEY=jwt("service_role")).returncode != 0
    assert run(SUPABASE_URL="https://user:password@mock.supabase.co", SUPABASE_PUBLISHABLE_KEY="sb_publishable_mock").returncode != 0
    assert run(SUPABASE_URL=valid_url, SUPABASE_PUBLISHABLE_KEY="sb_publishable_mock").returncode == 0
    staged = checkout / "_site"
    expected = {"owner-dashboard.js", "owner-dashboard.css", "app.js", "viewer/state.js", "viewer-embed.js", "viewer-embed.css", "viewer/index.html", "viewer/pricing.js", "viewer/three.min.js", "viewer/OrbitControls.js", "viewer/THREE-LICENSE", "viewer/README.md", "index.html", "dogehouse-launch.html", "accounts.js", "accounts.css", "account-config.js", ".nojekyll", "vendor/supabase.js", "vendor/THIRD-PARTY-NOTICES.txt", "vendor/README.md"}
    assert {str(p.relative_to(staged)) for p in staged.rglob("*") if p.is_file()} == expected
    assert (staged / "index.html").read_bytes() == (ROOT / "dogehouse-launch.html").read_bytes()
    generated = (staged / "account-config.js").read_text()
    assert '"supabaseUrl": "https://mock.supabase.co"' in generated
    assert run(SUPABASE_URL=valid_url, SUPABASE_PUBLISHABLE_KEY=jwt("anon")).returncode == 0
    (checkout / "account-config.js").write_text("window.DOGEHOUSE_ACCOUNT_CONFIG = " + json.dumps({"supabaseUrl":valid_url,"supabasePublishableKey":"sb_publishable_committed"}) + ";\n")
    assert run().returncode == 0
    assert 'sb_publishable_committed' in (staged / "account-config.js").read_text()
print("PASS: Pages staging, root entry point, public config injection, secret/service-role rejection, private-file exclusion, and repeatability.")
