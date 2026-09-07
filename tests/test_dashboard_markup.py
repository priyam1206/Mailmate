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

    assert 'dashboard.css?v=36' in html
    assert 'mailmate-master-polish.css?v=2' in html
    assert 'kyle-ui.js?v=37' in html
    assert 'kyle.js?v=33' in html


def test_kyle_windows_have_space_saving_controls():
    ui = (ROOT / 'kyle-ui.js').read_text(encoding='utf-8')
    css = (ROOT / 'dashboard.css').read_text(encoding='utf-8')
    assert 'id="kylePanelMinimizeBtn"' in ui
    assert 'class="kyle-history-toggle"' in ui
    assert 'is-conversation-minimized' in ui
    assert "if (!panel?.classList.contains('is-open')) return;" not in ui
    assert "panel.classList.add('is-minimized')" in ui
    assert '.kyle-action-panel.is-minimized' in css
    assert '.kyle-widget.is-conversation-minimized .kyle-transcript' in css
    assert '@keyframes kyleOrbSpeakingFloat' in css
    assert 'transition: width 300ms' in css
