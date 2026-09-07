from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_landing_story_and_persistent_auth_are_wired():
    html = (ROOT / 'index.html').read_text(encoding='utf-8')
    css = (ROOT / 'landing.css').read_text(encoding='utf-8')
    js = (ROOT / 'landing.js').read_text(encoding='utf-8')

    assert 'class="landing-v2"' in html
    assert 'landing.css?v=2' in html
    assert 'landing.js?v=2' in html
    assert '<video' not in html
    assert 'bgVideo' not in js
    assert 'is-story-scrolled' in css
    assert 'id="landingStory"' in html
    assert 'id="storyPagination"' in html
    assert 'Scroll to explore' in html
    assert html.index('id="landingStory"') < html.index('id="authContainer"')
    assert all(f'data-story-page="{index}"' in html for index in range(6))

    assert '.landing-v2 .auth-container' in css
    assert 'inset: 24px 28px auto auto !important' in css
    assert 'scroll-snap-type: y mandatory' in css
    assert 'IntersectionObserver' in js
    assert 'scrollIntoView' in js


def test_landing_describes_real_mailmate_surfaces():
    html = (ROOT / 'index.html').read_text(encoding='utf-8')

    for phrase in (
        'Know what matters',
        'Ask once.',
        'From email to execution',
        'Useful continuity',
        'Multiple intelligence layers',
        'Gmail remains the source of truth',
    ):
        assert phrase in html


def test_portable_landing_patch_script_is_safe_and_scoped():
    script = (ROOT / 'APPLY_MAILMATE_LANDING_STORY.ps1').read_text(encoding='utf-8')
    assert 'git fetch' in script
    assert 'git checkout $SourceRef -- @files' in script
    assert 'git reset --hard' not in script
    assert 'git clean' not in script
