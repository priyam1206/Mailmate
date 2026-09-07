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

    assert 'dashboard.css?v=45' in html
    assert 'mailmate-master-polish.css?v=2' in html
    assert 'kyle-ui.js?v=43' in html
    assert 'kyle.js?v=38' in html


def test_inbox_hides_unattached_work_and_display_only_noise():
    js = (ROOT / 'dashboard.js').read_text(encoding='utf-8')
    assert 'dashboard.js?v=40' in (ROOT / 'dashboard.html').read_text(encoding='utf-8')
    assert 'Safe for local AI overview' not in js
    assert 'Kyle will prepare a Work item for this email on the next sync' not in js
    assert "if (work.state === 'eligible') return '';" in js
    assert '\\u200b-\\u200f' in js


def test_calendar_uses_all_visible_columns_and_compact_timed_events():
    js = (ROOT / 'dashboard.js').read_text(encoding='utf-8')
    css = (ROOT / 'dashboard.css').read_text(encoding='utf-8')
    assert "height < 42 ? 'is-compact' : ''" in js
    assert 'repeat(7, minmax(0, 1fr))' in css
    assert '.calendar-event-block.is-compact small { display: none; }' in css


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





def test_kyle_runtime_v3_keeps_composer_and_chat_in_viewport():
    ui = (ROOT / 'kyle-ui.js').read_text(encoding='utf-8')
    tools = (ROOT / 'kyle-tools.js').read_text(encoding='utf-8')
    css = (ROOT / 'dashboard.css').read_text(encoding='utf-8')
    js = (ROOT / 'kyle.js').read_text(encoding='utf-8')

    assert 'document.body.appendChild(panel)' in ui
    assert 'ensureComposerVisible' in ui
    assert "new CustomEvent('kyle:layout-changed'" in ui
    assert "flex-direction: column-reverse" in css
    assert "transaction.status === 'complete'" in js
    assert "openPreparingComposer?.(mode)" not in tools


def test_recent_mail_read_intent_is_not_forced_into_composer():
    js = (ROOT / 'kyle.js').read_text(encoding='utf-8')
    assert 'const readOnlyMailIntent' in js
    assert 'show me the most recent mail' in js
    assert '!readOnlyMailIntent' in js


def test_overview_is_kyle_canvas_surface():
    html = (ROOT / 'dashboard.html').read_text(encoding='utf-8')
    css = (ROOT / 'dashboard.css').read_text(encoding='utf-8')
    ui = (ROOT / 'kyle-ui.js').read_text(encoding='utf-8')
    js = (ROOT / 'kyle.js').read_text(encoding='utf-8')
    planner = (ROOT / 'services' / 'kyle_agent_planner.py').read_text(encoding='utf-8')

    assert 'id="kyleCanvas"' in html
    assert 'id="overviewDataSurface"' in html
    assert 'id="kyleCanvasComposerHost"' in html
    assert 'kyle-canvas.js?v=4' in html
    assert 'MAILMATE_OVERVIEW_CANVAS_V1' in css
    assert 'kyle-overview-inline-composer' in css
    assert 'window.KyleCanvas?.beginComposer?.(mode)' in ui
    assert 'window.KyleCanvas?.prepare?.' in js
    assert 'speak(voice || reply, run, revealCanvas)' in js
    assert '"presentation": presentation' in planner
    assert '"canvas": _validate_canvas' in planner


def test_overview_canvas_voice_is_short_takeaway():
    planner = (ROOT / 'services' / 'kyle_agent_planner.py').read_text(encoding='utf-8')
    assert 'under 32 words' in planner
    assert 'Do not read the full canvas, every email, every sender, or every bullet aloud unless explicitly asked.' in planner


