import base64
from unittest.mock import Mock, patch

from services.google_service import _readable_message_body, _safe_message_html, mark_gmail_message_read


def _encoded(value):
    return base64.urlsafe_b64encode(value.encode('utf-8')).decode('ascii').rstrip('=')


def test_plain_text_is_preferred_over_html():
    payload = {
        'mimeType': 'multipart/alternative',
        'parts': [
            {'mimeType': 'text/plain', 'body': {'data': _encoded('Plain first\n\nSecond line')}},
            {'mimeType': 'text/html', 'body': {'data': _encoded('<p>HTML fallback</p>')}},
        ],
    }

    assert _readable_message_body(payload) == 'Plain first\n\nSecond line'


def test_html_fallback_is_readable_and_drops_script_content():
    payload = {
        'mimeType': 'text/html',
        'body': {'data': _encoded('<div>Hello &amp; welcome<br><script>bad()</script>Next</div>')},
    }

    assert _readable_message_body(payload) == 'Hello & welcome\nNext'


def test_safe_html_preserves_layout_and_blocks_executable_or_tracking_content():
    payload = {
        'mimeType': 'text/html',
        'body': {'data': _encoded(
            '<table style="width: 100%; position: fixed"><tr><td>'
            '<a href="https://example.com" onclick="bad()">Open</a>'
            '<img src="https://tracker.example/pixel.png">'
            '<script>steal()</script></td></tr></table>'
        )},
    }
    rendered = _safe_message_html(payload)
    assert '<table style="width: 100%">' in rendered
    assert 'href="https://example.com"' in rendered
    assert 'onclick' not in rendered
    assert '<img' not in rendered
    assert 'tracker.example' not in rendered
    assert 'steal()' not in rendered


def test_mark_read_removes_only_the_unread_label():
    execute = Mock(return_value={'id': 'gmail-1', 'threadId': 'thread-1', 'labelIds': ['INBOX']})
    modify = Mock(return_value=Mock(execute=execute))
    service = Mock()
    service.users.return_value.messages.return_value.modify = modify

    with patch('services.google_service._gmail_service', return_value=service):
        result = mark_gmail_message_read('gmail-1')

    modify.assert_called_once_with(
        userId='me',
        id='gmail-1',
        body={'removeLabelIds': ['UNREAD']},
    )
    assert result['is_read'] is True


def test_safe_html_preserves_hidden_preheader_and_min_width_layout():
    payload = {
        'mimeType': 'text/html',
        'body': {'data': _encoded(
            '<div style="visibility:hidden; opacity:0; overflow:hidden; max-height:0; width:0">preheader</div>'
            '<table style="min-width:600px; width:100%"><tr><td>Body</td></tr></table>'
        )},
    }
    rendered = _safe_message_html(payload)
    assert 'visibility: hidden' in rendered
    assert 'opacity: 0' in rendered
    assert 'overflow: hidden' in rendered
    assert 'max-height: 0' in rendered
    assert 'min-width: 600px' in rendered
