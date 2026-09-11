from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_startup_gate_waits_for_current_overview_render():
    policy = (ROOT / 'kyle-policy.js').read_text(encoding='utf-8')
    dashboard = (ROOT / 'dashboard.js').read_text(encoding='utf-8')

    assert "const settled = { profile: false, overview: false };" in policy
    assert "window.MailmateBoot?.mark?.('profile');" in dashboard
    assert "window.MailmateBoot?.mark?.('overview');" in dashboard
    assert "calendar: false" not in policy
    assert "health: false" not in policy
    assert "finish('timeout')" not in policy


def test_startup_gate_never_presents_stale_clear_as_current():
    policy = (ROOT / 'kyle-policy.js').read_text(encoding='utf-8')
    dashboard = (ROOT / 'dashboard.js').read_text(encoding='utf-8')

    assert 'mailmate-native-boot' in policy
    assert 'hydrateSessionSnapshot' not in dashboard
    assert 'sessionStorage.setItem(`mailmate.dashboard.' not in dashboard


def test_only_one_startup_overlay_is_installed():
    policy = (ROOT / 'kyle-policy.js').read_text(encoding='utf-8')
    worker = (ROOT / 'remote-worker-ui.js').read_text(encoding='utf-8')

    assert "boot.id = 'mailmateNativeBoot';" in policy
    assert 'mailmateStartupGate' not in worker


def test_critical_overview_renders_before_secondary_calendar_sync():
    source = (ROOT / 'dashboard.js').read_text(encoding='utf-8')

    render_at = source.index('renderDashboard(data);')
    calendar_at = source.index('await refreshCalendar(false);', render_at)
    assert render_at < calendar_at
