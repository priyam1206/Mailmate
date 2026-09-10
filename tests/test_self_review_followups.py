from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_repository_contract_files_exist():
    assert (ROOT / 'LICENSE').is_file()
    assert (ROOT / 'GOVERNANCE.md').is_file()


def test_legacy_c2c_svg_is_removed():
    assert not (ROOT / 'assets' / 'images' / 'logo.svg').exists()


def test_policy_normalizes_visible_branding_to_mailmate_asset():
    policy = (ROOT / 'kyle-policy.js').read_text(encoding='utf-8')
    assert "function normalizeBrandAssets()" in policy
    assert "const mailmateLogo = './assets/images/mailmate_logo.jpg';" in policy
    assert "document.querySelectorAll('link[rel~=\"icon\"]')" in policy
    assert 'normalizeBrandAssets();' in policy


def test_restored_loader_waits_for_existing_scripts_and_survives_failures():
    policy = (ROOT / 'kyle-policy.js').read_text(encoding='utf-8')
    assert "data-mailmate-load-state" in policy
    assert "existing.addEventListener('load', continueChain" in policy
    assert "existing.addEventListener('error', continueChain" in policy
    assert "optional UI layer failed to load" in policy
    assert "continueChain();" in policy
    assert "mailmate-product-v8.js?v=2" in policy
    assert "mailmate-product-v9.js?v=3" in policy
