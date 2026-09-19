"""Bulk company register: SEC listed companies, SEC Form D filers (the free
startup pool), and their named officers.

The Form D fixture mirrors the real quarterly data set exactly - same table
names, same columns, same value shapes ('06b' date codes, shouty names,
'Pooled Investment Fund' groups) as the 2025Q2 file inspected on the box.
"""
import asyncio
import io
import os
import sys
import tempfile
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault('JWT_SECRET', 'company-register-secret-xxxxxxxxxxxxxx')

ISSUER_COLS = ['ACCESSIONNUMBER', 'IS_PRIMARYISSUER_FLAG', 'ISSUER_SEQ_KEY', 'CIK', 'ENTITYNAME',
               'STREET1', 'STREET2', 'CITY', 'STATEORCOUNTRY', 'STATEORCOUNTRYDESCRIPTION',
               'ZIPCODE', 'ISSUERPHONENUMBER', 'JURISDICTIONOFINC', 'ENTITYTYPE',
               'YEAROFINC_TIMESPAN_CHOICE', 'YEAROFINC_VALUE_ENTERED']
OFFERING_COLS = ['ACCESSIONNUMBER', 'INDUSTRYGROUPTYPE', 'REVENUERANGE', 'SALE_DATE',
                 'TOTALOFFERINGAMOUNT', 'TOTALAMOUNTSOLD']
PERSON_COLS = ['ACCESSIONNUMBER', 'RELATEDPERSON_SEQ_KEY', 'FIRSTNAME', 'MIDDLENAME', 'LASTNAME',
               'RELATIONSHIP_1', 'RELATIONSHIP_2', 'RELATIONSHIP_3', 'RELATIONSHIPCLARIFICATION']


def _tsv(columns, rows):
    lines = ['\t'.join(columns)]
    for row in rows:
        lines.append('\t'.join(str(row.get(col, '')) for col in columns))
    return '\n'.join(lines) + '\n'


def _fixture_zip(recent: str, stale: str) -> bytes:
    issuers = [
        {'ACCESSIONNUMBER': 'A1', 'IS_PRIMARYISSUER_FLAG': 'YES', 'CIK': '0001111111',
         'ENTITYNAME': 'NOVA ROBOTICS INC', 'CITY': 'BOSTON', 'STATEORCOUNTRYDESCRIPTION': 'MASSACHUSETTS',
         'ENTITYTYPE': 'Corporation', 'YEAROFINC_VALUE_ENTERED': '2021'},
        {'ACCESSIONNUMBER': 'A2', 'IS_PRIMARYISSUER_FLAG': 'YES', 'CIK': '0002222222',
         'ENTITYNAME': 'TINY SEED LLC', 'CITY': 'AUSTIN', 'STATEORCOUNTRYDESCRIPTION': 'TEXAS'},
        {'ACCESSIONNUMBER': 'A3', 'IS_PRIMARYISSUER_FLAG': 'YES', 'CIK': '0003333333',
         'ENTITYNAME': 'HARBOR CAPITAL FUND II LP', 'CITY': 'NEW YORK', 'STATEORCOUNTRYDESCRIPTION': 'NEW YORK'},
        {'ACCESSIONNUMBER': 'A5', 'IS_PRIMARYISSUER_FLAG': 'YES', 'CIK': '0006666666',
         'ENTITYNAME': 'BIG TOWER REIT INC', 'CITY': 'DALLAS', 'STATEORCOUNTRYDESCRIPTION': 'TEXAS'},
        {'ACCESSIONNUMBER': 'A4', 'IS_PRIMARYISSUER_FLAG': 'YES', 'CIK': '0004444444',
         'ENTITYNAME': 'OLD MONEY HEALTH INC', 'CITY': 'CHICAGO', 'STATEORCOUNTRYDESCRIPTION': 'ILLINOIS'},
        # A co-issuer row on an accepted filing must not become its own company.
        {'ACCESSIONNUMBER': 'A1', 'IS_PRIMARYISSUER_FLAG': 'NO', 'CIK': '0005555555',
         'ENTITYNAME': 'NOVA ROBOTICS SPV', 'CITY': 'BOSTON'},
    ]
    offerings = [
        {'ACCESSIONNUMBER': 'A1', 'INDUSTRYGROUPTYPE': 'Technology', 'REVENUERANGE': '$1,000,000 - $4,999,999',
         'SALE_DATE': recent, 'TOTALOFFERINGAMOUNT': '9000000', 'TOTALAMOUNTSOLD': '9000000'},
        {'ACCESSIONNUMBER': 'A2', 'INDUSTRYGROUPTYPE': 'Technology', 'SALE_DATE': recent,
         'TOTALOFFERINGAMOUNT': '150000', 'TOTALAMOUNTSOLD': '150000'},          # below the size bar
        {'ACCESSIONNUMBER': 'A3', 'INDUSTRYGROUPTYPE': 'Pooled Investment Fund', 'SALE_DATE': recent,
         'TOTALOFFERINGAMOUNT': '50000000', 'TOTALAMOUNTSOLD': '50000000'},      # a fund, not an operating company
        # The live file writes 'and', not '&'; an ampersand skip-list let REITs through.
        {'ACCESSIONNUMBER': 'A5', 'INDUSTRYGROUPTYPE': 'REITS and Finance', 'SALE_DATE': recent,
         'TOTALOFFERINGAMOUNT': '40000000', 'TOTALAMOUNTSOLD': '40000000'},
        {'ACCESSIONNUMBER': 'A4', 'INDUSTRYGROUPTYPE': 'Health Care', 'SALE_DATE': stale,
         'TOTALOFFERINGAMOUNT': '8000000', 'TOTALAMOUNTSOLD': '8000000'},        # too old
    ]
    persons = [
        {'ACCESSIONNUMBER': 'A1', 'FIRSTNAME': 'Ada', 'LASTNAME': 'Lovelace',
         'RELATIONSHIP_1': 'Executive Officer', 'RELATIONSHIP_2': 'Director', 'RELATIONSHIPCLARIFICATION': 'CEO'},
        {'ACCESSIONNUMBER': 'A1', 'FIRSTNAME': 'Grace', 'MIDDLENAME': 'B', 'LASTNAME': 'Hopper',
         'RELATIONSHIP_1': 'Director'},
        {'ACCESSIONNUMBER': 'A1', 'FIRSTNAME': 'Promoter', 'LASTNAME': 'Only', 'RELATIONSHIP_1': 'Promoter'},
        {'ACCESSIONNUMBER': 'A1', 'FIRSTNAME': 'Mononym', 'RELATIONSHIP_1': 'Executive Officer'},
        {'ACCESSIONNUMBER': 'A3', 'FIRSTNAME': 'Fund', 'LASTNAME': 'Manager', 'RELATIONSHIP_1': 'Executive Officer'},
    ]
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as zf:
        zf.writestr('2026Q1_d/ISSUERS.tsv', _tsv(ISSUER_COLS, issuers))
        zf.writestr('2026Q1_d/OFFERING.tsv', _tsv(OFFERING_COLS, offerings))
        zf.writestr('2026Q1_d/RELATEDPERSONS.tsv', _tsv(PERSON_COLS, persons))
    return buffer.getvalue()


