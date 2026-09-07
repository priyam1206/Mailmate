import os
from urllib.parse import quote

import requests


class ElevenLabsError(RuntimeError):
    pass


def status():
    key = str(os.getenv('ELEVENLABS_API_KEY') or '').strip()
    return {
        'configured': key.startswith('sk_'),
        'keyPresent': bool(key),
        'keyFormatValid': key.startswith('sk_'),
        'voiceId': os.getenv('ELEVENLABS_VOICE_ID', 'JBFqnCBsd6RMkjVDRZzb'),
        'voiceName': os.getenv('ELEVENLABS_VOICE_NAME', 'George'),
        'modelId': os.getenv('ELEVENLABS_MODEL_ID', 'eleven_flash_v2_5'),
        'agentConfigured': bool(os.getenv('ELEVENLABS_AGENT_ID')),
    }


def _api_key():
    key = str(os.getenv('ELEVENLABS_API_KEY') or '').strip()
    if not key.startswith('sk_'):
        raise ElevenLabsError('A valid ElevenLabs API key beginning with sk_ is required.')
    return key


def synthesize(text):
    clean = ' '.join(str(text or '').split()).strip()
    if not clean:
        raise ElevenLabsError('Speech text is required.')
    clean = clean[:600]
    voice_id = os.getenv('ELEVENLABS_VOICE_ID', 'JBFqnCBsd6RMkjVDRZzb').strip()
    model_id = os.getenv('ELEVENLABS_MODEL_ID', 'eleven_flash_v2_5').strip()
    response = requests.post(
        f'https://api.elevenlabs.io/v1/text-to-speech/{quote(voice_id, safe="")}',
        params={'output_format': 'mp3_44100_128'},
        headers={'xi-api-key': _api_key(), 'Content-Type': 'application/json'},
        json={
            'text': clean,
            'model_id': model_id,
            'voice_settings': {
                'stability': 0.48,
                'similarity_boost': 0.78,
                'style': 0.12,
                'use_speaker_boost': True,
                'speed': 1.02,
            },
        },
        timeout=25,
    )
    if not response.ok:
        detail = 'ElevenLabs speech generation failed.'
        try:
            detail = (response.json().get('detail') or {}).get('message') or detail
        except Exception:
            pass
        raise ElevenLabsError(detail)
    return response.content, response.headers.get('Content-Type', 'audio/mpeg')


def signed_agent_url():
    agent_id = str(os.getenv('ELEVENLABS_AGENT_ID') or '').strip()
    if not agent_id:
        raise ElevenLabsError('ELEVENLABS_AGENT_ID is not configured.')
    response = requests.get(
        'https://api.elevenlabs.io/v1/convai/conversation/get-signed-url',
        params={'agent_id': agent_id},
        headers={'xi-api-key': _api_key()},
        timeout=15,
    )
    if not response.ok:
        raise ElevenLabsError('Could not authorize the ElevenLabs Agent session.')
    signed_url = str((response.json() or {}).get('signed_url') or '').strip()
    if not signed_url.startswith('wss://'):
        raise ElevenLabsError('ElevenLabs returned an invalid Agent URL.')
    return signed_url
