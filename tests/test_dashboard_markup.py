from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def test_automation_modal_has_backdrop_and_complete_form():
    html = (ROOT / 'dashboard.html').read_text(encoding='utf-8')

    assert 'class="calendar-modal-backdrop" id="automationModal" hidden' in html
    assert 'id="automationForm"' in html
    for field_id in (
        'automationName', 'automationScheduleType', 'automationTime',
        'automationGoal', 'automationEnabled',
    ):
        assert f'id="{field_id}"' in html


def test_kyle_composer_assets_are_cache_bumped():
    html = (ROOT / 'dashboard.html').read_text(encoding='utf-8')

    assert 'kyle-ui.js?v=34' in html
    assert 'kyle.js?v=32' in html