def tests() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        os.environ['DATABASE_URL'] = f'sqlite:///{Path(tmp) / "t.db"}'
        for mod in [m for m in list(sys.modules) if m.startswith('app.')]:
            del sys.modules[mod]

        from app.database import get_db, init_db
        from app.services import company_register as cr

        asyncio.run(init_db())

        now = datetime.now(timezone.utc)
        recent = (now - timedelta(days=45)).strftime('%d-%b-%Y').upper()
        stale = (now - timedelta(days=365 * 6)).strftime('%d-%b-%Y').upper()
        payload = _fixture_zip(recent, stale)

        companies, people = cr.parse_form_d_zip(payload)
        by_name = {c['company_name']: c for c in companies}
        assert set(by_name) == {'Nova Robotics Inc'}, by_name  # size, industry, recency, primary-issuer filters
        nova = by_name['Nova Robotics Inc']
        assert nova['tier'] == 'us_private' and nova['country'] == 'US'
        assert nova['last_event_amount'] == 9000000.0 and nova['last_event_kind'] == 'reg_d_offering'
        assert nova['last_event_at'] == (now - timedelta(days=45)).strftime('%Y-%m-%d')
        assert nova['sector_label'] == 'Technology' and nova['region'] == 'Massachusetts'
        assert nova['metadata']['revenue_range'] == '$1,000,000 - $4,999,999'

        officers = people[('sec_form_d', '0001111111')]
        names = sorted(p['full_name'] for p in officers)
        assert names == ['Ada Lovelace', 'Grace B Hopper']  # promoter dropped, single-token name dropped
        assert officers[0]['relationship'] == 'Executive Officer'
        assert officers[0]['source_url'].startswith('https://www.sec.gov/Archives/edgar/data/1111111/')
        assert ('sec_form_d', '0003333333') not in people  # fund never entered the register

        # --- ingest through the real code path with the network mocked ---
        async def fake_get(url, timeout=120.0):
            if 'company_tickers' in url:
                return b'{"0":{"cik_str":320193,"ticker":"AAPL","title":"Apple Inc."},' \
                       b'"1":{"cik_str":789019,"ticker":"MSFT","title":"MICROSOFT CORP"}}'
            return payload

        with patch.object(cr, '_http_get', fake_get):
            public = asyncio.run(cr.ingest_sec_public())
            first = asyncio.run(cr.ingest_form_d('2026q1'))
            # Re-running a quarter is a no-op, not a duplicate.
            again = asyncio.run(cr.ingest_form_d('2026q1'))
        assert public['written'] == 2 and first['written'] == 1 and first['officers'] == 2
        assert again.get('skipped')

        page = asyncio.run(cr.search_register(limit=50))
        assert page['total'] == 3
        names = {item['company_name'] for item in page['items']}
        assert names == {'Apple Inc.', 'Microsoft Corp', 'Nova Robotics Inc'}  # shouty name title-cased
        assert page['items'][0]['company_name'] == 'Nova Robotics Inc'  # newest raise ranks first
        assert page['items'][0]['officer_count'] == 2

        startups = asyncio.run(cr.search_register(tier='us_private'))
        assert [i['company_name'] for i in startups['items']] == ['Nova Robotics Inc']
        assert asyncio.run(cr.search_register(tier='us_public'))['total'] == 2
        assert asyncio.run(cr.search_register(with_officers=True))['total'] == 1
        assert asyncio.run(cr.search_register(min_amount=20_000_000))['total'] == 0
        assert asyncio.run(cr.search_register(q='robot'))['total'] == 1
        assert asyncio.run(cr.search_register(sector='technology'))['total'] == 1

        # US rows carry no invented headcount; the raise is the honest signal.
        assert all(item['employees'] is None for item in page['items'])

        # --- sector backfill fills listed companies without one ---
        async def fake_submissions(url, timeout=30.0):
            return (b'{"sic":"3571","sicDescription":"Electronic Computers",'
                    b'"stateOfIncorporationDescription":"CALIFORNIA","website":""}')

        with patch.object(cr, '_http_get', fake_submissions):
            filled = asyncio.run(cr.backfill_sec_sectors(limit=5))
        assert filled['filled'] == 2 and filled['remaining'] == 0
        tech = asyncio.run(cr.search_register(sector='Electronic Computers'))
        assert tech['total'] == 2 and tech['items'][0]['sector_code'] == '3571'

        summary = asyncio.run(cr.register_summary())
        tiers = {row['tier']: row['n'] for row in summary['tiers']}
        assert tiers == {'us_public': 2, 'us_private': 1}
        assert any(row['source'] == 'sec_form_d' for row in summary['recent_ingests'])

        # --- the quarter in progress is never requested: SEC publishes a
        # data set only after the quarter closes, so listing it would 404
        # every pass and block the published quarters behind it ---
        current = f"{now.year}q{(now.month - 1) // 3 + 1}"
        quarters = cr.recent_form_d_quarters()
        assert current not in quarters and len(quarters) >= 4
        assert quarters == sorted(quarters, reverse=True)

        # --- a failed download records the failure and retries next pass ---
        async def boom(url, timeout=120.0):
            raise RuntimeError('SEC unavailable')

        with patch.object(cr, '_http_get', boom):
            failed = asyncio.run(cr.ingest_form_d('2026q2'))
        assert failed['ok'] is False
        assert not asyncio.run(cr._already_ingested('sec_form_d', '2026q2'))

        # An unpublished quarter is flagged as such and does not stop the
        # drain from reaching an older quarter in the same pass.
        async def not_found(url, timeout=120.0):
            if 'company_tickers' in url:
                return b'{}'
            if '2099q4' in url:
                raise RuntimeError("Client error '404 Not Found' for url")
            return payload

        with patch.object(cr, '_http_get', not_found):
            unpublished = asyncio.run(cr.ingest_form_d('2099q4'))
            assert unpublished['unpublished'] is True
            with patch.object(cr, 'recent_form_d_quarters', lambda count=None: ['2099q4', '2026q3']):
                drained = asyncio.run(cr.drain_company_register())
        assert drained['form_d']['quarter'] == '2026q3' and drained['form_d']['ok'] is True

        async def check_people() -> None:
            db = await get_db()
            try:
                rows = await (await db.execute(
                    """SELECT p.full_name, p.relationship FROM company_register_people p
                       JOIN company_register c ON c.id = p.register_id
                       WHERE c.source_key = '0001111111' ORDER BY p.full_name"""
                )).fetchall()
                assert [r['full_name'] for r in rows] == ['Ada Lovelace', 'Grace B Hopper']
            finally:
                await db.close()

        asyncio.run(check_people())