def test_overview_prompt_is_true_viewport_dock():
    canvas = (ROOT / 'kyle-canvas.js').read_text(encoding='utf-8')
    css = (ROOT / 'dashboard.css').read_text(encoding='utf-8')
    js = (ROOT / 'dashboard.js').read_text(encoding='utf-8')
    html = (ROOT / 'dashboard.html').read_text(encoding='utf-8')

    assert 'document.body.appendChild(home)' in canvas
    assert 'function ensureOverviewDock()' in canvas
    assert 'body > #kyleOverviewHome' in css
    assert 'bottom: max(18px, env(safe-area-inset-bottom))' in css
    assert '.main.is-overview-page .topbar > div:first-child' in css
    assert "classList.toggle('is-overview-page', name === 'overview')" in js
    assert '<main class="main is-overview-page">' in html


def test_overview_canvas_is_richer_than_voice():
    planner = (ROOT / 'services' / 'kyle_agent_planner.py').read_text(encoding='utf-8')
    canvas = (ROOT / 'kyle-canvas.js').read_text(encoding='utf-8')

    assert 'The CANVAS is the detailed answer' in planner
    assert 'Prefer 3-5 useful sections' in planner
    assert 'Each section should normally contain 2-6 concrete items' in planner
    assert 'VOICE is only the spoken takeaway' in planner
    assert 'under 32 words' in planner

    assert 'function normalizeCanvasBase' in canvas
    assert 'function contextualCanvasFallback' in canvas
    assert 'function classifyCanvasScope' in canvas
    assert 'scopedFallbackSections' in canvas




def test_sidebar_replaces_redundant_page_headings():
    css = (ROOT / 'dashboard.css').read_text(encoding='utf-8')

    assert 'MAILMATE_NO_REDUNDANT_PAGE_HEADINGS_V1' in css
    assert '.topbar > div:first-child' in css
    assert 'display: none !important' in css
    assert '.topbar .profile' in css
    assert '.tab-panel' in css


def test_floating_kyle_stays_bottom_anchored_and_pages_have_utility_lane():
    css = (ROOT / 'dashboard.css').read_text(encoding='utf-8')
    ui = (ROOT / 'kyle-ui.js').read_text(encoding='utf-8')
    drag = (ROOT / 'kyle-drag.js').read_text(encoding='utf-8')

    assert 'MAILMATE_FLOATING_KYLE_GEOMETRY_V1' in css
    assert '.kyle-floating-mount .kyle-history-toggle' in css
    assert 'position: absolute !important' in css
    assert '.kyle-widget.is-conversation-minimized .kyle-transcript' in css
    assert 'max-height: 0 !important' in css
    assert '.tab-panel:not(#tab-overview)' in css
    assert "detail: { animate: true, reason: 'conversation-toggle' }" in ui
    assert "event?.detail?.animate !== false" in drag
    assert '.resnap(animate)' in drag


def test_kyle_canvas_has_runtime_safe_frame_scheduler():
    canvas = (ROOT / 'kyle-canvas.js').read_text(encoding='utf-8')
    assert 'function requestAnimationFrameSafe' in canvas
    assert "typeof raf === 'function'" in canvas


def test_canvas_scope_respects_specific_questions():
    canvas = (ROOT / 'kyle-canvas.js').read_text(encoding='utf-8')
    planner = (ROOT / 'services' / 'kyle_agent_planner.py').read_text(encoding='utf-8')
    css = (ROOT / 'dashboard.css').read_text(encoding='utf-8')

    assert 'function classifyCanvasScope' in canvas
    assert "return 'latest_email'" in canvas
    assert "return 'important_mail'" in canvas
    assert 'scopedFallbackSections' in canvas
    assert 'mail_focus/focused: no automatic expansion at all' in canvas
    assert 'STRICT CANVAS SCOPE:' in planner
    assert 'exactly ONE email' in planner
    assert 'MAILMATE_CANVAS_SCOPE_FORMAT_V2' in css

def test_specific_canvas_requests_stay_scoped():
    canvas = (ROOT / 'kyle-canvas.js').read_text(encoding='utf-8')
    planner = (ROOT / 'services' / 'kyle_agent_planner.py').read_text(encoding='utf-8')

    assert 'function classifyCanvasScope' in canvas
    assert 'scopedFallbackSections' in canvas
    assert "return 'latest_email'" in canvas
    assert "return 'important_mail'" in canvas
    assert 'STRICT CANVAS SCOPE:' in planner
    assert 'exactly ONE email' in planner
