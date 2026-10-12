#!/usr/bin/env python3
"""Read-only project checks. Does not create accounts, send email, or change data."""
import importlib.util
import json
from pathlib import Path
import sys
import urllib.error
import urllib.request

spec = importlib.util.spec_from_file_location("pages_setup", Path(__file__).with_name("prepare-pages.py"))
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


def get(config, endpoint):
    request = urllib.request.Request(config["supabaseUrl"] + endpoint,
                                     headers={"apikey": config["supabasePublishableKey"]})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        try:
            payload = json.loads(error.read())
        except (ValueError, UnicodeError):
            payload = {}
        return error.code, payload
    except urllib.error.URLError:
        raise RuntimeError("Cannot reach the Supabase project. Check the cloud network allowlist, project availability, and TLS trust configuration.") from None


def main():
    config = setup.public_config()
    if not config:
        raise RuntimeError("Set the public Supabase settings in account-config.js first.")
    code, settings = get(config, "/auth/v1/settings")
    if code != 200:
        raise RuntimeError(f"Supabase auth settings returned HTTP {code}; check the project URL, public key, and network policy.")
    if not settings.get("external", {}).get("email") or settings.get("disable_signup"):
        raise RuntimeError("Enable Email authentication and account signup in Supabase.")
    if settings.get("mailer_autoconfirm"):
        raise RuntimeError("Enable email confirmation in Supabase before launching public accounts.")
    code, payload = get(config, "/rest/v1/dogehouse_builds?select=id&limit=1")
    if code == 404 and payload.get("code") == "PGRST205":
        raise RuntimeError("Saved-build table is missing. Run supabase/schema.sql in the Supabase SQL editor.")
    if code not in (401, 403) or payload.get("code") != "42501":
        raise RuntimeError(f"Anonymous build access returned HTTP {code}; expected the table privilege denial configured by supabase/schema.sql. Verify the schema and policies.")
    print("PASS: project reachable, Email authentication/signup enabled, confirmation required, anonymous table access denied.")
    print("Still required: live account confirmation, password recovery, and two-account isolation checks; this read-only check cannot validate them.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