UK_COLS = ['CompanyName', ' CompanyNumber', 'RegAddress.AddressLine1', 'RegAddress.PostTown',
           'CompanyCategory', 'CompanyStatus', 'DissolutionDate', 'IncorporationDate',
           'Accounts.LastMadeUpDate', 'Accounts.AccountCategory', 'SICCode.SicText_1', 'URI']


def _uk_csv(rows):
    import csv as _csv
    buf = io.StringIO()
    writer = _csv.DictWriter(buf, fieldnames=UK_COLS)
    writer.writeheader()
    for row in rows:
        writer.writerow({col: row.get(col.strip(), '') for col in UK_COLS})
    return buf.getvalue().encode('utf-8')


def uk_tests() -> None:
    """Companies House bulk: only active companies above the small-company
    accounts thresholds that are operating businesses. Column names and value
    shapes match the live 2026-09 file (' CompanyNumber' really does carry a
    leading space; dates are dd/mm/yyyy)."""
    import zipfile as _zip
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from app.services import company_register as cr

    rows = [
        {'CompanyName': 'DELIVEROO PLC', 'CompanyNumber': '13227665', 'RegAddress.PostTown': 'LONDON',
         'CompanyStatus': 'Active', 'Accounts.AccountCategory': 'GROUP', 'IncorporationDate': '21/11/2020',
         'Accounts.LastMadeUpDate': '31/12/2025', 'SICCode.SicText_1': '56102 - Unlicensed restaurants and cafes',
         'CompanyCategory': 'Public Limited Company', 'URI': 'http://business.data.gov.uk/id/company/13227665'},
        {'CompanyName': 'MIDSIZE MAKER LTD', 'CompanyNumber': '00000002', 'RegAddress.PostTown': 'LEEDS',
         'CompanyStatus': 'Active', 'Accounts.AccountCategory': 'MEDIUM',
         'SICCode.SicText_1': '25620 - Machining'},
        # Below the thresholds: a one-person consultancy.
        {'CompanyName': 'TINY CONSULTANCY LTD', 'CompanyNumber': '00000003', 'CompanyStatus': 'Active',
         'Accounts.AccountCategory': 'MICRO ENTITY', 'SICCode.SicText_1': '70229 - Management consultancy'},
        # Right size, wrong kind: a holding vehicle, like Form D pooled funds.
        {'CompanyName': 'BIGCO HOLDINGS LIMITED', 'CompanyNumber': '00000004', 'CompanyStatus': 'Active',
         'Accounts.AccountCategory': 'FULL', 'SICCode.SicText_1': '64209 - Activities of other holding companies'},
        {'CompanyName': 'PROPERTY VEHICLE LTD', 'CompanyNumber': '00000005', 'CompanyStatus': 'Active',
         'Accounts.AccountCategory': 'FULL', 'SICCode.SicText_1': '68209 - Other letting of own real estate'},
        # Right size and kind, but no longer trading.
        {'CompanyName': 'GONE LTD', 'CompanyNumber': '00000006', 'CompanyStatus': 'Liquidation',
         'Accounts.AccountCategory': 'FULL', 'SICCode.SicText_1': '25620 - Machining'},
    ]
    buffer = io.BytesIO()
    with _zip.ZipFile(buffer, 'w') as zf:
        zf.writestr('BasicCompanyDataAsOneFile-2026-09-01.csv', _uk_csv(rows))
    with _zip.ZipFile(io.BytesIO(buffer.getvalue())) as zf:
        with zf.open(zf.namelist()[0]) as handle:
            kept = list(cr.parse_uk_bulk(handle))

    names = [c['company_name'] for c in kept]
    assert names == ['Deliveroo Plc', 'Midsize Maker Ltd'], names
    first = kept[0]
    assert first['tier'] == 'uk' and first['country'] == 'GB' and first['source_key'] == '13227665'
    assert first['sector_code'] == '56102' and first['sector_label'] == 'Unlicensed restaurants and cafes'
    assert first['region'] == 'London'
    assert first['last_event_at'] == '2025-12-31' and first['last_event_kind'] == 'accounts_filed'
    assert first['metadata']['size_band'] == 'group (consolidated accounts)'
    assert first['metadata']['incorporated'] == '2020-11-21'
    # No invented headcount: the band is the evidence, and its source is named.
    assert first.get('employees') is None
    assert first['employees_source'] == 'companies_house_account_category'
    assert kept[1]['metadata']['size_band'].startswith('medium')
    assert cr._uk_date('') is None and cr._uk_date('31/12/2025') == '2025-12-31'


if __name__ == '__main__':
    tests()
    uk_tests()
    print('company register: ok')
