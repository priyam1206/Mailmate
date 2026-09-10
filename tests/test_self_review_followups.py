from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_repository_contract_files_exist():
    assert (ROOT / 'LICENSE').is_file()
    assert (ROOT / 'GOVERNANCE.md').is_file()


def test_legacy_logo_assets_and_references_are_removed():
    images = ROOT / 'assets' / 'images'
    assert not (images / 'logo.svg').exists()
    assert not (images / 'cs_logo.png').exists()

    app = (ROOT / 'app.py').read_text(encoding='utf-8')
    assert '"mailmate_logo.jpg":' in app
    assert '"cs_logo.png":' not in app
    assert '"logo.svg":' not in app

    for relative in ('index.html', 'dashboard.html'):
        content = (ROOT / relative).read_text(encoding='utf-8')
        assert 'cs_logo.png' not in content
        assert 'logo.svg' not in content
        assert './assets/images/mailmate_logo.jpg' in content


def test_policy_normalizes_visible_branding_to_mailmate_asset():
    policy = (ROOT / 'kyle-policy.js').read_text(encoding='utf-8')
    assert "function normalizeBrandAssets()" in policy
    assert "const mailmateLogo = './assets/images/mailmate_logo.jpg';" in policy
    assert "document.querySelectorAll('link[rel~=\"icon\"]')" in policy
    assert 'normalizeBrandAssets();' in policy


def test_restored_loader_waits_for_existing_scripts_and_survives_failures():
    policy = (ROOT / 'kyle-policy.js').read_text(encoding='utf-8')
    assert "data-mailmate-load-state" in policy
    assert "existing.readyState === 'loaded' || existing.readyState === 'complete'" in policy
    assert "existing.addEventListener('load', handleLoad" in policy
    assert "existing.addEventListener('error', handleError" in policy
    assert "fallbackTimer = setTimeout(() => settle('failed'), 2000)" in policy
    assert "if (settled) return;" in policy
    assert "optional UI layer failed to load" in policy
    assert "continueChain();" in policy
    assert "mailmate-product-v8.js?v=2" in policy
    assert "mailmate-product-v9.js?v=3" in policy


def test_overview_deduper_preserves_distinct_google_event_ids():
    dashboard = (ROOT / 'dashboard.js').read_text(encoding='utf-8')
    assert "itemId && existingId && itemId !== existingId" in dashboard
    assert "String(item.source || 'google').toLowerCase() === 'google'" in dashboard
    assert "String(existing.source || 'google').toLowerCase() === 'google'" in dashboard
