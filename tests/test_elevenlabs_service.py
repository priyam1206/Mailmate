import services.elevenlabs_service as elevenlabs


class Response:
    ok = True
    content = b'audio'
    headers = {'Content-Type': 'audio/mpeg'}


def test_invalid_key_id_is_not_treated_as_configured(monkeypatch):
    monkeypatch.setenv('ELEVENLABS_API_KEY', 'b066a250165a26bb')
    assert elevenlabs.status()['configured'] is False


def test_tts_uses_server_key_and_george_voice(monkeypatch):
    captured = {}
    monkeypatch.setenv('ELEVENLABS_API_KEY', 'sk_test_secret')
    monkeypatch.setenv('ELEVENLABS_VOICE_ID', 'JBFqnCBsd6RMkjVDRZzb')
    monkeypatch.setenv('ELEVENLABS_MODEL_ID', 'eleven_flash_v2_5')
    monkeypatch.setattr(elevenlabs.requests, 'post', lambda url, **kwargs: captured.update({'url': url, **kwargs}) or Response())
    content, mime = elevenlabs.synthesize('Hello from Kyle')
    assert content == b'audio'
    assert mime == 'audio/mpeg'
    assert captured['headers']['xi-api-key'] == 'sk_test_secret'
    assert captured['url'].endswith('/JBFqnCBsd6RMkjVDRZzb')
    assert captured['json']['model_id'] == 'eleven_flash_v2_5'


def test_private_agent_signed_url_stays_server_side(monkeypatch):
    class SignedResponse:
        ok = True
        @staticmethod
        def json():
            return {'signed_url': 'wss://api.elevenlabs.io/private-token'}

    captured = {}
    monkeypatch.setenv('ELEVENLABS_API_KEY', 'sk_test_secret')
    monkeypatch.setenv('ELEVENLABS_AGENT_ID', 'agent_test')
    monkeypatch.setattr(elevenlabs.requests, 'get', lambda url, **kwargs: captured.update(kwargs) or SignedResponse())
    assert elevenlabs.signed_agent_url().startswith('wss://')
    assert captured['headers']['xi-api-key'] == 'sk_test_secret'
