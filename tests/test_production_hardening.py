import app as mailmate_app


def test_api_responses_receive_security_headers():
    response = mailmate_app.app.test_client().get('/api/health')

    assert response.headers['X-Content-Type-Options'] == 'nosniff'
    assert response.headers['X-Frame-Options'] == 'DENY'
    assert response.headers['Referrer-Policy'] == 'strict-origin-when-cross-origin'
    assert response.headers['Cache-Control'] == 'no-store'


def test_cross_origin_api_write_is_rejected():
    response = mailmate_app.app.test_client().post(
        '/api/kyle/chat',
        json={'message': 'hello'},
        headers={'Origin': 'https://malicious.example'},
    )

    assert response.status_code == 403
    assert response.get_json()['error'] == 'Cross-origin request rejected'


def test_same_origin_api_write_is_allowed_through_guard():
    response = mailmate_app.app.test_client().post(
        '/api/kyle/chat',
        json={},
        headers={'Origin': 'http://localhost'},
    )

    assert response.status_code != 403


def test_secure_session_defaults_are_enabled():
    assert mailmate_app.app.config['SESSION_COOKIE_HTTPONLY'] is True
    assert mailmate_app.app.config['SESSION_COOKIE_SAMESITE'] == 'Lax'
    assert 'default-dev-secret' not in str(mailmate_app.app.secret_key)
