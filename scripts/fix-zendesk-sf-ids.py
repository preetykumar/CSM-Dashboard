#!/usr/bin/env python3
"""
Batch-update Zendesk organization salesforce_id fields to 18-char Salesforce Account IDs.
Reads corrections from zendesk_sf_id_corrections.csv and applies UPGRADE_TO_18 updates.

Usage:
    python3 scripts/fix-zendesk-sf-ids.py --dry-run     # Preview changes
    python3 scripts/fix-zendesk-sf-ids.py --apply        # Apply changes
"""

import csv
import json
import sys
import time
import urllib.request
import base64

def read_env():
    env = {}
    with open('backend/.env') as f:
        for line in f:
            line = line.strip()
            if '=' in line and not line.startswith('#'):
                k, v = line.split('=', 1)
                env[k] = v.strip('"').strip("'")
    return env

def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ('--dry-run', '--apply'):
        print("Usage: python3 scripts/fix-zendesk-sf-ids.py [--dry-run | --apply]")
        sys.exit(1)

    dry_run = sys.argv[1] == '--dry-run'
    env = read_env()
    email = env['ZENDESK_EMAIL']
    token = env['ZENDESK_API_TOKEN']
    subdomain = env['ZENDESK_SUBDOMAIN']
    creds = base64.b64encode(f'{email}/token:{token}'.encode()).decode()

    csv_path = '/Users/preetykumar/zendesk_sf_id_corrections.csv'
    updates = []

    with open(csv_path) as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row['Action'] == 'UPGRADE_TO_18' and row['Correct SF ID (18-char)']:
                updates.append({
                    'zd_id': row['ZD Org ID'],
                    'zd_name': row['ZD Org Name'],
                    'current': row['Current SF ID'],
                    'correct': row['Correct SF ID (18-char)'],
                    'sf_name': row['SF Account Name'],
                })

    print(f"{'DRY RUN - ' if dry_run else ''}Processing {len(updates)} updates")
    print(f"{'':3s} {'ZD Org':40s} {'Current ID':20s} {'Correct ID':20s} {'SF Account'}")
    print('-' * 110)

    success = 0
    errors = 0

    for i, u in enumerate(updates):
        print(f"{i+1:3d} {u['zd_name']:40s} {u['current']:20s} {u['correct']:20s} {u['sf_name']}")

        if not dry_run:
            try:
                data = json.dumps({
                    "organization": {
                        "organization_fields": {
                            "salesforce_id": u['correct']
                        }
                    }
                }).encode()

                req = urllib.request.Request(
                    f"https://{subdomain}.zendesk.com/api/v2/organizations/{u['zd_id']}.json",
                    data=data,
                    headers={
                        'Authorization': f'Basic {creds}',
                        'Content-Type': 'application/json',
                    },
                    method='PUT'
                )
                with urllib.request.urlopen(req, timeout=10) as resp:
                    resp.read()
                success += 1

                # Rate limit: Zendesk allows ~200 req/min
                if (i + 1) % 50 == 0:
                    print(f"  ... pausing 5s for rate limit ({i+1}/{len(updates)}) ...")
                    time.sleep(5)

            except Exception as e:
                print(f"  ERROR: {e}")
                errors += 1

    print(f"\n{'DRY RUN - ' if dry_run else ''}Done: {success} updated, {errors} errors" if not dry_run else f"\nDRY RUN: {len(updates)} would be updated")

if __name__ == '__main__':
    main()
